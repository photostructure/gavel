import type { ReviewVerdict } from './conversation.js';
import type { CommentIntent, DiffCommentMessage, DiffCommentThread } from './diff.js';

/** Where an undone delete goes back. Without either list, the item is appended. */
interface ReviewOpPlacement {
  followingIds?: string[];
  precedingIds?: string[];
}

/** One change a reviewer made to a review's comments or verdict. */
export type ReviewOp =
  | ({ type: 'thread.add'; thread: DiffCommentThread } & ReviewOpPlacement)
  | ({ type: 'message.add'; threadId: string; message: DiffCommentMessage } & ReviewOpPlacement)
  | {
      type: 'message.edit';
      threadId: string;
      messageId: string;
      body: string;
      intent?: CommentIntent;
      at: string;
    }
  | { type: 'message.delete'; threadId: string; messageId: string }
  | { type: 'thread.delete'; threadId: string }
  | { type: 'thread.resolve'; threadId: string; resolved: boolean; at: string }
  // The bindings PUT /api/approval checks; clear needs none.
  | {
      type: 'verdict.set';
      verdict: ReviewVerdict | 'clear';
      summaryVersion?: number;
      captureVersion?: number;
      patchDigest?: string;
      diffDigest?: string;
    };

export interface ReviewOpResult {
  id: string;
  status: 'applied' | 'duplicate' | 'rejected';
  error?: string;
}

export interface ReviewOpsResponse {
  version: number;
  /** `<server instance>:<sequence>`, ordering this answer among the review's comment snapshots. */
  cursor: string;
  results: ReviewOpResult[];
  threads: DiffCommentThread[];
}
