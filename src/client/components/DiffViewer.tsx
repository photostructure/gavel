import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';

import {
  type DiffFile,
  type DiffViewMode,
  type DiffSide,
  type CommentThread,
  type CommentIntent,
  type LineNumber,
} from '../../types/diff';
import type { NamedReviewMetadata } from '../../types/review';
import { FileLevelTokensProvider } from '../contexts/FileLevelTokensContext';
import { type CursorPosition } from '../hooks/keyboardNavigation';
import { useLineDraftAnchors, type LineDraftAnchor } from '../hooks/useCommentDrafts';
import { type MergedChunk } from '../hooks/useExpandedLines';
import { useFileLevelTokens } from '../hooks/useFileLevelTokens';
import { isWholeFileHighlightExtension } from '../utils/languageDetection';
import { TextDiffViewer } from '../viewers/TextDiffViewer';
import { fileCanExpandHiddenLines, getViewerForFile } from '../viewers/registry';
import type { DiffViewerBodyProps } from '../viewers/types';

import type { CommentSubmitOptions } from './CommentForm';
import { DiffViewerHeader } from './DiffViewerHeader';
import { anchorsNotShown } from './LineCommentComposer';
import type { AppearanceSettings } from './SettingsModal';

interface DiffViewerProps {
  file: DiffFile;
  threads: CommentThread[];
  showAuthorBadges?: boolean;
  diffMode: DiffViewMode;
  reviewedFiles: Set<string>;
  viewedStateReady?: boolean;
  isChangedSinceViewed?: boolean;
  onToggleReviewed: (path: string) => void;
  collapsedFiles: Set<string>;
  onToggleCollapsed: (path: string) => void;
  onToggleAllCollapsed: (shouldCollapse: boolean) => void;
  onAddComment: (
    file: string,
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
  syntaxTheme?: AppearanceSettings['syntaxTheme'];
  baseCommitish?: string;
  targetCommitish?: string;
  /** The named review whose frozen capture the diff shows, absent for a live diff. */
  capture?: Pick<NamedReviewMetadata, 'name' | 'version'>;
  cursor?: CursorPosition | null;
  isFocused?: boolean;
  fileIndex?: number;
  mergedChunks: MergedChunk[];
  expandLines: (
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
  expandAllLines: (file: DiffFile) => Promise<void>;
  collapseExpandedLines: (file: DiffFile) => void;
  prefetchFileContent: (file: DiffFile) => Promise<void>;
  isExpandLoading: boolean;
  onLineClick?: (
    fileIndex: number,
    chunkIndex: number,
    lineIndex: number,
    side: 'left' | 'right',
  ) => void;
  commentTrigger?: {
    fileIndex: number;
    chunkIndex: number;
    lineIndex: number;
  } | null;
  onCommentTriggerHandled?: () => void;
  diffVersion?: number;
  // A jump to a line of this file that waits for the line to show (a comment link's
  // target); its hidden context opens the way a thread's does.
  pendingJump?: LineDraftAnchor | null;
}

type LineRange = { start: number; end: number };
type ChunkRange = LineRange & { index: number };
type Gap = {
  type: 'before' | 'between' | 'after';
  start: number;
  end: number;
  nextChunkIndex?: number;
  prevChunkIndex?: number;
};

// Line threads and unsent line drafts both need their lines shown.
interface CommentTarget {
  side: DiffSide;
  line: LineNumber;
}

const normalizeCommentRanges = (targets: CommentTarget[]): Record<DiffSide, LineRange[]> => {
  const ranges: Record<DiffSide, LineRange[]> = { old: [], new: [] };

  targets.forEach(({ side, line }) => {
    const [start, end] = Array.isArray(line) ? [line[0], line[1]] : [line, line];

    if (start <= 0 || end <= 0) return;

    ranges[side].push({
      start: Math.min(start, end),
      end: Math.max(start, end),
    });
  });

  return ranges;
};

const buildChunkRanges = (file: DiffFile, side: DiffSide): ChunkRange[] =>
  file.chunks
    .map((chunk, index) => {
      const start = side === 'old' ? chunk.oldStart : chunk.newStart;
      const lines = side === 'old' ? chunk.oldLines : chunk.newLines;
      if (!start || lines <= 0) return null;
      return { start, end: start + lines - 1, index };
    })
    .filter((range): range is ChunkRange => !!range);

const buildGaps = (ranges: ChunkRange[]): Gap[] => {
  const gaps: Gap[] = [];
  const firstRange = ranges[0];
  if (!firstRange) return gaps;

  if (firstRange.start > 1) {
    gaps.push({
      type: 'before',
      start: 1,
      end: firstRange.start - 1,
      nextChunkIndex: firstRange.index,
    });
  }

  for (let i = 1; i < ranges.length; i += 1) {
    const prev = ranges[i - 1];
    const current = ranges[i];
    if (!prev || !current) continue;
    if (current.start > prev.end + 1) {
      gaps.push({
        type: 'between',
        start: prev.end + 1,
        end: current.start - 1,
        prevChunkIndex: prev.index,
        nextChunkIndex: current.index,
      });
    }
  }

  const last = ranges[ranges.length - 1];
  if (!last) return gaps;
  gaps.push({
    type: 'after',
    start: last.end + 1,
    end: Number.POSITIVE_INFINITY,
    prevChunkIndex: last.index,
  });

  return gaps;
};

const buildMergedChunkIndex = (mergedChunks: MergedChunk[]) => {
  const mergedByFirstIndex = new Map<number, MergedChunk>();
  mergedChunks.forEach((chunk) => {
    const firstIndex = chunk.originalIndices[0];
    if (firstIndex !== undefined) {
      mergedByFirstIndex.set(firstIndex, chunk);
    }
  });
  return mergedByFirstIndex;
};

const getLastChunkIndex = (mergedChunks: MergedChunk[]): number | null => {
  const lastMerged = mergedChunks[mergedChunks.length - 1];
  const lastIndex = lastMerged?.originalIndices[lastMerged.originalIndices.length - 1];
  return lastIndex ?? null;
};

/** What a patch section with no hunks and no binary block changes, worded as GitHub does. */
const HEADER_ONLY_NOTES: Partial<Record<DiffFile['status'], string>> = {
  renamed: 'File renamed without changes.',
  copied: 'File copied without changes.',
  modified: 'File mode changed.',
};

export const DiffViewer = memo(function DiffViewer({
  file,
  threads,
  showAuthorBadges = false,
  diffMode,
  reviewedFiles,
  viewedStateReady = true,
  isChangedSinceViewed = false,
  onToggleReviewed,
  collapsedFiles,
  onToggleCollapsed,
  onToggleAllCollapsed,
  onAddComment,
  onGenerateThreadPrompt,
  onToggleThreadResolved,
  onRemoveThread,
  onRestoreComment,
  onReplyToThread,
  onRemoveMessage,
  onUpdateMessage,

  onOpenInEditor,
  syntaxTheme,
  baseCommitish,
  targetCommitish,
  capture,
  cursor = null,
  isFocused = false,
  fileIndex = 0,
  onLineClick,
  commentTrigger,
  onCommentTriggerHandled,
  mergedChunks,
  expandLines,
  expandAllBetweenChunks,
  expandAllLines,
  collapseExpandedLines,
  prefetchFileContent,
  isExpandLoading,
  diffVersion,
  pendingJump,
}: DiffViewerProps) {
  const isCollapsed = collapsedFiles.has(file.path);
  // Expanded context does not survive a reload or a review switch, so a line draft
  // that no chunk shows reopens its gap the way a thread does.
  const lineDraftAnchors = useLineDraftAnchors(file.path);
  const commentTargets = useMemo<CommentTarget[]>(
    () => [
      ...threads.flatMap((thread) =>
        thread.scope === 'review' ? [] : [{ side: thread.side ?? 'new', line: thread.line }],
      ),
      ...anchorsNotShown(lineDraftAnchors, mergedChunks).map((anchor) => ({
        side: anchor.side,
        line: anchor.lineNumber,
      })),
      ...(pendingJump ? [{ side: pendingJump.side, line: pendingJump.lineNumber }] : []),
    ],
    [threads, lineDraftAnchors, mergedChunks, pendingJump],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  const viewer = getViewerForFile(file);
  // A frozen capture holds only its patch, so no viewer can load lines outside it.
  const contextUnavailable = Boolean(capture);
  const canExpandHiddenLines = fileCanExpandHiddenLines(file, {
    contextUnavailable,
    baseCommitish,
    targetCommitish,
  });
  // -1 after the last hunk means the file length isn't known yet, so lines may still be hidden.
  const hasHiddenLines = mergedChunks.some(
    (chunk) => chunk.hiddenLinesBefore > 0 || chunk.hiddenLinesAfter !== 0,
  );
  const hasExpandedLines = mergedChunks.some((chunk) =>
    chunk.lines.some((line) => 'isExpanded' in line && line.isExpanded),
  );
  const fullFileToggle = !canExpandHiddenLines
    ? undefined
    : hasHiddenLines
      ? { expanded: false, onToggle: () => void expandAllLines(file) }
      : hasExpandedLines
        ? { expanded: true, onToggle: () => collapseExpandedLines(file) }
        : undefined;
  // Tokenize the whole file so embedded blocks (e.g. <script>/<style>) are
  // highlighted by their own language instead of line-by-line, which can't see
  // the surrounding context.
  const wholeFileHighlight = viewer.id === 'default' && isWholeFileHighlightExtension(file.path);

  // Observe visibility for lazy prefetch
  useEffect(() => {
    if (!canExpandHiddenLines) return;
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setIsVisible(true);
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [canExpandHiddenLines]);

  // Pre-fetch line counts (lightweight) only for visible, non-collapsed files that can expand
  useEffect(() => {
    if (isVisible && !isCollapsed && canExpandHiddenLines) {
      void prefetchFileContent(file);
    }
  }, [isVisible, isCollapsed, canExpandHiddenLines, file, prefetchFileContent]);

  const handleAddComment = useCallback(
    async (
      line: LineNumber,
      body: string,
      codeContent?: string,
      side?: DiffSide,
      options?: CommentSubmitOptions,
    ) => {
      // A failure reaches CommentForm, which keeps the text so the draft is not lost.
      await onAddComment(file.path, line, body, codeContent, side, options);
    },
    [file.path, onAddComment],
  );

  useEffect(() => {
    if (isCollapsed || isExpandLoading || !canExpandHiddenLines || commentTargets.length === 0) {
      return;
    }

    if (file.chunks.length === 0 || mergedChunks.length === 0) {
      return;
    }

    const commentRangesBySide = normalizeCommentRanges(commentTargets);
    const mergedByFirstIndex = buildMergedChunkIndex(mergedChunks);
    const lastChunkIndex = getLastChunkIndex(mergedChunks);
    const lastMerged = mergedChunks[mergedChunks.length - 1];

    const queued = new Set<string>();
    const queueExpand = (key: string, action: () => void) => {
      if (queued.has(key)) return;
      queued.add(key);
      action();
    };

    (['old', 'new'] as const).forEach((side) => {
      const commentRanges = commentRangesBySide[side];
      if (commentRanges.length === 0) return;

      const ranges = buildChunkRanges(file, side);
      const gaps = buildGaps(ranges);

      gaps.forEach((gap) => {
        const hasComment = commentRanges.some(
          (range) => range.start <= gap.end && range.end >= gap.start,
        );
        if (!hasComment) return;

        if (gap.type === 'after' && lastMerged && lastChunkIndex !== null) {
          if (lastMerged.hiddenLinesAfter > 0) {
            queueExpand(`after-${lastChunkIndex}`, () => {
              void expandLines(file, lastChunkIndex, 'down', lastMerged.hiddenLinesAfter);
            });
          }
          return;
        }

        const nextChunkIndex = gap.nextChunkIndex;
        if (nextChunkIndex === undefined) return;
        const mergedChunk = mergedByFirstIndex.get(nextChunkIndex);
        if (!mergedChunk || mergedChunk.hiddenLinesBefore <= 0) return;

        if (gap.type === 'before') {
          queueExpand(`before-${nextChunkIndex}`, () => {
            void expandLines(file, nextChunkIndex, 'up', mergedChunk.hiddenLinesBefore);
          });
        } else if (gap.type === 'between') {
          queueExpand(`between-${nextChunkIndex}`, () => {
            void expandAllBetweenChunks(file, nextChunkIndex, mergedChunk.hiddenLinesBefore);
          });
        }
      });
    });
  }, [
    commentTargets,
    expandAllBetweenChunks,
    expandLines,
    file,
    isCollapsed,
    isExpandLoading,
    mergedChunks,
    canExpandHiddenLines,
  ]);

  const fileLevelTokens = useFileLevelTokens({
    file,
    enabled: wholeFileHighlight && !contextUnavailable,
    baseCommitish,
    targetCommitish,
    reloadKey: diffVersion,
  });

  const lineNumberWidth = '4em';
  // A capture holds a binary file's bytes in its patch, or the IDs of its blobs, so the image
  // viewer can show it. Other viewers need whole files, which a capture does not hold, and a
  // text image such as an SVG has hunks instead of bytes, as does a symlink that a type change
  // turned into an image. An image that is only renamed, copied or changes mode has neither,
  // and the capture's base commit need not be the patch's base, so it gets a note.
  const imageWithoutHunks = viewer.id === 'image' && file.chunks.length === 0;
  const showsCapturedBytes = imageWithoutHunks && file.isBinary === true;
  const headerOnlyNote =
    contextUnavailable && imageWithoutHunks && !file.isBinary
      ? HEADER_ONLY_NOTES[file.status]
      : undefined;
  const ViewerComponent =
    contextUnavailable && !showsCapturedBytes ? TextDiffViewer : viewer.Component;
  const viewerProps: DiffViewerBodyProps = {
    file,
    threads,
    showAuthorBadges,
    diffMode,
    syntaxTheme,
    baseCommitish,
    targetCommitish,
    capture,
    cursor,
    fileIndex,
    mergedChunks,
    isExpandLoading,
    canExpandHiddenLines,
    expandHiddenLines: expandLines,
    expandAllBetweenChunks,
    onAddComment: handleAddComment,
    onGenerateThreadPrompt,
    onToggleThreadResolved,
    onRemoveThread,
    onRestoreComment,
    onReplyToThread,
    onRemoveMessage,
    onUpdateMessage,

    onOpenInEditor,
    onLineClick,
    commentTrigger,
    onCommentTriggerHandled,
  };

  return (
    <div
      ref={containerRef}
      className="bg-github-bg-primary"
      style={{ '--line-number-width': lineNumberWidth } as React.CSSProperties}
    >
      <DiffViewerHeader
        file={file}
        fullFileToggle={fullFileToggle}
        isCollapsed={isCollapsed}
        isFocused={isFocused}
        isReviewed={reviewedFiles.has(file.path)}
        viewedStateReady={viewedStateReady}
        isChangedSinceViewed={isChangedSinceViewed}
        onToggleCollapsed={onToggleCollapsed}
        onToggleAllCollapsed={onToggleAllCollapsed}
        onToggleReviewed={onToggleReviewed}
      />

      {!isCollapsed && (
        <FileLevelTokensProvider value={fileLevelTokens}>
          <div className="overflow-y-auto">
            {headerOnlyNote ? (
              <div className="p-4 text-github-text-muted text-sm">{headerOnlyNote}</div>
            ) : (
              <ViewerComponent {...viewerProps} />
            )}
          </div>
        </FileLevelTokensProvider>
      )}
    </div>
  );
});
