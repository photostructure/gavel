import type { ConversationSnapshotReview } from '../types/conversation.js';

import { isWorkingTreeTarget } from './diffSelection.js';

/**
 * The reviews that ask the reviewer for a verdict, each shown as a tab: every named review, and
 * each unnamed review whose agent proposed a commit message. A message the server copied from a
 * browsed commit is no proposal.
 */
export function verdictTabReviews(
  reviews: ConversationSnapshotReview[],
): ConversationSnapshotReview[] {
  // A commit that moves HEAD gives an unnamed working-tree review a new base, so a new
  // review; the old one stays on the server, and its approval lapses once the next edit
  // changes its diff. Only the newest one per target, with or without a proposal, is
  // pending. A base browsed for the same target before an agent proposed hides the
  // older review too; that is unsupported.
  const newestWorkingTree = new Map(
    reviews
      .filter((review) => !review.capture && isWorkingTreeTarget(review.selection.targetCommitish))
      .map((review) => [review.selection.targetCommitish, review.id]),
  );
  return reviews.filter(
    (review) =>
      review.capture ||
      (Boolean(review.summary.commitMessage.trim()) &&
        !review.summary.fromCommit &&
        (!isWorkingTreeTarget(review.selection.targetCommitish) ||
          newestWorkingTree.get(review.selection.targetCommitish) === review.id)),
  );
}
