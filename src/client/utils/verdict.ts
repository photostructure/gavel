import type { ReviewApproval, ReviewWithdrawal } from '../../types/conversation';
import type { DiffSelection } from '../../types/diff';
import { diffSelectionsEqual } from '../../utils/diffSelection';

interface VerdictState {
  approval: ReviewApproval;
  withdrawal?: ReviewWithdrawal;
}

/** The review still asks for a verdict: the reviewer has given none and its agent has not withdrawn it. */
export const needsVerdict = ({ approval, withdrawal }: VerdictState) =>
  approval.verdict === undefined && !withdrawal;

/**
 * The first review after the open one, in creation order and wrapping around, that needs a
 * verdict. The open review is skipped: right after its verdict saves, the list may not show it.
 */
export function nextReviewNeedingVerdict<T extends VerdictState & { selection: DiffSelection }>(
  reviews: T[],
  current: DiffSelection | null,
): T | undefined {
  const index = reviews.findIndex((review) => diffSelectionsEqual(review.selection, current));
  const ordered = [...reviews.slice(index + 1), ...reviews.slice(0, Math.max(index, 0))];
  return ordered.find(needsVerdict);
}
