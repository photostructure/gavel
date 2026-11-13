import type { ComponentType } from 'react';

import type {
  CommentIntent,
  CommentThread,
  DiffFile,
  DiffSide,
  DiffViewMode,
  LineNumber,
} from '../../types/diff';
import type { NamedReviewMetadata } from '../../types/review';
import type { CommentSubmitOptions } from '../components/CommentForm';
import type { AppearanceSettings } from '../components/SettingsModal';
import type { CursorPosition } from '../hooks/keyboardNavigation';
import type { MergedChunk } from '../hooks/useExpandedLines';

export type DiffViewerBodyProps = {
  file: DiffFile;
  threads: CommentThread[];
  showAuthorBadges?: boolean;
  diffMode: DiffViewMode;
  syntaxTheme?: AppearanceSettings['syntaxTheme'];
  baseCommitish?: string;
  targetCommitish?: string;
  /** The named review whose capture the diff shows, absent for a live diff. */
  capture?: Pick<NamedReviewMetadata, 'name' | 'version'>;
  cursor?: CursorPosition | null;
  fileIndex?: number;
  mergedChunks: MergedChunk[];
  isExpandLoading: boolean;
  canExpandHiddenLines?: boolean;
  expandHiddenLines: (
    file: DiffFile,
    chunkIndex: number,
    direction: 'up' | 'down',
    count?: number,
  ) => Promise<void>;
  expandAllBetweenChunks: (
    file: DiffFile,
    chunkIndex: number,
    hiddenLines: number,
  ) => Promise<void>;
  onAddComment: (
    line: LineNumber,
    body: string,
    codeContent?: string,
    side?: DiffSide,
    options?: CommentSubmitOptions,
  ) => Promise<void>;
  onGenerateThreadPrompt: (thread: CommentThread) => string;
  onToggleThreadResolved: (threadId: string) => void;
  onRemoveThread?: (threadId: string) => void;
  onRestoreComment?: (threadId: string, messageId?: string) => void;
  onReplyToThread: (threadId: string, body: string, intent?: CommentIntent) => Promise<void>;
  onRemoveMessage: (threadId: string, messageId: string) => void;
  onUpdateMessage: (
    threadId: string,
    messageId: string,
    newBody: string,
    intent?: CommentIntent,
  ) => void;

  onOpenInEditor?: (filePath: string, lineNumber: number) => void;
  onLineClick?: (
    fileIndex: number,
    chunkIndex: number,
    lineIndex: number,
    side: 'left' | 'right',
  ) => void;
  commentTrigger?: { fileIndex: number; chunkIndex: number; lineIndex: number } | null;
  onCommentTriggerHandled?: () => void;
};

export type DiffViewerRegistration = {
  id: string;
  match: (file: DiffFile) => boolean;
  Component: ComponentType<DiffViewerBodyProps>;
  canExpandHiddenLines?: (file: DiffFile) => boolean;
};
