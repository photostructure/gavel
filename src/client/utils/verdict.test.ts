import { describe, expect, it } from 'vitest';

import type { ReviewApproval } from '../../types/conversation';
import { createDiffSelection } from '../../utils/diffSelection';

import { needsVerdict, nextReviewNeedingVerdict } from './verdict';

const review = (name: string, approval: ReviewApproval = {}) => ({
  selection: createDiffSelection('base', '.', undefined, name),
  approval,
});
const approved: ReviewApproval = { verdict: 'approve' };

const withdrawal = { at: '2026-11-21T12:00:00.000Z', reason: 'Superseded.' };

describe('needsVerdict', () => {
  it('needs one until the review has a verdict or its agent withdraws it', () => {
    expect(needsVerdict({ approval: {} })).toBe(true);
    expect(needsVerdict({ approval: approved })).toBe(false);
    expect(needsVerdict({ approval: { verdict: 'reject' } })).toBe(false);
    expect(needsVerdict({ approval: {}, withdrawal })).toBe(false);
  });
});

describe('nextReviewNeedingVerdict', () => {
  const queue = [review('a'), review('b', approved), review('c'), review('d')];

  it('picks the next review without a verdict after the open one, in creation order', () => {
    expect(nextReviewNeedingVerdict(queue, queue[0]!.selection)?.selection.reviewName).toBe('c');
    expect(nextReviewNeedingVerdict(queue, queue[2]!.selection)?.selection.reviewName).toBe('d');
  });

  it('skips withdrawn reviews', () => {
    const withdrawn = [review('a'), { ...review('b'), withdrawal }, review('c')];
    expect(nextReviewNeedingVerdict(withdrawn, withdrawn[0]!.selection)?.selection.reviewName).toBe(
      'c',
    );
  });

  it('wraps around to earlier reviews', () => {
    expect(nextReviewNeedingVerdict(queue, queue[3]!.selection)?.selection.reviewName).toBe('a');
  });

  it('never picks the open review, whose new verdict the list may not show yet', () => {
    const only = review('a');
    expect(nextReviewNeedingVerdict([only], only.selection)).toBeUndefined();
  });

  it('starts from the first review when the open one is not in the list', () => {
    expect(
      nextReviewNeedingVerdict(queue, createDiffSelection('base', 'staged'))?.selection.reviewName,
    ).toBe('a');
  });
});
