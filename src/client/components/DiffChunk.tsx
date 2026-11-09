import React, { useState, useEffect, useMemo, memo } from 'react';

import {
  type DiffChunk as DiffChunkType,
  type DiffLine,
  type DiffSide,
  type CommentThread,
  type CommentIntent,
  type LineNumber,
  type DiffViewMode,
  type LineSelection,
} from '../../types/diff';
import { DEFAULT_DIFF_VIEW_MODE } from '../../utils/diffMode';
import { type CursorPosition } from '../hooks/keyboardNavigation';
import { draftKey } from '../hooks/useCommentDrafts';
import { useLineRangeDrag } from '../hooks/useLineRangeDrag';
import {
  computeWordLevelDiff,
  shouldComputeWordDiff,
  type DiffSegment,
} from '../utils/wordLevelDiff';

import type { CommentSubmitOptions } from './CommentForm';
import { CommentThreadCard } from './CommentThreadCard';
import { DiffLineRow } from './DiffLineRow';
import {
  LineCommentComposer,
  isComposerFor,
  lineInTarget,
  lineShowsTarget,
  numberOn,
  shownCodeFor,
  useChunkComposers,
  useHoveredThread,
} from './LineCommentComposer';
import type { AppearanceSettings } from './SettingsModal';
import { SideBySideDiffChunk } from './SideBySideDiffChunk';

interface DiffChunkProps {
  chunk: DiffChunkType & { snapshotLines?: DiffLine[] };
  chunkIndex: number;
  threads: CommentThread[];
  showAuthorBadges?: boolean;
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

  mode?: DiffViewMode;
  syntaxTheme?: AppearanceSettings['syntaxTheme'];
  cursor?: CursorPosition | null;
  fileIndex?: number;
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
  filename: string;
  onOpenInEditor?: (filePath: string, lineNumber: number) => void;
}

export const DiffChunk = memo(function DiffChunk({
  chunk,
  chunkIndex,
  threads,
  showAuthorBadges = false,
  onAddComment,
  onGenerateThreadPrompt,
  onToggleThreadResolved,
  onRemoveThread,
  onRestoreComment,
  onReplyToThread,
  onRemoveMessage,
  onUpdateMessage,

  mode = DEFAULT_DIFF_VIEW_MODE,
  syntaxTheme,
  cursor = null,
  fileIndex = 0,
  onLineClick,
  commentTrigger,
  onCommentTriggerHandled,
  filename,
  onOpenInEditor,
}: DiffChunkProps) {
  const {
    dragRange,
    extendDrag,
    commentingLine,
    setCommentingLine,
    closeComposer,
    setSelectionAnchor,
    openShiftClickComment,
    handleCommentButtonMouseDown,
    handleLineNumberMouseDown,
  } = useLineRangeDrag();
  const { hoveredThreadTarget, threadHoverProps } = useHoveredThread(threads);
  const [hoveredLine, setHoveredLine] = useState<number | null>(null);

  // Handle comment trigger from keyboard navigation
  useEffect(() => {
    if (commentTrigger?.lineIndex !== undefined) {
      const line = chunk.lines[commentTrigger.lineIndex];
      if (line) {
        const lineNumber = line.newLineNumber || line.oldLineNumber;
        const side: DiffSide = line.type === 'delete' ? 'old' : 'new';
        if (lineNumber) {
          setCommentingLine({ side, lineNumber });
          onCommentTriggerHandled?.();
        }
      }
    }
  }, [commentTrigger, chunk.lines, onCommentTriggerHandled, setCommentingLine]);

  const handleRowClick = ({
    isShiftClick,
    lineIndex,
    navigationSide,
    selection,
  }: {
    isShiftClick: boolean;
    lineIndex: number;
    navigationSide: 'left' | 'right';
    selection: LineSelection | null;
  }) => {
    if (!selection) {
      onLineClick?.(fileIndex, chunkIndex, lineIndex, navigationSide);
      return;
    }

    if (isShiftClick) {
      openShiftClickComment(selection);
      return;
    }

    setSelectionAnchor(selection);
    onLineClick?.(fileIndex, chunkIndex, lineIndex, navigationSide);
  };

  const composers = useChunkComposers(filename, chunk.lines, commentingLine);
  const codeLines = chunk.snapshotLines ?? chunk.lines;

  const getThreadsForLine = (lineNumber: number, side: DiffSide) => {
    return threads
      .filter((thread) => {
        const lineMatches = Array.isArray(thread.line)
          ? thread.line[1] === lineNumber
          : thread.line === lineNumber;
        const sideMatches = !thread.side || thread.side === side;
        return lineMatches && sideMatches;
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  };

  const getCommentLayout = (line: DiffLine): 'left' | 'right' | 'full' => {
    // In unified mode, always use full width for comments
    if (mode === 'unified') {
      return 'full';
    }

    switch (line.type) {
      case 'delete':
        return 'left';
      case 'add':
        return 'right';
      default:
        return 'full';
    }
  };

  const getDragSelectionStyle = (line: DiffLine): string => {
    if (!dragRange) {
      return '';
    }

    const lineNumber = numberOn(line, dragRange.side);
    if (!lineNumber || lineNumber < dragRange.min || lineNumber > dragRange.max) {
      return '';
    }

    let classes = 'drag-selected';
    // Add top border for first line
    if (lineNumber === dragRange.min) {
      classes += ' drag-selected-first';
    }
    // Add bottom border for last line
    if (lineNumber === dragRange.max) {
      classes += ' drag-selected-last';
    }
    return classes;
  };

  // Compute word-level diff for unified mode
  // Maps line index to diff segments for that line
  const wordLevelDiffMap = useMemo(() => {
    const map = new Map<number, DiffSegment[]>();
    const lines = chunk.lines;

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line) {
        i++;
        continue;
      }

      if (line.type === 'delete') {
        // Look ahead for corresponding add lines
        let j = i + 1;
        while (j < lines.length && lines[j]?.type === 'delete') {
          j++;
        }

        const deleteLines = lines.slice(i, j);
        const deleteStartIndex = i;
        const addLines: { line: DiffLine; index: number }[] = [];

        while (j < lines.length && lines[j]?.type === 'add') {
          const addLine = lines[j];
          if (addLine) {
            addLines.push({ line: addLine, index: j });
          }
          j++;
        }

        // Pair delete and add lines and compute word-level diff
        const maxLines = Math.max(deleteLines.length, addLines.length);
        for (let k = 0; k < maxLines; k++) {
          const deleteLine = deleteLines[k];
          const addLineInfo = addLines[k];

          if (deleteLine && addLineInfo) {
            if (shouldComputeWordDiff(deleteLine.content, addLineInfo.line.content)) {
              const wordLevelDiff = computeWordLevelDiff(
                deleteLine.content,
                addLineInfo.line.content,
              );
              map.set(deleteStartIndex + k, wordLevelDiff.oldSegments);
              map.set(addLineInfo.index, wordLevelDiff.newSegments);
            }
          }
        }

        i = j;
      } else {
        i++;
      }
    }

    return map;
  }, [chunk.lines]);

  // Use side-by-side component for split mode
  if (mode === 'split') {
    return (
      <SideBySideDiffChunk
        chunk={chunk}
        chunkIndex={chunkIndex}
        threads={threads}
        showAuthorBadges={showAuthorBadges}
        onAddComment={onAddComment}
        onGenerateThreadPrompt={onGenerateThreadPrompt}
        onToggleThreadResolved={onToggleThreadResolved}
        onRemoveThread={onRemoveThread}
        onRestoreComment={onRestoreComment}
        onReplyToThread={onReplyToThread}
        onRemoveMessage={onRemoveMessage}
        onUpdateMessage={onUpdateMessage}
        onOpenInEditor={onOpenInEditor}
        syntaxTheme={syntaxTheme}
        cursor={cursor}
        fileIndex={fileIndex}
        onLineClick={onLineClick}
        filename={filename}
        commentTrigger={commentTrigger}
        onCommentTriggerHandled={onCommentTriggerHandled}
      />
    );
  }

  return (
    <div className="bg-github-bg-primary">
      <table className="w-full table-fixed border-collapse font-mono text-sm leading-5">
        <tbody>
          {chunk.lines.map((line, index) => {
            const lineComposers = composers.filter((anchor) => lineShowsTarget(line, anchor));

            // Determine which line number and side to use for fetching comments
            // Delete lines: use oldLineNumber and 'old' side
            // Add/normal lines: use newLineNumber and 'new' side
            const commentLineNumber =
              line.type === 'delete' ? line.oldLineNumber : line.newLineNumber;
            const commentSide: DiffSide = line.type === 'delete' ? 'old' : 'new';
            const lineThreads = commentLineNumber
              ? getThreadsForLine(commentLineNumber, commentSide)
              : [];
            // Generate ID for all lines to match the format used in useKeyboardNavigation
            const lineId = `file-${fileIndex}-chunk-${chunkIndex}-line-${index}`;
            const isCurrentLine =
              cursor && cursor.chunkIndex === chunkIndex && cursor.lineIndex === index;
            const selection = commentLineNumber
              ? { side: commentSide, lineNumber: commentLineNumber }
              : null;

            return (
              <React.Fragment key={index}>
                <DiffLineRow
                  line={line}
                  index={index}
                  lineId={lineId}
                  isCurrentLine={isCurrentLine || false}
                  hoveredLineIndex={hoveredLine}
                  selectedLineStyle={
                    getDragSelectionStyle(line) ||
                    // The lines of every open comment form, restored drafts included,
                    // and of the saved thread under the pointer
                    ([...composers, ...hoveredThreadTarget].some((target) =>
                      lineInTarget(line, target),
                    )
                      ? 'comment-selected'
                      : '')
                  }
                  onMouseEnter={() => {
                    setHoveredLine(index);
                  }}
                  onMouseLeave={() => setHoveredLine(null)}
                  onMouseMove={() => extendDrag(line)}
                  onCommentButtonMouseDown={(e) => handleCommentButtonMouseDown(e, selection)}
                  onLineNumberMouseDown={(e) => handleLineNumberMouseDown(e, selection)}
                  onOpenInEditor={
                    onOpenInEditor &&
                    line.type !== 'delete' &&
                    (line.newLineNumber || line.oldLineNumber)
                      ? () => {
                          const lineNumber = line.newLineNumber || line.oldLineNumber;
                          if (!lineNumber) return;
                          onOpenInEditor(filename, lineNumber);
                        }
                      : undefined
                  }
                  syntaxTheme={syntaxTheme}
                  filename={filename}
                  diffSegments={wordLevelDiffMap.get(index)}
                  onClick={(e) => {
                    // Determine the side based on line type for unified mode
                    const side = line.type === 'delete' ? 'left' : 'right';
                    if (e.shiftKey) {
                      e.preventDefault();
                    }
                    handleRowClick({
                      isShiftClick: e.shiftKey,
                      lineIndex: index,
                      navigationSide: side,
                      selection,
                    });
                  }}
                />

                {lineThreads.map((thread) => {
                  const layout = getCommentLayout(line);
                  return (
                    <tr key={thread.id} className="bg-github-bg-secondary">
                      <td colSpan={3} className="p-0 border-t border-github-border">
                        <div
                          className={`flex ${
                            layout === 'left'
                              ? 'justify-start'
                              : layout === 'right'
                                ? 'justify-end'
                                : 'justify-center'
                          }`}
                        >
                          <div
                            className={`${layout === 'full' ? 'w-full' : 'w-1/2'} m-2 mx-4`}
                            {...threadHoverProps(thread.id)}
                          >
                            <CommentThreadCard
                              thread={thread}
                              showAuthorBadges={showAuthorBadges}
                              onGeneratePrompt={onGenerateThreadPrompt}
                              onToggleThreadResolved={onToggleThreadResolved}
                              onRemoveThread={onRemoveThread}
                              onRestoreComment={onRestoreComment}
                              onReplyToThread={onReplyToThread}
                              onRemoveMessage={onRemoveMessage}
                              onUpdateMessage={onUpdateMessage}
                              syntaxTheme={syntaxTheme}
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {lineComposers.map((anchor) => (
                  <tr key={draftKey(anchor)} className="bg-[var(--bg-secondary)]">
                    <td colSpan={3} className="p-0">
                      <div
                        className={`flex ${
                          getCommentLayout(line) === 'left'
                            ? 'justify-start'
                            : getCommentLayout(line) === 'right'
                              ? 'justify-end'
                              : 'justify-center'
                        }`}
                      >
                        <div
                          className={`${getCommentLayout(line) === 'full' ? 'w-full' : 'w-1/2'}`}
                        >
                          <LineCommentComposer
                            anchor={anchor}
                            selectedCode={shownCodeFor(codeLines, anchor)}
                            syntaxTheme={syntaxTheme}
                            onSubmit={(body, options, code) =>
                              onAddComment(anchor.lineNumber, body, code, anchor.side, options)
                            }
                            onClose={() => closeComposer(anchor)}
                            autoFocus={isComposerFor(anchor, commentingLine)}
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});
