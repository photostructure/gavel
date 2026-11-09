import React, { useState, useEffect, useCallback, useMemo, memo } from 'react';

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
import { draftKey, type LineDraftAnchor } from '../hooks/useCommentDrafts';
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
  shownCodeFor,
  useChunkComposers,
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
  const [startLine, setStartLine] = useState<number | null>(null);
  const [endLine, setEndLine] = useState<number | null>(null);
  const [dragSide, setDragSide] = useState<DiffSide | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [commentingLine, setCommentingLine] = useState<{
    side: DiffSide;
    lineNumber: LineNumber;
  } | null>(null);
  const [selectionAnchor, setSelectionAnchor] = useState<{
    side: DiffSide;
    lineNumber: number;
  } | null>(null);
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
  }, [commentTrigger, chunk.lines, onCommentTriggerHandled]);

  const handleAddComment = useCallback(
    (side: DiffSide, lineNumber: LineNumber) => {
      if (commentingLine?.side === side && commentingLine?.lineNumber === lineNumber) {
        setCommentingLine(null);
      } else {
        setCommentingLine({ side, lineNumber });
      }
    },
    [commentingLine],
  );

  const getCommentLineFromAnchor = (selection: LineSelection): LineNumber => {
    if (!selectionAnchor || selectionAnchor.side !== selection.side) {
      return selection.lineNumber;
    }

    const min = Math.min(selectionAnchor.lineNumber, selection.lineNumber);
    const max = Math.max(selectionAnchor.lineNumber, selection.lineNumber);
    return min === max ? selection.lineNumber : [min, max];
  };

  const openShiftClickComment = (selection: LineSelection) => {
    handleAddComment(selection.side, getCommentLineFromAnchor(selection));
    setSelectionAnchor(selection);
  };

  const startCommentDrag = (selection: LineSelection) => {
    setSelectionAnchor(selection);
    setStartLine(selection.lineNumber);
    setEndLine(selection.lineNumber);
    setDragSide(selection.side);
    setIsDragging(true);
  };

  const handleCommentButtonMouseDown = ({
    isShiftClick,
    selection,
  }: {
    isShiftClick: boolean;
    selection: LineSelection | null;
  }) => {
    if (!selection) return;

    if (isShiftClick) {
      openShiftClickComment(selection);
      return;
    }

    startCommentDrag(selection);
  };

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

  // Global mouse up handler for drag selection: commit the selection wherever
  // the mouse is released, not only on the comment button itself
  useEffect(() => {
    if (!isDragging) {
      return undefined;
    }

    const handleGlobalMouseUp = () => {
      // Defer so the click event fired after mouseup doesn't immediately
      // close the newly opened (still empty) comment form
      setTimeout(() => {
        if (startLine && dragSide) {
          const actualEndLine = endLine ?? startLine;
          if (startLine === actualEndLine) {
            handleAddComment(dragSide, startLine);
          } else {
            const min = Math.min(startLine, actualEndLine);
            const max = Math.max(startLine, actualEndLine);
            handleAddComment(dragSide, [min, max]);
          }
        }
        setIsDragging(false);
        setStartLine(null);
        setEndLine(null);
        setDragSide(null);
      }, 0);
    };

    document.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      document.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDragging, startLine, endLine, dragSide, handleAddComment]);

  const composers = useChunkComposers(filename, chunk.lines, commentingLine);
  const codeLines = chunk.snapshotLines ?? chunk.lines;
  const closeComposer = useCallback((anchor: LineDraftAnchor) => {
    setCommentingLine((current) => (isComposerFor(anchor, current) ? null : current));
  }, []);

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

  const getDragSelectionStyle = (lineNumber: number | undefined): string => {
    if (!lineNumber) {
      return '';
    }

    // Show selection during drag
    if (isDragging && startLine && endLine) {
      const min = Math.min(startLine, endLine);
      const max = Math.max(startLine, endLine);
      if (lineNumber >= min && lineNumber <= max) {
        let classes = 'drag-selected';
        // Add top border for first line
        if (lineNumber === min) {
          classes += ' drag-selected-first';
        }
        // Add bottom border for last line
        if (lineNumber === max) {
          classes += ' drag-selected-last';
        }
        return classes;
      }
    }

    return '';
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
            const dragLineNumber = dragSide === 'old' ? line.oldLineNumber : line.newLineNumber;

            return (
              <React.Fragment key={index}>
                <DiffLineRow
                  line={line}
                  index={index}
                  lineId={lineId}
                  isCurrentLine={isCurrentLine || false}
                  hoveredLineIndex={hoveredLine}
                  selectedLineStyle={
                    getDragSelectionStyle(dragLineNumber) ||
                    // The lines of every open comment form, restored drafts included
                    (composers.some((anchor) => lineInTarget(line, anchor))
                      ? 'comment-selected'
                      : '')
                  }
                  onMouseEnter={() => {
                    setHoveredLine(index);
                  }}
                  onMouseLeave={() => setHoveredLine(null)}
                  onMouseMove={() => {
                    if (isDragging && startLine && dragLineNumber) {
                      setEndLine(dragLineNumber);
                    }
                  }}
                  onCommentButtonMouseDown={(e) => {
                    e.stopPropagation();
                    if (e.shiftKey) {
                      e.preventDefault();
                    }
                    handleCommentButtonMouseDown({
                      isShiftClick: e.shiftKey,
                      selection,
                    });
                  }}
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
                          <div className={`${layout === 'full' ? 'w-full' : 'w-1/2'} m-2 mx-4`}>
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
