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

/**
 * The reviewer's decision on a review. approve lets the agent commit once it has addressed every
 * comment and the required checks and reviews pass; reject is final for those diffs: the agent
 * stops and asks the user what to do instead.
 */
export type ReviewVerdict = 'approve' | 'reject';

export interface ReviewApproval {
  /** Absent until the reviewer gives one. Only the reviewer ends a verdict. */
  verdict?: ReviewVerdict;
  captureVersion?: number;
  patchDigest?: string;
  summaryVersion?: number;
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
  origin: 'agent';
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
  timestamp: string;
}

/**
 * Where a server saves its reviews. error, when present, lists what it is not saving and why: a
 * failed or lock-waiting save, a failed heartbeat, and reviews another running server saves,
 * which this one keeps in memory only. It also lists files startup cleanup could not handle,
 * which stay without affecting saving.
 */
export interface ReviewStoreStatus {
  directory: string;
  error?: string;
}

export interface ConversationSnapshotReview {
  id: string;
  selection: DiffSelection;
  threads: DiffCommentThread[];
  approval: ReviewApproval;
  summary: ReviewSummary;
  capture?: NamedReviewMetadata;
}

/**
 * A named review an agent deleted from this server. Its conversation stays readable here until
 * the server stops; it takes no new comments, and a new review may reuse its name.
 */
interface DeletedReview extends ConversationSnapshotReview {
  deletedAt: string;
}

export interface ConversationSnapshot {
  presence?: ReviewPresenceSnapshot;
  /** Absent for a server that saves nothing: outside Git, or with --no-conversation. */
  store?: ReviewStoreStatus;
  cursor: string;
  reviews: ConversationSnapshotReview[];
  /** Present once an agent deletes a named review on this server. */
  deletedReviews?: DeletedReview[];
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

/** An agent renamed a named review; its ID, conversation, proposal and verdict stay. */
interface ReviewRenamedEvent {
  type: 'review.renamed';
  origin: 'agent';
  cursor: string;
  reviewId: string;
  previousName: string;
  selection: DiffSelection;
  capture: NamedReviewMetadata;
  timestamp: string;
}

/** An agent deleted a named review; snapshot.deletedReviews keeps its conversation. */
interface ReviewDeletedEvent {
  type: 'review.deleted';
  origin: 'agent';
  cursor: string;
  reviewId: string;
  selection: DiffSelection;
  timestamp: string;
}

export type ConversationStreamEvent =
  | ReviewCaptureEvent
  | ReviewRenamedEvent
  | ReviewDeletedEvent
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

/** One nonempty batch from one of the servers passed to gavel wait. */
export interface WaitResult extends ConversationBatch {
  type: 'wait.events';
  port: number;
}
