import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { digest } from '../server/review-capture.js';
import { ReviewStore, type SavedReview } from '../server/review-store.js';
import { createDiffSelection } from '../utils/diffSelection.js';

import { findApprovals } from './approval.js';

describe('findApprovals', () => {
  let root: string;
  let store: ReviewStore;
  let server: ReturnType<ReviewStore['registerServer']>;

  function git(...args: string[]): string {
    return execFileSync(
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
      {
        cwd: root,
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
          ),
          GIT_CONFIG_GLOBAL: devNull,
          GIT_CONFIG_SYSTEM: devNull,
        },
        encoding: 'utf8',
      },
    );
  }

  function saved(overrides: Partial<SavedReview>): SavedReview {
    return {
      format: 1,
      repositoryId: 'repo',
      selection: createDiffSelection('a'.repeat(40), 'b'.repeat(40)),
      threads: [],
      progress: [],
      approval: { verdict: 'as-is' },
      summary: { commitMessage: 'fix: one', rationale: '', version: 1 },
      updatedAt: '2026-11-07T12:00:00.000Z',
      ...overrides,
    };
  }

  beforeEach(() => {
    // findApprovals runs git with the inherited environment; give it the fixture's config.
    for (const key of Object.keys(process.env))
      if (key.startsWith('GIT_')) vi.stubEnv(key, undefined);
    vi.stubEnv('GIT_CONFIG_GLOBAL', devNull);
    vi.stubEnv('GIT_CONFIG_SYSTEM', devNull);
    root = realpathSync(mkdtempSync(join(tmpdir(), 'gavel-approval-status-')));
    git('init', '--quiet');
    writeFileSync(join(root, 'file.txt'), 'one\n');
    git('add', 'file.txt');
    git('commit', '--quiet', '--no-verify', '-m', 'first');
    writeFileSync(join(root, 'file.txt'), 'two\n');
    git('commit', '--quiet', '--no-verify', '-am', 'second');
    store = new ReviewStore(join(root, '.git', 'gavel'));
    server = store.registerServer();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    server.release();
    rmSync(root, { recursive: true, force: true });
  });

  it('finds a commit target and a patch review of the same commit by SHA', async () => {
    const sha = git('rev-parse', 'HEAD').trim();
    // The skill's recipe for adding an existing commit to a stack.
    const patch = git('diff', '--full-index', `${sha}^`, sha);
    // Abbreviated object names grow with the repository; the lookup must not depend on them.
    git('config', 'core.abbrev', '12');
    // A server saves the resolved selection, which names commits by their short hashes.
    store.save(
      'commit',
      saved({ selection: createDiffSelection(sha.slice(0, 7), sha.slice(0, 7)) }),
      server.owner,
    );
    store.save(
      'patch',
      saved({
        selection: createDiffSelection(sha, '.', undefined, 'c2'),
        captures: [{ version: 1, patchDigest: digest(patch), baseCommit: 'b'.repeat(40) }],
        approval: {},
      }),
      server.owner,
    );
    store.save(
      'other',
      saved({ captures: [{ version: 1, patchDigest: 'unrelated', baseCommit: 'b'.repeat(40) }] }),
      server.owner,
    );

    const found = await findApprovals(root, { commit: 'HEAD' });
    expect(
      found.map(({ match, selection, approval }) => ({
        match,
        name: selection.reviewName,
        verdict: approval.verdict,
      })),
    ).toEqual(
      expect.arrayContaining([
        { match: 'commit', name: undefined, verdict: 'as-is' },
        { match: 'patch', name: 'c2', verdict: undefined },
      ]),
    );
    expect(found).toHaveLength(2);
  });

  it('finds a review by patch digest, and nothing for a root commit’s missing parent', async () => {
    store.save(
      'patch',
      saved({
        selection: createDiffSelection('a'.repeat(40), '.', undefined, 'task'),
        captures: [
          { version: 1, patchDigest: 'old', baseCommit: 'b'.repeat(40) },
          { version: 2, patchDigest: 'current', baseCommit: 'b'.repeat(40) },
        ],
      }),
      server.owner,
    );
    expect(await findApprovals(root, { patchDigest: 'current' })).toMatchObject([
      {
        match: 'patch',
        selection: { reviewName: 'task' },
        approval: { verdict: 'as-is' },
        commitMessage: 'fix: one',
      },
    ]);
    expect(await findApprovals(root, { patchDigest: 'old' })).toEqual([]);
    expect(await findApprovals(root, { commit: 'HEAD^' })).toEqual([]);
  });
});
