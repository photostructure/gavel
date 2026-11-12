import type { ReviewApproval } from '../../types/conversation';
import type { DiffSelection } from '../../types/diff';
import { diffSelectionsEqual } from '../../utils/diffSelection';

/** The reviewer has given this review a verdict: approved or rejected. */
export const hasVerdict = (approval: ReviewApproval) => approval.verdict !== undefined;

/**
 * The first review after the open one, in creation order and wrapping around, that has no
 * verdict. The open review is skipped: right after its verdict saves, the list may not show it.
 */
export function nextReviewNeedingVerdict<
  T extends { selection: DiffSelection; approval: ReviewApproval },
>(reviews: T[], current: DiffSelection | null): T | undefined {
  const index = reviews.findIndex((review) => diffSelectionsEqual(review.selection, current));
  const ordered = [...reviews.slice(index + 1), ...reviews.slice(0, Math.max(index, 0))];
  return ordered.find((review) => !hasVerdict(review.approval));
}
