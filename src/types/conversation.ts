import type { NamedReviewMetadata } from './review.js';
import type { ReviewPresenceSnapshot } from './presence.js';
import type {
  DiffCommentCodeSnapshot,
  DiffCommentPosition,
  DiffSelection,
  DiffCommentThread,
  CommentIntent,
  CommentProgress,
} from './diff.js';

export interface ConversationEvent {
  capture?: NamedReviewMetadata;
  anchorCapture?: Pick<NamedReviewMetadata, 'version' | 'patchDigest'>;
  type: 'comment.created' | 'comment.updated';
  cursor: string;
  origin: 'user' | 'agent';
  reviewId: string;
  selection: DiffSelection;
  threadId: string;
  messageId: string;
  scope?: 'line' | 'review';
  file?: string;
  side?: DiffCommentPosition['side'];
  line?: DiffCommentPosition['line'];
  intent?: CommentIntent;
  body: string;
  author?: string;
  codeSnapshot?: DiffCommentCodeSnapshot;
  timestamp: string;
}

export type ApprovalMode = 'as-is' | 'after-comments';

export interface ApprovalCondition {
  threadId: string;
  messageId: string;
  cursor: string;
  intent: CommentIntent;
  addressed?: {
    outcome: 'fixed' | 'answered' | 'acknowledged' | 'confirmed-by-reviewer';
    evidence: string;
    updatedAt: string;
  };
}

export interface ReviewApproval {
  conditionalSupported?: boolean;
  mode?: ApprovalMode;
  /** Conditional permission is recorded, but approved stays false until every condition is addressed. */
  requested?: boolean;
  conditions?: ApprovalCondition[];
  baselineCapture?: Pick<NamedReviewMetadata, 'version' | 'patchDigest'>;
  captureVersion?: number;
  patchDigest?: string;
  /** The approved index or worktree diff; a different current diff revokes an as-is approval. */
  diffDigest?: string;
  summaryVersion?: number;
  approved: boolean;
  updatedAt?: string;
  cursor?: string;
}

export interface ReviewSummary {
  commitMessage: string;
  rationale: string;
  version: number;
  updatedAt?: string;
  /** The server copied commitMessage from the browsed commit; nobody proposed it. Any save clears it. */
  fromCommit?: true;
}

interface ReviewSummaryEvent {
  capture?: NamedReviewMetadata;
  type: 'review.summary';
  origin: 'user' | 'agent';
  cursor: string;
  reviewId: string;
  selection: DiffSelection;
  summary: ReviewSummary;
  timestamp: string;
}

interface ReviewApprovalEvent {
  approval?: ReviewApproval;
  capture?: NamedReviewMetadata;
  type: 'review.approval';
  origin: 'user' | 'agent';
  summaryVersion?: number;
  cursor: string;
  reviewId: string;
  selection: DiffSelection;
  approved: boolean;
  timestamp: string;
}

export interface ConversationSnapshot {
  presence?: ReviewPresenceSnapshot;
  cursor: string;
  reviews: {
    id: string;
    selection: DiffSelection;
    threads: DiffCommentThread[];
    approval: ReviewApproval;
    summary: ReviewSummary;
    capture?: NamedReviewMetadata;
  }[];
}

/** progress.cursor identifies the comment revision; cursor identifies this stream event. */
interface CommentProgressEvent {
  type: 'comment.progress';
  origin: 'agent';
  cursor: string;
  reviewId: string;
  selection: DiffSelection;
  threadId: string;
  messageId: string;
  progress: CommentProgress;
  timestamp: string;
}

interface ThreadEvent {
  type: 'thread.resolved' | 'thread.reopened' | 'thread.deleted';
  origin: 'user' | 'agent';
  cursor: string;
  reviewId: string;
  selection: DiffSelection;
  threadId: string;
  timestamp: string;
}

interface CommentDeletedEvent {
  type: 'comment.deleted';
  cursor: string;
  origin: 'user' | 'agent';
  reviewId: string;
  selection: DiffSelection;
  threadId: string;
  messageId: string;
  timestamp: string;
}

interface ReviewCaptureEvent {
  type: 'review.capture';
  origin: 'agent';
  cursor: string;
  reviewId: string;
  selection: DiffSelection;
  capture: NamedReviewMetadata;
  timestamp: string;
}

export type ConversationStreamEvent =
  | ReviewCaptureEvent
  | ConversationEvent
  | CommentDeletedEvent
  | ReviewApprovalEvent
  | ReviewSummaryEvent
  | CommentProgressEvent
  | ThreadEvent;

export interface ConversationBatch {
  presence?: ReviewPresenceSnapshot;
  events: ConversationStreamEvent[];
  cursor: string;
}

/** One nonempty batch from one of the servers passed to difit wait. */
export interface WaitResult extends ConversationBatch {
  type: 'wait.events';
  port: number;
}
