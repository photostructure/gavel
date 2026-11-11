import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  capturePatch,
  captureWorkingTree,
  getCaptureRepository,
} from '../server/review-capture.js';
import { ReviewStore, type SavedReview } from '../server/review-store.js';
import type { ReviewCapture } from '../types/review.js';
import { createDiffSelection } from '../utils/diffSelection.js';

import { findSavedCapture, revertCapture } from './unapply.js';

const lines = (count: number, edit: Record<number, string> = {}) =>
  Array.from({ length: count }, (_, index) => edit[index + 1] ?? String(index + 1)).join('\n') +
  '\n';

describe('revertCapture', () => {
  let root: string;

  function git(...args: string[]): string {
    return execFileSync(
      'git',
      ['-c', 'user.name=gavel', '-c', 'user.email=gavel@example.com', ...args],
      { cwd: root, encoding: 'utf8' },
    );
  }
  const read = (path: string) => readFileSync(join(root, path), 'utf8');
  const write = (path: string, text: string) => writeFileSync(join(root, path), text);
  const run = (capture: ReviewCapture, direction: 'unapply' | 'reapply', dryRun = false) =>
    revertCapture(capture, { cwd: root, direction, label: 'task', ...(dryRun ? { dryRun } : {}) });

  beforeEach(() => {
    for (const key of Object.keys(process.env))
      if (key.startsWith('GIT_')) vi.stubEnv(key, undefined);
    vi.stubEnv('GIT_CONFIG_GLOBAL', devNull);
    vi.stubEnv('GIT_CONFIG_SYSTEM', devNull);
    root = realpathSync(mkdtempSync(join(tmpdir(), 'gavel-unapply-')));
    git('init', '--quiet', '-b', 'main');
    write('shared.txt', lines(30));
    write('mine.txt', 'mine\n');
    write('gone.txt', 'gone\n');
    git('add', '.');
    git('commit', '--quiet', '--no-verify', '-m', 'base');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  // This session's change: one line in a shared file, a whole file, a created file, and a
  // deleted file.
  async function captureMine(): Promise<ReviewCapture> {
    write('shared.txt', lines(30, { 5: 'mine-5' }));
    write('mine.txt', 'mine, changed\n');
    write('created.txt', 'created\n');
    unlinkSync(join(root, 'gone.txt'));
    return captureWorkingTree({ cwd: root, includeUntracked: true });
  }

  it('reverses the capture, keeping an edit elsewhere in a shared file', async () => {
    const capture = await captureMine();
    write('shared.txt', lines(30, { 5: 'mine-5', 20: 'other-20' }));
    const result = await run(capture, 'unapply');
    expect(result).toMatchObject({ written: true });
    expect(read('shared.txt')).toBe(lines(30, { 20: 'other-20' }));
    expect(read('mine.txt')).toBe('mine\n');
    expect(existsSync(join(root, 'created.txt'))).toBe(false);
    expect(read('gone.txt')).toBe('gone\n');
  });

  // git apply needs a hunk's 3 context lines to match: mine-5's are lines 2-4 and 6-8.
  it('reverses a hunk exactly when no other edit is within 3 lines of it', async () => {
    const capture = await captureMine();
    write('shared.txt', lines(30, { 5: 'mine-5', 9: 'other-9' }));
    const result = await run(capture, 'unapply');
    expect(result).toMatchObject({ written: true });
    expect(result).not.toHaveProperty('fallback');
    expect(read('shared.txt')).toBe(lines(30, { 9: 'other-9' }));
  });

  // As when sessions add CHANGELOG bullets next to each other.
  it('reverses a hunk by its own lines when other edits are next to it', async () => {
    const capture = await captureMine();
    write('shared.txt', lines(30, { 4: 'other-4', 5: 'mine-5', 6: 'other-6' }));
    const result = await run(capture, 'unapply');
    expect(result).toMatchObject({
      written: true,
      fallback: [
        { command: 'git apply -R -C0 --reject', files: ['created.txt', 'shared.txt', 'mine.txt'] },
        { command: 'git apply -R --reject', files: ['gone.txt'] },
      ],
    });
    expect(result).not.toHaveProperty('rejected');
    expect(read('shared.txt')).toBe(lines(30, { 4: 'other-4', 6: 'other-6' }));
    expect(read('mine.txt')).toBe('mine\n');
  });

  // Reversing a hunk that only deletes lines inserts them, and with no lines of its own to
  // match, -C0 would put them at the hunk's old line number.
  it('keeps the context check for a file with a hunk that only deletes lines', async () => {
    write('shared.txt', lines(30).replace('20\n', ''));
    const capture = await captureWorkingTree({ cwd: root });
    const other = `a\nb\nc\nd\ne\n${lines(30, { 19: 'nineteen' }).replace('20\n', '')}`;
    write('shared.txt', other);
    const result = await run(capture, 'unapply');
    expect(result).toMatchObject({
      written: true,
      fallback: [{ command: 'git apply -R --reject', files: ['shared.txt'] }],
      rejected: expect.stringContaining('shared.txt'),
    });
    expect(read('shared.txt')).toBe(other);
  });

  it('reports a dry run that the fallback would complete without rejecting', async () => {
    const capture = await captureMine();
    write('shared.txt', lines(30, { 4: 'other-4', 5: 'mine-5', 6: 'other-6' }));
    const result = await run(capture, 'unapply', true);
    expect(result).toMatchObject({
      dryRun: true,
      fallback: [
        { command: 'git apply -R -C0 --reject', files: ['created.txt', 'shared.txt', 'mine.txt'] },
        { command: 'git apply -R --reject', files: ['gone.txt'] },
      ],
    });
    expect(result).not.toHaveProperty('rejected');
  });

  it('reverses the other hunks and reports one whose own lines another edit changed', async () => {
    const capture = await captureMine();
    write('shared.txt', lines(30, { 5: 'other-5' }));
    const result = await run(capture, 'unapply');
    expect(result).toMatchObject({
      written: true,
      fallback: [
        { command: 'git apply -R -C0 --reject', files: ['created.txt', 'shared.txt', 'mine.txt'] },
        { command: 'git apply -R --reject', files: ['gone.txt'] },
      ],
      rejected: expect.stringContaining('shared.txt'),
    });
    expect(result.rejected).not.toContain('Checking patch');
    expect(read('shared.txt')).toBe(lines(30, { 5: 'other-5' }));
    expect(read('mine.txt')).toBe('mine\n');
    expect(existsSync(join(root, 'created.txt'))).toBe(false);
    expect(existsSync(join(root, 'shared.txt.rej'))).toBe(false);
    // The stash holds every tracked file as it was, the other edit included.
    expect(git('show', `${result.stash}:shared.txt`)).toBe(lines(30, { 5: 'other-5' }));
    expect(git('show', `${result.stash}:mine.txt`)).toBe('mine, changed\n');
  });

  // git apply --check stops at a file's first failing hunk; --reject goes on to the rest.
  it('reports every hunk left in a file, and reverts the ones between them', async () => {
    write('shared.txt', lines(30, { 5: 'mine-5', 15: 'mine-15', 25: 'mine-25' }));
    const capture = await captureWorkingTree({ cwd: root });
    write('shared.txt', lines(30, { 5: 'other-5', 15: 'mine-15', 25: 'other-25' }));
    const dryRun = await run(capture, 'unapply', true);
    const result = await run(capture, 'unapply');
    for (const { rejected } of [dryRun, result]) {
      expect(rejected).toContain('shared.txt:2');
      expect(rejected).toContain('shared.txt:22');
    }
    expect(read('shared.txt')).toBe(lines(30, { 5: 'other-5', 25: 'other-25' }));
  });

  it('reports on a dry run what the fallback would leave, writing nothing', async () => {
    const capture = await captureMine();
    write('shared.txt', lines(30, { 5: 'other-5' }));
    const result = await run(capture, 'unapply', true);
    expect(result).toMatchObject({
      dryRun: true,
      written: false,
      fallback: [
        { command: 'git apply -R -C0 --reject', files: ['created.txt', 'shared.txt', 'mine.txt'] },
        { command: 'git apply -R --reject', files: ['gone.txt'] },
      ],
      rejected: expect.stringContaining('shared.txt'),
    });
    expect(read('mine.txt')).toBe('mine, changed\n');
    expect(existsSync(join(root, 'shared.txt.rej'))).toBe(false);
    expect(git('stash', 'list')).toBe('');
  });

  it('reverses a hunk that lines inserted above it have moved', async () => {
    const capture = await captureMine();
    write('shared.txt', `other-a\nother-b\n${lines(30, { 5: 'mine-5' })}`);
    expect(await run(capture, 'unapply')).toMatchObject({ written: true });
    expect(read('shared.txt')).toBe(`other-a\nother-b\n${lines(30)}`);
  });

  // A rejected change left staged would go into another session's next commit.
  it("refuses while any of the capture's paths are staged", async () => {
    const capture = await captureMine();
    git('add', 'mine.txt');
    const result = await run(capture, 'unapply');
    expect(result).toMatchObject({ written: false, refused: expect.stringContaining('mine.txt') });
    expect(read('mine.txt')).toBe('mine, changed\n');
  });

  it('matches staged paths literally, not as globs', async () => {
    mkdirSync(join(root, 'r'));
    write('r/[id].tsx', 'route\n');
    const capture = await captureWorkingTree({ cwd: root, includeUntracked: true });
    write('r/i.tsx', 'other\n');
    git('add', 'r/i.tsx');
    const result = await run(capture, 'unapply');
    expect(result).toMatchObject({ written: true });
    expect(existsSync(join(root, 'r/[id].tsx'))).toBe(false);
  });

  it('checks a staged path that contains a tab', async () => {
    write('a\tb.txt', 'tab\n');
    git('add', 'a\tb.txt');
    const capture = await captureWorkingTree({ cwd: root });
    const result = await run(capture, 'unapply');
    expect(result).toMatchObject({ written: false, refused: expect.stringContaining('b.txt') });
  });

  it('checks the paths git apply writes for a plain unified patch', async () => {
    write('mine.txt', 'mine, changed\n');
    git('add', 'mine.txt');
    const patch = '--- a/mine.txt\n+++ b/mine.txt\n@@ -1 +1 @@\n-mine\n+mine, changed\n';
    const capture = capturePatch(patch, await getCaptureRepository(root));
    const result = await run(capture, 'unapply');
    expect(result).toMatchObject({ written: false, refused: expect.stringContaining('mine.txt') });
  });

  it('refuses a staged rename, checking both of its paths', async () => {
    git('mv', 'mine.txt', 'renamed.txt');
    const capture = await captureWorkingTree({ cwd: root });
    const result = await run(capture, 'unapply');
    expect(result).toMatchObject({
      written: false,
      refused: expect.stringContaining('renamed.txt'),
    });
  });

  it('writes nothing on a dry run and reports the stat', async () => {
    const capture = await captureMine();
    const result = await run(capture, 'unapply', true);
    expect(result).toMatchObject({ dryRun: true, written: false });
    expect(result).not.toHaveProperty('refused');
    expect(result.stat).toContain('mine.txt');
    expect(read('mine.txt')).toBe('mine, changed\n');
    expect(git('stash', 'list')).toBe('');
  });

  it('stores a stash of the tracked files before writing', async () => {
    const capture = await captureMine();
    const result = await run(capture, 'unapply');
    expect(result.stash).toMatch(/^[0-9a-f]{40}$/);
    expect(git('stash', 'list')).toContain('gavel review unapply task');
  });

  it('throws for a capture from another worktree', async () => {
    const capture = await captureMine();
    await expect(run({ ...capture, repositoryId: 'other' }, 'unapply')).rejects.toThrow(
      'run this there',
    );
    expect(read('mine.txt')).toBe('mine, changed\n');
  });

  // A pure insertion has no lines of its own to match, so reapply keeps the context check.
  it('reapplies without ignoring context, reporting a hunk another edit now sits next to', async () => {
    const capture = await captureMine();
    await run(capture, 'unapply');
    write('shared.txt', lines(30, { 6: 'other-6' }));
    const result = await run(capture, 'reapply');
    expect(result).toMatchObject({
      written: true,
      fallback: [
        {
          command: 'git apply --reject',
          files: ['gone.txt', 'mine.txt', 'shared.txt', 'created.txt'],
        },
      ],
      rejected: expect.stringContaining('shared.txt'),
    });
    expect(read('shared.txt')).toBe(lines(30, { 6: 'other-6' }));
    expect(read('mine.txt')).toBe('mine, changed\n');
    expect(existsSync(join(root, 'shared.txt.rej'))).toBe(false);
  });

  it('restores the capture with reapply', async () => {
    const capture = await captureMine();
    await run(capture, 'unapply');
    expect(await run(capture, 'reapply')).toMatchObject({ written: true });
    expect(read('shared.txt')).toBe(lines(30, { 5: 'mine-5' }));
    expect(read('created.txt')).toBe('created\n');
    expect(existsSync(join(root, 'gone.txt'))).toBe(false);
  });
});

describe('findSavedCapture', () => {
  let root: string;

  beforeEach(() => {
    for (const key of Object.keys(process.env))
      if (key.startsWith('GIT_')) vi.stubEnv(key, undefined);
    vi.stubEnv('GIT_CONFIG_GLOBAL', devNull);
    vi.stubEnv('GIT_CONFIG_SYSTEM', devNull);
    root = realpathSync(mkdtempSync(join(tmpdir(), 'gavel-unapply-store-')));
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    writeFileSync(join(root, 'file.txt'), 'one\n');
    execFileSync('git', ['add', 'file.txt'], { cwd: root });
    execFileSync(
      'git',
      ['-c', 'user.name=g', '-c', 'user.email=g@g', 'commit', '--quiet', '-m', 'one'],
      { cwd: root },
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it('picks a saved review by name, and asks for a digest when the name is ambiguous', async () => {
    writeFileSync(join(root, 'file.txt'), 'two\n');
    const older = await captureWorkingTree({ cwd: root });
    writeFileSync(join(root, 'file.txt'), 'three\n');
    const newer = await captureWorkingTree({ cwd: root });
    const store = new ReviewStore(join(root, '.git', 'gavel'));
    const server = store.registerServer();
    const saved = (capture: ReviewCapture, updatedAt: string): SavedReview => ({
      format: 1,
      repositoryId: capture.repositoryId,
      selection: createDiffSelection(capture.baseCommit, '.', undefined, 'task'),
      captures: [{ version: 1, patchDigest: capture.patchDigest, baseCommit: capture.baseCommit }],
      threads: [],
      progress: [],
      approval: {},
      summary: { commitMessage: '', rationale: '', version: 0 },
      updatedAt,
    });
    store.saveCapture(older);
    store.saveCapture(newer);
    store.save('older', saved(older, '2026-11-10T01:00:00.000Z'), server.owner);
    store.save('newer', saved(newer, '2026-11-10T02:00:00.000Z'), server.owner);
    server.release();
    await expect(findSavedCapture(root, 'task')).rejects.toThrow(
      new RegExp(
        `2 saved named reviews are called "task".*${newer.patchDigest}.*${older.patchDigest}`,
        's',
      ),
    );
    expect((await findSavedCapture(root, 'task', older.patchDigest)).patchDigest).toBe(
      older.patchDigest,
    );
    await expect(findSavedCapture(root, 'task', 'f'.repeat(64))).rejects.toThrow(
      'No saved named review "task" has capture',
    );
    await expect(findSavedCapture(root, 'missing')).rejects.toThrow(
      'No saved named review "missing"',
    );
  });
});
