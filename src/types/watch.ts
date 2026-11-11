export enum DiffMode {
  DEFAULT = 'default', // HEAD^ vs HEAD
  WORKING = 'working', // staged vs working
  STAGED = 'staged', // HEAD vs staged
  DOT = 'dot', // HEAD vs working (all changes)
  SPECIFIC = 'specific', // commit vs commit (no watching)
}

type WatchChangeType = 'file' | 'commit' | 'staging';

interface ConnectedWatchEvent {
  type: 'connected';
  diffMode: DiffMode;
  changeType: WatchChangeType;
  timestamp: string;
  message?: string;
}

interface ReloadWatchEvent {
  type: 'reload';
  diffMode: DiffMode;
  changeType: WatchChangeType;
  timestamp: string;
  message?: string;
}

interface ErrorWatchEvent {
  type: 'error';
  diffMode: DiffMode;
  changeType: WatchChangeType;
  timestamp: string;
  message?: string;
}

interface CommentsChangedWatchEvent {
  type: 'commentsChanged';
  version: number;
  timestamp: string;
}

interface ApprovalChangedWatchEvent {
  type: 'approvalChanged';
  timestamp: string;
}

interface ReviewSummaryChangedWatchEvent {
  type: 'reviewSummaryChanged';
  timestamp: string;
}

// Whether review activity reached its agent session changed; read /api/inbox.
interface InboxDeliveryChangedWatchEvent {
  type: 'inboxDeliveryChanged';
  timestamp: string;
}

interface ReviewCaptureChangedWatchEvent {
  type: 'reviewCaptureChanged';
  reviewName?: string;
  timestamp: string;
}

/** An agent renamed a named review; a page showing it moves to the new name. */
interface ReviewRenamedWatchEvent {
  type: 'reviewRenamed';
  previousName: string;
  reviewName: string;
  timestamp: string;
}

/** An agent deleted a named review; a page showing it moves to another review. */
interface ReviewDeletedWatchEvent {
  type: 'reviewDeleted';
  reviewName: string;
  timestamp: string;
}

export type WatchEvent =
  | ConnectedWatchEvent
  | ReloadWatchEvent
  | ErrorWatchEvent
  | CommentsChangedWatchEvent
  | ApprovalChangedWatchEvent
  | ReviewSummaryChangedWatchEvent
  | ReviewCaptureChangedWatchEvent
  | InboxDeliveryChangedWatchEvent
  | ReviewRenamedWatchEvent
  | ReviewDeletedWatchEvent;

export interface ClientWatchState {
  isWatchEnabled: boolean;
  diffMode: DiffMode;
  shouldReload: boolean;
  isReloading: boolean;
  lastChangeTime: Date | null;
  lastChangeType: WatchChangeType | null;
  connectionStatus: 'connected' | 'disconnected' | 'reconnecting';
}
