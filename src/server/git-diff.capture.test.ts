import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { GitDiffParser } from './git-diff.js';
import {
  capturePatch,
  captureWorkingTree,
  selectCapture,
  validateCapture,
} from './review-capture.js';

const setupEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
);

describe('captured patch rendering', () => {
  let root: string | undefined;

  afterEach(() => {
    vi.unstubAllEnvs();
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('renders a selected pure-copy file whose source and target contain spaces', async () => {
    root = mkdtempSync(join(tmpdir(), 'gavel-capture-copy-'));
    const repository = root;
    for (const key of Object.keys(process.env))
      if (key.startsWith('GIT_')) vi.stubEnv(key, undefined);
    const git = (...args: string[]) =>
      execFileSync(
        'git',
        [
          '-c',
          'user.name=gavel',
          '-c',
          'user.email=gavel@example.com',
          '-c',
          'commit.gpgsign=false',
          ...args,
        ],
        { cwd: repository, env: setupEnv, encoding: 'utf8' },
      );
    git('init', '--quiet');
    git('config', 'diff.renames', 'copies');
    const source = 'one\ntwo\nthree\n';
    writeFileSync(join(repository, 'old space.txt'), source);
    git('add', '.');
    git('commit', '--quiet', '--no-verify', '-m', 'fixture');
    writeFileSync(join(repository, 'new space.txt'), source);
    writeFileSync(join(repository, 'old space.txt'), 'changed\ntwo\nthree\n');
    git('add', '.');
    const artifact = await captureWorkingTree({ cwd: repository });
    const copied = artifact.files.find((file) => file.path === 'new space.txt');
    expect(copied).toMatchObject({ oldPath: 'old space.txt', hunks: [] });
    const selected = selectCapture(artifact, [copied?.id ?? '']);
    expect(selected.patch).toContain('copy from old space.txt\ncopy to new space.txt\n');
    expect(new GitDiffParser(repository).parseStdinDiff(selected.patch).files).toEqual([
      expect.objectContaining({
        path: 'new space.txt',
        oldPath: 'old space.txt',
        status: 'copied',
        chunks: [],
      }),
    ]);
  });

  it('restores a saved v1 capture with its digest and renders its copy as copied', () => {
    const patch =
      'diff --git a/old space.txt b/new space.txt\nsimilarity index 100%\ncopy from old space.txt\ncopy to new space.txt\n';
    const patchDigest = 'e4ab0e8af1b09b75299d1f798f9bd7abb78daa45bfee1fdef77b2f1e70cfb780';
    const fileId = `${patchDigest}:f1`;
    const saved = {
      schemaVersion: 1,
      repositoryRoot: '/tmp/saved-capture',
      repositoryId: 'f9bb8ceae3cfedbd3c59e2601fb0db32267980d542774aa0157c8789db328aa9',
      baseCommit: 'a'.repeat(40),
      patch,
      patchDigest,
      files: [{ id: fileId, path: 'new space.txt', oldPath: 'old space.txt', hunks: [] }],
    };

    const restored = validateCapture(saved);

    expect(restored.patchDigest).toBe(patchDigest);
    expect(restored.files.map((file) => file.id)).toEqual([fileId]);
    expect(new GitDiffParser().parseStdinDiff(restored.patch).files).toEqual([
      expect.objectContaining({ path: 'new space.txt', status: 'copied', chunks: [] }),
    ]);
  });

  it('renders all captured file IDs and selected hunk coordinates consistently', async () => {
    root = mkdtempSync(join(tmpdir(), 'gavel-capture-render-'));
    const repository = root;
    for (const key of Object.keys(process.env))
      if (key.startsWith('GIT_')) vi.stubEnv(key, undefined);
    const git = (...args: string[]) =>
      execFileSync(
        'git',
        [
          '-c',
          'user.name=gavel',
          '-c',
          'user.email=gavel@example.com',
          '-c',
          'commit.gpgsign=false',
          ...args,
        ],
        { cwd: repository, env: setupEnv, encoding: 'utf8' },
      );
    git('init', '--quiet');
    const modes = ['plain space.sh', 'é mode.sh', '🌲 mode.sh', 'dir b/part name.sh'];
    mkdirSync(join(repository, 'dir b'));
    for (const path of modes) writeFileSync(join(repository, path), 'echo hello\n');
    for (const path of ['binary space.bin', 'binary é space.bin'])
      writeFileSync(join(repository, path), Buffer.from([0, 1, 2]));
    mkdirSync(join(repository, 'a'));
    mkdirSync(join(repository, 'b'));
    writeFileSync(join(repository, 'a/old é name.txt'), 'rename contents\n');
    const textPath = 'two hunks é text.txt';
    const original =
      Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join('\n') + '\n';
    writeFileSync(join(repository, textPath), original);
    git('add', '.');
    git('commit', '--quiet', '--no-verify', '-m', 'fixture');
    for (const path of modes) chmodSync(join(repository, path), 0o755);
    for (const path of ['binary space.bin', 'binary é space.bin'])
      writeFileSync(join(repository, path), Buffer.from([0, 4, 5]));
    renameSync(join(repository, 'a/old é name.txt'), join(repository, 'b/new é name.txt'));
    git('add', 'a/old é name.txt', 'b/new é name.txt');
    writeFileSync(
      join(repository, textPath),
      'inserted first\ninserted second\n' + original.replace('line 35\n', 'changed 35\n'),
    );
    writeFileSync(join(repository, 'new empty space.txt'), '');
    writeFileSync(join(repository, 'new é empty.txt'), '');
    symlinkSync('/outside/review/target', join(repository, 'new é link'));

    const capture = await captureWorkingTree({ cwd: repository, includeUntracked: true });
    const parser = new GitDiffParser(repository);
    const rendered = parser.parseStdinDiff(capture.patch);
    expect(rendered.files.map(({ path, oldPath }) => ({ path, oldPath }))).toEqual(
      capture.files.map(({ path, oldPath }) => ({ path, oldPath })),
    );
    expect(rendered.files.find((file) => file.path === 'new empty space.txt')).toMatchObject({
      status: 'added',
      chunks: [],
    });
    expect(rendered.files.find((file) => file.path === 'new é empty.txt')).toMatchObject({
      status: 'added',
      chunks: [],
    });
    expect(rendered.files.find((file) => file.path === 'new é link')).toMatchObject({
      status: 'added',
      additions: 1,
    });
    expect(rendered.files.find((file) => file.path === 'b/new é name.txt')).toMatchObject({
      oldPath: 'a/old é name.txt',
      status: 'renamed',
      chunks: [],
    });

    for (const file of capture.files) {
      const selected = selectCapture(capture, [file.id]);
      expect(parser.parseStdinDiff(selected.patch).files.map((item) => item.path)).toEqual([
        file.path,
      ]);
    }
    const text = capture.files.find((file) => file.path === textPath);
    expect(text?.hunks).toHaveLength(2);
    const hunk = text?.hunks[1];
    expect(hunk).toBeDefined();
    const selected = selectCapture(capture, [hunk?.id ?? '']);
    const selectedFiles = parser.parseStdinDiff(selected.patch).files;
    expect(selectedFiles).toHaveLength(1);
    expect(selectedFiles[0]?.path).toBe(textPath);
    expect(selectedFiles[0]?.chunks).toHaveLength(1);
    expect(selectedFiles[0]?.chunks[0]).toMatchObject({
      oldStart: hunk?.oldStart,
      oldLines: hunk?.oldLines,
      newStart: hunk?.newStart,
      newLines: hunk?.newLines,
    });
    expect(selectedFiles[0]?.chunks[0]?.lines).toContainEqual(
      expect.objectContaining({ type: 'add', content: 'changed 35', newLineNumber: 37 }),
    );
  });

  it.each(['\r', '\u2028', '\u2029'])(
    'renders captured non-LF separators as content, not phantom files (%j)',
    async (separator) => {
      root = mkdtempSync(join(tmpdir(), 'gavel-capture-line-separator-'));
      const repository = root;
      for (const key of Object.keys(process.env))
        if (key.startsWith('GIT_')) vi.stubEnv(key, undefined);
      const git = (...args: string[]) =>
        execFileSync(
          'git',
          [
            '-c',
            'user.name=gavel',
            '-c',
            'user.email=gavel@example.com',
            '-c',
            'commit.gpgsign=false',
            ...args,
          ],
          { cwd: repository, env: setupEnv, encoding: 'utf8' },
        );
      git('init', '--quiet');
      writeFileSync(join(repository, 'file.txt'), 'old\n');
      git('add', '.');
      git('commit', '--quiet', '--no-verify', '-m', 'fixture');
      const content = `new${separator}diff --git a/phantom b/phantom`;
      writeFileSync(join(repository, 'file.txt'), `${content}\n`);
      // Ground truth: native Git emits one file with the separator inside its added line.
      const native = git('diff', '--no-color', 'HEAD', '--', 'file.txt');
      expect(native).toContain(`+${content}\n`);
      const artifact = await captureWorkingTree({ cwd: repository });
      expect(artifact.files.map((file) => file.path)).toEqual(['file.txt']);
      const selected = selectCapture(artifact, [artifact.files[0]?.hunks[0]?.id ?? '']);
      const rendered = new GitDiffParser(repository).parseStdinDiff(selected.patch);
      expect(rendered.files.map((file) => file.path)).toEqual(['file.txt']);
      expect(rendered.files[0]?.chunks[0]?.lines).toContainEqual(
        expect.objectContaining({ type: 'add', content }),
      );
    },
  );

  it.each([
    {
      name: 'modified',
      oldPath: 'space é.txt',
      newPath: 'space é.txt',
      body: ['@@ -1 +1 @@', '-old', '+new'],
      status: 'modified',
    },
    {
      name: 'added',
      oldPath: '/dev/null',
      newPath: 'added.txt',
      body: ['@@ -0,0 +1 @@', '+new'],
      status: 'added',
    },
    {
      name: 'deleted',
      oldPath: 'deleted.txt',
      newPath: '/dev/null',
      body: ['@@ -1 +0,0 @@', '-old'],
      status: 'deleted',
    },
    {
      name: 'no-newline markers',
      oldPath: 'marker.txt',
      newPath: 'marker.txt',
      body: [
        '@@ -1 +1 @@',
        '-old',
        '\\ No newline at end of file',
        '+new',
        '\\ No newline at end of file',
      ],
      status: 'modified',
    },
  ])('captures/selects/renders CRLF plain patches: $name', ({ oldPath, newPath, body, status }) => {
    const patch = [`--- ${oldPath}`, `+++ ${newPath}`, ...body, ''].join('\r\n');
    const path = newPath === '/dev/null' ? oldPath : newPath;
    // Ground truth: the existing plain viewer parser treats CRLF as transport records.
    const parser = new GitDiffParser();
    const reference = parser.parseStdinDiff(patch);
    expect(reference.files.map((file) => file.path)).toEqual([path]);
    const artifact = capturePatch(patch, {
      repositoryRoot: '/tmp/plain-capture',
      baseCommit: 'a'.repeat(40),
    });
    expect(artifact.files.map((file) => file.path)).toEqual([path]);
    const file = artifact.files[0];
    const id = oldPath === newPath ? file?.hunks[0]?.id : file?.id;
    const selected = selectCapture(artifact, [id ?? '']);
    expect(selected.patch).toBe(patch);
    expect(selected.patchDigest).toBe(artifact.patchDigest);
    const rendered = parser.parseStdinDiff(selected.patch);
    expect(rendered.files).toEqual(reference.files);
    expect(rendered.files[0]?.status).toBe(status);
  });

  it('preserves carriage-return content bytes in native Git patches', () => {
    const patch =
      'diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\r\n+new\r\n';
    const artifact = capturePatch(patch, {
      repositoryRoot: '/tmp/native-capture',
      baseCommit: 'a'.repeat(40),
    });
    const selected = selectCapture(artifact, [artifact.files[0]?.hunks[0]?.id ?? '']);
    expect(selected.patch).toBe(patch);
    expect(selected.patchDigest).toBe(artifact.patchDigest);
    expect(
      new GitDiffParser().parseStdinDiff(selected.patch).files[0]?.chunks[0]?.lines,
    ).toContainEqual(expect.objectContaining({ type: 'add', content: 'new\r' }));
  });
});
