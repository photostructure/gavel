import { describe, expect, it } from 'vitest';

import type { ReviewApproval } from '../../types/conversation';
import { createDiffSelection } from '../../utils/diffSelection';

import { hasVerdict, nextReviewNeedingVerdict } from './verdict';

const review = (name: string, approval: ReviewApproval = { approved: false }) => ({
  selection: createDiffSelection('base', '.', undefined, name),
  approval,
});
const approved: ReviewApproval = { approved: true, requested: true, mode: 'as-is' };

describe('hasVerdict', () => {
  it('counts approval, pending approval after comments, and not yet as verdicts', () => {
    expect(hasVerdict(approved)).toBe(true);
    expect(
      hasVerdict({ approved: false, requested: true, mode: 'after-comments', conditions: [] }),
    ).toBe(true);
    expect(hasVerdict({ approved: false, notYet: true })).toBe(true);
    expect(hasVerdict({ approved: false })).toBe(false);
  });
});

describe('nextReviewNeedingVerdict', () => {
  const queue = [review('a'), review('b', approved), review('c'), review('d')];

  it('picks the next review without a verdict after the open one, in creation order', () => {
    expect(nextReviewNeedingVerdict(queue, queue[0]!.selection)?.selection.reviewName).toBe('c');
    expect(nextReviewNeedingVerdict(queue, queue[2]!.selection)?.selection.reviewName).toBe('d');
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
