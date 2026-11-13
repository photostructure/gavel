import type { NamedReviewMetadata } from './review.js';

export interface DiffFile {
  path: string;
  oldPath?: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied';
  additions: number;
  deletions: number;
  chunks: DiffChunk[];
  isGenerated?: boolean;
  /** Git reported the file as binary: a `Binary files … differ` line or a `GIT binary patch`. */
  isBinary?: boolean;
  /** `path` or `oldPath` is Git's quoted form of a name that is not valid UTF-8. */
  hasNonUtf8Path?: boolean;
  /** A named review cannot rebuild this file, so lines outside its hunks can't load. */
  contextUnavailable?: boolean;
}

export interface DiffChunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'add' | 'delete' | 'normal' | 'hunk' | 'remove' | 'context' | 'header';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export type DiffViewMode = 'split' | 'unified';
export type DiffSide = 'old' | 'new';
export type DiffLineRange = number | { start: number; end: number };

export interface DiffCommentPosition {
  side: DiffSide;
  line: DiffLineRange;
}

export interface DiffCommentCodeSnapshot {
  content: string;
  language?: string;
}

export type BaseMode = 'direct' | 'merge-base';

export interface DiffSelection {
  baseCommitish: string;
  targetCommitish: string;
  baseMode?: BaseMode;
  reviewName?: string;
}

export interface ReviewContext {
  source: 'git' | 'stdin';
  repositoryName?: string;
  repositoryPath?: string;
  workingDirectory: string;
  hostname: string;
  agent?: string;
  agentSessionName?: string;
  agentSessionId?: string;
}

export interface DiffResponse {
  capture?: NamedReviewMetadata;
  commit: string;
  files: DiffFile[];
  ignoreWhitespace?: boolean;
  isEmpty?: boolean;
  openInEditorAvailable?: boolean;
  /** The environment variable, such as DO_NOT_TRACK, that turned off About's npm update check. */
  updateCheckDisabledBy?: string;
  baseCommitish?: string;
  targetCommitish?: string;
  requestedBaseCommitish?: string;
  requestedTargetCommitish?: string;
  requestedBaseMode?: BaseMode;
  clearComments?: boolean;
  shipIt?: boolean;
  repositoryId?: string;
  reviewContext?: ReviewContext;
  commentImports?: CommentImport[];
  commentImportId?: string;
  title?: string;
  targetCommitMessage?: string;
  /** SHA-256 of the full-index patch, whitespace included, for index and worktree targets. */
  diffDigest?: string;
  /** SHA-256 of the patch an unnamed stdin review was launched with. */
  stdinDiffDigest?: string;
  // Patterns saved in ~/.gavel/config.json; /api/diff adds them to each response.
  autoViewedPatterns?: string[];
}

export interface GeneratedStatusResponse {
  path: string;
  ref: string;
  isGenerated: boolean;
  source: 'path' | 'content';
}

export type LineNumber = number | [number, number];

export interface Comment {
  id: string;
  file: string;
  line: LineNumber;
  body: string;
  timestamp: string;
  author?: string;
  codeContent?: string; // The actual code content for this line
  side?: DiffSide; // Which side the comment is on
}

export interface LineSelection {
  side: DiffSide;
  lineNumber: number;
}

export interface CommentProgress {
  status: 'queued' | 'delivered' | 'read' | 'thinking' | 'replying' | 'noted' | 'replied';
  cursor: string;
  updatedAt: string;
}

export type CommentIntent = 'comment' | 'question' | 'change';

export interface DiffCommentMessage {
  id: string;
  origin?: 'user' | 'agent';
  progress?: CommentProgress;
  intent?: CommentIntent;
  body: string;
  author?: string;
  createdAt: string;
  updatedAt: string;
}

// New data structures for enhanced comment and viewed state management
interface CommentThreadBase {
  capture?: Pick<NamedReviewMetadata, 'version' | 'patchDigest'>;
  id: string;
  createdAt: string; // ISO 8601 format
  updatedAt: string; // ISO 8601 format

  codeSnapshot?: DiffCommentCodeSnapshot;
  resolution?: { resolved: boolean; updatedAt: string };

  // Marks the thread as a question the AI should answer rather than act on
  isQuestion?: boolean;

  messages: DiffCommentMessage[];
}

export type DiffCommentThread = CommentThreadBase &
  (
    | { scope?: 'line'; filePath: string; position: DiffCommentPosition }
    | { scope: 'review'; filePath?: never; position?: never }
  );

interface CommentImportBase {
  id?: string;
  filePath: string;
  position: DiffCommentPosition;
  body: string;
  author?: string;
  createdAt?: string;
  updatedAt?: string;
  codeSnapshot?: DiffCommentCodeSnapshot;
}

export interface ThreadCommentImport extends CommentImportBase {
  type: 'thread';
}

export interface ReplyCommentImport extends CommentImportBase {
  type: 'reply';
}

export type CommentImport = ThreadCommentImport | ReplyCommentImport;

export interface ViewedFileRecord {
  filePath: string;
  viewedAt: string; // ISO 8601 format
  diffContentHash: string; // SHA-256 hash
}

export interface ViewedHashIndexEntry {
  filePath: string;
  diffContentHash: string;
  hashVersion: 1;
  viewedAt: string; // ISO 8601 format
}

export interface ViewedHashIndex {
  version: 1;
  lastModifiedAt: string; // ISO 8601 format
  entries: ViewedHashIndexEntry[];
}

// Undo copies of deleted comments, kept in page memory; never included in conversation API requests.
export interface DeletedComment {
  thread: DiffCommentThread;
  followingIds: string[];
  precedingIds: string[];
  messageId?: string;
}

export interface DiffContextStorage {
  version: 2; // Schema version
  baseCommitish: string;
  targetCommitish: string;
  baseMode?: BaseMode;
  createdAt: string; // ISO 8601 format
  lastModifiedAt: string; // ISO 8601 format

  /**
   * Kept before the review-op queue: sent threads, read once to send the ones the server lacks,
   * and undo copies, which are deleted unsent.
   */
  threads?: DiffCommentThread[];
  deletedComments?: DeletedComment[];
  viewedFiles: ViewedFileRecord[];
}

interface DisplayCommentThreadBase {
  deleted?: boolean;
  deletedMessageIds?: string[];
  capture?: Pick<NamedReviewMetadata, 'version' | 'patchDigest'>;
  id: string;
  createdAt: string;
  updatedAt: string;
  codeContent?: string;
  isOutdated?: boolean;
  isQuestion?: boolean;
  messages: DiffCommentMessage[];
  resolution?: { resolved: boolean; updatedAt: string };
}

export type CommentThread = DisplayCommentThreadBase &
  (
    | { scope?: 'line'; file: string; line: LineNumber; side?: DiffSide }
    | { scope: 'review'; file?: never; line?: never; side?: never }
  );

// Revision selector types
interface RevisionOption {
  value: string;
  label: string;
}

interface BranchInfo {
  name: string;
  current: boolean;
}

export interface CommitInfo {
  hash: string;
  shortHash: string;
  message: string;
}

export interface RevisionsResponse {
  specialOptions: RevisionOption[];
  branches: BranchInfo[];
  commits: CommitInfo[];
  originDefaultBranch?: string;
  resolvedBase?: string;
  resolvedTarget?: string;
  // Set when gavel was launched for a named review or an explicit target; the
  // revision menu then offers only this diff and recent reviews.
  launch?: DiffSelection;
}

// Expanded lines types for showing more context in diffs
export interface ExpandedLinesState {
  [filePath: string]: FileExpandedState;
}

export interface FileExpandedState {
  oldContent?: string[];
  newContent?: string[];
  expandedRanges: ExpandedRange[];
  oldTotalLines?: number;
  newTotalLines?: number;
  /** A named review's side failed to load, so the file shows its gaps as labels. */
  contextLoadFailed?: boolean;
}

interface ExpandedRange {
  chunkIndex: number;
  direction: 'up' | 'down';
  count: number;
}

export interface ExpandedLine extends DiffLine {
  isExpanded?: boolean;
}
