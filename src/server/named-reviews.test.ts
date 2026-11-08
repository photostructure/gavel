import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ReviewCapture } from '../types/review.js';
import { getDiffSelectionKey } from '../utils/diffSelection.js';

import { NamedReviewError, NamedReviewStore } from './named-reviews.js';
import { capturePatch } from './review-capture.js';

const repositoryRoot = resolve(tmpdir(), 'gavel-named-review-store');
const foreignRepositoryRoot = resolve(tmpdir(), 'gavel-another-repository');
const baseCommit = 'a'.repeat(40);

function capture(newValue = 'after', base = baseCommit, root = repositoryRoot): ReviewCapture {
  return capturePatch(
    [
      'diff --git a/src/example.ts b/src/example.ts',
      '--- a/src/example.ts',
      '+++ b/src/example.ts',
      '@@ -1 +1 @@',
      '-before',
      `+${newValue}`,
      '',
    ].join('\n'),
    { repositoryRoot: root, baseCommit: base },
  );
}

function store(): NamedReviewStore {
  return new NamedReviewStore(capture());
}

function failure(action: () => unknown, status: number): NamedReviewError {
  try {
    action();
  } catch (error) {
    if (!(error instanceof NamedReviewError)) throw error;
    expect(error.status).toBe(status);
    return error;
  }
  throw new Error(`Expected NamedReviewError with status ${status}`);
}

describe('NamedReviewStore', () => {
  it('keeps names independent when they start from the same patch', () => {
    const reviews = store();
    const initial = capture();
    const first = reviews.create('task-one', initial);
    const second = reviews.create('task-two', initial);

    expect(first.metadata).toEqual({
      name: 'task-one',
      version: 1,
      patchDigest: initial.patchDigest,
      baseCommit,
      repositoryId: initial.repositoryId,
    });
    expect(first.selection).toEqual({
      baseCommitish: baseCommit,
      targetCommitish: '.',
      reviewName: 'task-one',
    });
    expect(getDiffSelectionKey(first.selection)).not.toBe(getDiffSelectionKey(second.selection));
    reviews.update('task-one', 1, capture('updated'));
    expect(reviews.get('task-one')?.metadata.version).toBe(2);
    expect(reviews.get('task-two')).toEqual(second);
    failure(() => reviews.create('task-one', initial), 409);
    expect(reviews.get('task-one')?.metadata.version).toBe(2);
  });

  it('increments versions for changed patches while retaining stable selection identity', () => {
    const reviews = store();
    const first = reviews.create('task', capture());
    const nextCapture = capture('updated', 'b'.repeat(40));
    const second = reviews.update('task', 1, nextCapture);
    const third = reviews.update('task', 2, capture());

    expect(second).toEqual({
      changed: true,
      review: {
        metadata: {
          ...first.metadata,
          version: 2,
          patchDigest: nextCapture.patchDigest,
          baseCommit: nextCapture.baseCommit,
        },
        capture: nextCapture,
        selection: {
          baseCommitish: nextCapture.baseCommit,
          targetCommitish: '.',
          reviewName: 'task',
        },
      },
    });
    expect(third.changed).toBe(true);
    expect(third.review.metadata.version).toBe(3);
    expect(third.review.metadata.patchDigest).toBe(first.metadata.patchDigest);
    expect(getDiffSelectionKey(second.review.selection)).toBe(getDiffSelectionKey(first.selection));
    expect(reviews.get('task')).toEqual(third.review);
  });

  it('rejects stale writers even when they retry the current patch digest', () => {
    const reviews = store();
    reviews.create('task', capture());
    const nextCapture = capture('updated');
    const current = reviews.update('task', 1, nextCapture).review;

    for (const suppliedCapture of [capture('another change'), nextCapture]) {
      const error = failure(() => reviews.update('task', 1, suppliedCapture), 409);
      expect(error.current).toEqual(current.metadata);
      if (error.current) error.current.version = 900;
      expect(reviews.get('task')).toEqual(current);
    }
    expect(reviews.get('task', 3)).toBeUndefined();
  });

  it('retains the complete current capture and metadata for an unchanged valid patch', () => {
    const reviews = store();
    const first = reviews.create('task', capture());
    const samePatchAtNewBase = capture('after', 'b'.repeat(40));

    expect(reviews.update('task', 1, samePatchAtNewBase)).toEqual({
      changed: false,
      review: first,
    });
    expect(reviews.get('task')).toEqual(first);
    expect(reviews.get('task', 2)).toBeUndefined();
  });

  it('returns no missing captures and rejects updates to an unknown name', () => {
    const reviews = store();
    expect(reviews.get('unknown')).toBeUndefined();
    failure(() => reviews.update('unknown', 1, capture()), 404);
    expect(reviews.get('unknown')).toBeUndefined();
    reviews.create('task', capture());
    expect(reviews.get('task', 2)).toBeUndefined();
  });

  it.each(['', '../task', 'two tasks', '.hidden', 'x'.repeat(81)])(
    'rejects invalid review name %j without creating or modifying a review',
    (name) => {
      const reviews = store();
      const first = reviews.create('task', capture());
      failure(() => reviews.create(name, capture()), 400);
      failure(() => reviews.get(name), 400);
      failure(() => reviews.update(name, 1, capture('updated')), 400);
      expect(reviews.get('task')).toEqual(first);
    },
  );

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid capture version %s without changing state',
    (version) => {
      const reviews = store();
      const first = reviews.create('task', capture());
      failure(() => reviews.update('task', version, capture('updated')), 400);
      failure(() => reviews.get('task', version), 400);
      expect(reviews.get('task')).toEqual(first);
    },
  );

  it('rejects foreign repositories during creation and update without changing state', () => {
    const reviews = store();
    const first = reviews.create('task', capture());
    const foreign = capture('updated', baseCommit, foreignRepositoryRoot);

    failure(() => reviews.create('foreign', foreign), 400);
    failure(() => reviews.update('task', 1, foreign), 400);
    expect(reviews.get('foreign')).toBeUndefined();
    expect(reviews.get('task')).toEqual(first);
  });

  it('requires both the server repository root and repository ID to match', () => {
    const initial = capture();
    const foreign = capture('updated', baseCommit, foreignRepositoryRoot);
    for (const repository of [
      { repositoryRoot, repositoryId: foreign.repositoryId },
      { repositoryRoot: foreign.repositoryRoot, repositoryId: initial.repositoryId },
    ]) {
      const reviews = new NamedReviewStore(repository);
      failure(() => reviews.create('task', initial), 400);
      expect(reviews.get('task')).toBeUndefined();
    }
  });

  it('rejects tampered digests, patches and catalogues before changing state', () => {
    const reviews = store();
    const first = reviews.create('task', capture());
    const original = capture('updated');
    const changedCatalogue = structuredClone(original);
    changedCatalogue.files[0]!.hunks[0]!.newStart = 20;
    const invalid: unknown[] = [
      null,
      {},
      { ...original, patchDigest: '0'.repeat(64) },
      { ...original, patch: original.patch.replace('+updated', '+tampered') },
      { ...original, repositoryId: '0'.repeat(64) },
      changedCatalogue,
    ];

    for (const value of invalid) {
      failure(() => reviews.create('invalid', value), 400);
      failure(() => reviews.update('task', 1, value), 400);
      expect(reviews.get('task')).toEqual(first);
      expect(reviews.get('invalid')).toBeUndefined();
    }
    const sameDigestInvalidCapture = { ...capture(), files: [] };
    failure(() => reviews.update('task', 1, sameDigestInvalidCapture), 400);
    expect(reviews.get('task')).toEqual(first);
  });

  it('retains every original version and its catalogue when later captures replace it', () => {
    const reviews = store();
    const first = reviews.create('task', capture());
    const second = reviews.update('task', 1, capture('second')).review;
    const third = reviews.update('task', 2, capture('third', 'b'.repeat(40))).review;

    expect(reviews.get('task', 1)).toEqual(first);
    expect(reviews.get('task', 2)).toEqual(second);
    expect(reviews.get('task', 3)).toEqual(third);
    expect(first.capture.files[0]?.hunks[0]?.id).not.toBe(second.capture.files[0]?.hunks[0]?.id);
    expect(reviews.get('task')).toEqual(third);
  });

  it('isolates stored history from constructor, input and returned object mutations', () => {
    const input = capture();
    const repository = { repositoryRoot, repositoryId: input.repositoryId };
    const reviews = new NamedReviewStore(repository);
    repository.repositoryRoot = resolve(tmpdir(), 'changed-outside');
    const created = reviews.create('task', input);
    const expectedFirst = structuredClone(created);
    input.patch = 'Changed outside';
    input.files[0]!.path = 'outside.ts';
    created.metadata.version = 99;
    created.selection.reviewName = 'outside';
    created.capture.files[0]!.hunks[0]!.newStart = 99;
    expect(reviews.get('task')).toEqual(expectedFirst);

    const updateInput = capture('updated');
    const updated = reviews.update('task', 1, updateInput).review;
    const expectedSecond = structuredClone(updated);
    updateInput.files[0]!.hunks.length = 0;
    updated.capture.files.length = 0;
    updated.metadata.name = 'outside';
    const fetched = reviews.get('task', 1)!;
    fetched.capture.files[0]!.hunks.length = 0;
    const unchanged = reviews.update('task', 2, capture('updated')).review;
    unchanged.capture.files.length = 0;

    expect(reviews.get('task', 1)).toEqual(expectedFirst);
    expect(reviews.get('task')).toEqual(expectedSecond);
  });
});
