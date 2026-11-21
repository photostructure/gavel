import React, { useState, useEffect, useCallback, useMemo } from 'react';

import {
  type DiffChunk as DiffChunkType,
  type DiffLine,
  type DiffSide,
  type CommentThread,
  type LineNumber,
  type LineSelection,
} from '../../types/diff';
import { type CursorPosition } from '../hooks/keyboardNavigation';
import { draftKey } from '../hooks/useCommentDrafts';
import { useLineRangeDrag } from '../hooks/useLineRangeDrag';
import { pairChangedLines } from '../utils/chunkLinePairs';
import {
  computeWordLevelDiff,
  shouldComputeWordDiff,
  type WordLevelDiffResult,
} from '../utils/wordLevelDiff';
import { useFileLevelTokensLookup } from '../contexts/FileLevelTokensContext';

import { CommentButton } from './CommentButton';
import { CommentThreadCard } from './CommentThreadCard';
import { EnhancedPrismSyntaxHighlighter } from './EnhancedPrismSyntaxHighlighter';
import {
  LineCommentComposer,
  isComposerFor,
  lastLineOf,
  shownCodeFor,
  targetCovers,
  useChunkComposers,
  useHoveredThread,
} from './LineCommentComposer';
import { OpenInEditorButton } from './OpenInEditorButton';
import type { AppearanceSettings } from './SettingsModal';
import { WordLevelDiffHighlighter } from './WordLevelDiffHighlighter';

interface SideBySideDiffChunkProps {
  chunk: DiffChunkType & { snapshotLines?: DiffLine[] };
  chunkIndex: number;
  threads: CommentThread[];
  onAddComment: (
    line: LineNumber,
    body: string,
    codeContent?: string,
    side?: DiffSide,
  ) => Promise<void>;
  onGenerateThreadPrompt: (thread: CommentThread) => string;
  onToggleThreadResolved: (threadId: string) => void;
  onRemoveThread?: (threadId: string) => void;
  onRestoreComment?: (threadId: string, messageId?: string) => void;
  onReplyToThread: (threadId: string, body: string) => Promise<void>;
  onRemoveMessage: (threadId: string, messageId: string) => void;
  onUpdateMessage: (threadId: string, messageId: string, newBody: string) => void;

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

interface SideBySideLine {
  oldLine?: DiffLine;
  newLine?: DiffLine;
  oldLineNumber?: number;
  newLineNumber?: number;
  oldLineOriginalIndex?: number;
  newLineOriginalIndex?: number;
  wordLevelDiff?: WordLevelDiffResult;
}

interface ClickedLineTarget {
  selection: LineSelection;
  lineIndex: number;
  navigationSide: 'left' | 'right';
}

// Type guard to check if a line is an expanded line
const isExpandedLine = (line: DiffLine | undefined): boolean => {
  return line !== undefined && 'isExpanded' in line && line.isExpanded === true;
};

// Utility function to get split line class
const getSideBySideLineClass = (line: DiffLine | undefined, isExpanded: boolean): string => {
  if (isExpanded) {
    return 'bg-github-bg-tertiary/80';
  }
  if (line?.type === 'delete') {
    return 'bg-diff-deletion-bg';
  }
  if (line?.type === 'add') {
    return 'bg-diff-addition-bg';
  }
  if (line?.type === 'normal') {
    return 'bg-transparent';
  }
  return 'bg-github-bg-secondary';
};

const getClickedLineTarget = (
  target: HTMLElement,
  sideLine: SideBySideLine,
): ClickedLineTarget | null => {
  const isInOldSide = target.closest('td:nth-child(1)') || target.closest('td:nth-child(2)');
  if (isInOldSide) {
    if (
      !sideLine.oldLineNumber ||
      sideLine.oldLineOriginalIndex === undefined ||
      sideLine.oldLineOriginalIndex < 0
    ) {
      return null;
    }
    return {
      selection: {
        side: 'old',
        lineNumber: sideLine.oldLineNumber,
      },
      lineIndex: sideLine.oldLineOriginalIndex,
      navigationSide: 'left',
    };
  }

  const isInNewSide = target.closest('td:nth-child(3)') || target.closest('td:nth-child(4)');
  if (!isInNewSide) return null;

  if (
    !sideLine.newLineNumber ||
    sideLine.newLineOriginalIndex === undefined ||
    sideLine.newLineOriginalIndex < 0
  ) {
    return null;
  }
  return {
    selection: {
      side: 'new',
      lineNumber: sideLine.newLineNumber,
    },
    lineIndex: sideLine.newLineOriginalIndex,
    navigationSide: 'right',
  };
};

type TokensLookup = ReturnType<typeof useFileLevelTokensLookup>['getOldTokens'];

const getProcomputedTokens = (getTokens: TokensLookup, lineNumber: number | null | undefined) => {
  if (lineNumber == null) return null;
  const lineTokens = getTokens?.(lineNumber) ?? null;
  return lineTokens ? [lineTokens] : null;
};

interface SideBySideLineRowProps {
  sideLine: SideBySideLine;
  oldLineNavId: string | undefined;
  newLineNavId: string | undefined;
  highlightOldCell: boolean;
  highlightNewCell: boolean;
  oldSelectedStyle: string;
  newSelectedStyle: string;
  handleRowClick: (click: {
    isShiftClick: boolean;
    target: HTMLElement;
    sideLine: SideBySideLine;
  }) => void;
  extendDrag: (line: SideBySideLine) => void;
  handleLineNumberMouseDown: (e: React.MouseEvent, selection: LineSelection | null) => void;
  handleCommentButtonMouseDown: (e: React.MouseEvent, selection: LineSelection | null) => void;
  onOpenInEditor: ((filePath: string, lineNumber: number) => void) | undefined;
  filename: string;
  syntaxTheme: AppearanceSettings['syntaxTheme'] | undefined;
}

function SideBySideLineRow({
  sideLine,
  oldLineNavId,
  newLineNavId,
  highlightOldCell,
  highlightNewCell,
  oldSelectedStyle,
  newSelectedStyle,
  handleRowClick,
  extendDrag,
  handleLineNumberMouseDown,
  handleCommentButtonMouseDown,
  onOpenInEditor,
  filename,
  syntaxTheme,
}: SideBySideLineRowProps) {
  const { getOldTokens, getNewTokens } = useFileLevelTokensLookup();
  // Each row keeps its own hover state, so moving the pointer re-renders only the rows it
  // leaves and enters, not every row of a hunk that may hold thousands.
  const [hoveredSide, setHoveredSide] = useState<DiffSide | null>(null);
  const cellHighlightClass = 'keyboard-cursor';
  // A line-number cell is positioned only while it holds the line buttons, and a code
  // cell only while getSelectedLineStyle draws its overlay; see DiffLineRow for why.
  const showOldLineActions = hoveredSide === 'old';
  const showNewLineActions = hoveredSide === 'new';
  const oldSelection = sideLine.oldLineNumber
    ? {
        side: 'old' as const,
        lineNumber: sideLine.oldLineNumber,
      }
    : null;
  const newSelection = sideLine.newLineNumber
    ? {
        side: 'new' as const,
        lineNumber: sideLine.newLineNumber,
      }
    : null;
  // The pointer is on a side while it is over that side's line-number or code cell.
  const updateHoveredSide = (e: React.MouseEvent) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const isInOldSide = target.closest('td:nth-child(1)') || target.closest('td:nth-child(2)');
    const isInNewSide = target.closest('td:nth-child(3)') || target.closest('td:nth-child(4)');
    if (isInOldSide && sideLine.oldLineNumber) {
      setHoveredSide('old');
    } else if (isInNewSide && sideLine.newLineNumber) {
      setHoveredSide('new');
    }
  };

  return (
    <tr
      data-diff-line-row="true"
      className="group cursor-pointer"
      onClick={(e) => {
        const target = e.target;
        if (!(target instanceof HTMLElement)) return;
        if (e.shiftKey) {
          e.preventDefault();
        }
        handleRowClick({
          isShiftClick: e.shiftKey,
          target,
          sideLine,
        });
      }}
      onMouseEnter={updateHoveredSide}
      onMouseMove={(e) => {
        updateHoveredSide(e);
        extendDrag(sideLine);
      }}
      onMouseLeave={() => setHoveredSide(null)}
    >
      {/* Old side */}
      <td
        id={oldLineNavId}
        onMouseDown={(e) => handleLineNumberMouseDown(e, oldSelection)}
        className={`w-[var(--line-number-width)] min-w-[var(--line-number-width)] max-w-[var(--line-number-width)] px-2 text-right text-github-text-muted bg-github-bg-secondary border-r border-github-border select-none align-top overflow-visible ${showOldLineActions ? 'relative' : ''} ${highlightOldCell ? cellHighlightClass : ''}`}
      >
        <span>{sideLine.oldLineNumber || ''}</span>
        {showOldLineActions && (
          <>
            {onOpenInEditor &&
              sideLine.oldLine?.type !== 'delete' &&
              sideLine.newLineNumber !== undefined && (
                <OpenInEditorButton
                  onClick={() => {
                    const lineNumber = sideLine.newLineNumber;
                    if (lineNumber === undefined) return;
                    onOpenInEditor(filename, lineNumber);
                  }}
                />
              )}
            <CommentButton onMouseDown={(e) => handleCommentButtonMouseDown(e, oldSelection)} />
          </>
        )}
      </td>
      <td
        data-diff-side="old"
        className={`w-1/2 p-0 align-top border-r border-github-border ${getSideBySideLineClass(sideLine.oldLine, isExpandedLine(sideLine.oldLine))} ${oldSelectedStyle} ${highlightOldCell ? cellHighlightClass : ''}`}
      >
        {sideLine.oldLine && (
          <div className="flex items-center min-h-[20px] px-3">
            {sideLine.wordLevelDiff ? (
              <WordLevelDiffHighlighter
                segments={sideLine.wordLevelDiff.oldSegments}
                className="flex-1 text-github-text-primary whitespace-pre-wrap break-all overflow-wrap-break-word select-text"
              />
            ) : (
              <EnhancedPrismSyntaxHighlighter
                code={sideLine.oldLine.content}
                className="flex-1 text-github-text-primary whitespace-pre-wrap break-all overflow-wrap-break-word select-text [&_pre]:m-0 [&_pre]:p-0 [&_pre]:!bg-transparent [&_pre]:font-inherit [&_pre]:text-inherit [&_pre]:leading-inherit [&_code]:!bg-transparent [&_code]:font-inherit [&_code]:text-inherit [&_code]:leading-inherit"
                syntaxTheme={syntaxTheme}
                filename={filename}
                precomputedTokens={getProcomputedTokens(
                  getOldTokens,
                  sideLine.oldLine.oldLineNumber,
                )}
              />
            )}
          </div>
        )}
      </td>

      {/* New side */}
      <td
        id={newLineNavId}
        onMouseDown={(e) => handleLineNumberMouseDown(e, newSelection)}
        className={`w-[var(--line-number-width)] min-w-[var(--line-number-width)] max-w-[var(--line-number-width)] px-2 text-right text-github-text-muted bg-github-bg-secondary border-r border-github-border select-none align-top overflow-visible ${showNewLineActions ? 'relative' : ''} ${highlightNewCell ? cellHighlightClass : ''}`}
      >
        <span>{sideLine.newLineNumber || ''}</span>
        {showNewLineActions && (
          <>
            {onOpenInEditor && sideLine.newLineNumber !== undefined && (
              <OpenInEditorButton
                onClick={() => {
                  const lineNumber = sideLine.newLineNumber;
                  if (lineNumber === undefined) return;
                  onOpenInEditor(filename, lineNumber);
                }}
              />
            )}
            <CommentButton onMouseDown={(e) => handleCommentButtonMouseDown(e, newSelection)} />
          </>
        )}
      </td>
      <td
        data-diff-side="new"
        className={`w-1/2 p-0 align-top ${getSideBySideLineClass(sideLine.newLine, isExpandedLine(sideLine.newLine))} ${newSelectedStyle} ${highlightNewCell ? cellHighlightClass : ''}`}
      >
        {sideLine.newLine && (
          <div className="flex items-center min-h-[20px] px-3">
            {sideLine.wordLevelDiff ? (
              <WordLevelDiffHighlighter
                segments={sideLine.wordLevelDiff.newSegments}
                className="flex-1 text-github-text-primary whitespace-pre-wrap break-all overflow-wrap-break-word select-text"
              />
            ) : (
              <EnhancedPrismSyntaxHighlighter
                code={sideLine.newLine.content}
                className="flex-1 text-github-text-primary whitespace-pre-wrap break-all overflow-wrap-break-word select-text [&_pre]:m-0 [&_pre]:p-0 [&_pre]:!bg-transparent [&_pre]:font-inherit [&_pre]:text-inherit [&_pre]:leading-inherit [&_code]:!bg-transparent [&_code]:font-inherit [&_code]:text-inherit [&_code]:leading-inherit"
                syntaxTheme={syntaxTheme}
                filename={filename}
                precomputedTokens={getProcomputedTokens(
                  getNewTokens,
                  sideLine.newLine.newLineNumber,
                )}
              />
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

export function SideBySideDiffChunk({
  chunk,
  chunkIndex,
  threads,
  onAddComment,
  onGenerateThreadPrompt,
  onToggleThreadResolved,
  onRemoveThread,
  onRestoreComment,
  onReplyToThread,
  onRemoveMessage,
  onUpdateMessage,

  syntaxTheme,
  cursor = null,
  fileIndex = 0,
  onLineClick,
  commentTrigger,
  onCommentTriggerHandled,
  filename,
  onOpenInEditor,
}: SideBySideDiffChunkProps) {
  const {
    isDragging,
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

  // Handle comment trigger from keyboard navigation
  useEffect(() => {
    if (commentTrigger?.lineIndex !== undefined) {
      const line = chunk.lines[commentTrigger.lineIndex];
      if (line && line.type !== 'delete') {
        const lineNumber = line.newLineNumber;
        if (lineNumber) {
          setCommentingLine({ side: 'new', lineNumber });
          onCommentTriggerHandled?.();
        }
      }
    }
  }, [commentTrigger, chunk.lines, onCommentTriggerHandled, setCommentingLine]);

  const handleRowClick = ({
    isShiftClick,
    target,
    sideLine,
  }: {
    isShiftClick: boolean;
    target: HTMLElement;
    sideLine: SideBySideLine;
  }) => {
    if (isDragging) return;

    const clickedLine = getClickedLineTarget(target, sideLine);
    if (!clickedLine) return;

    if (isShiftClick) {
      openShiftClickComment(clickedLine.selection);
      return;
    }

    setSelectionAnchor(clickedLine.selection);
    onLineClick?.(fileIndex, chunkIndex, clickedLine.lineIndex, clickedLine.navigationSide);
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

  const getCommentLayout = (sideLine: SideBySideLine): 'left' | 'right' | 'full' => {
    // サイドバイサイドでは、削除行側（左）にコメントがある場合は左半分、
    // 追加行側（右）にコメントがある場合は右半分、
    // 変更なし行の場合は全幅で表示
    if (sideLine.oldLine?.type === 'delete' && sideLine.newLine?.type === 'add') {
      // 変更行の場合、newLineNumberを使って判定
      return sideLine.newLineNumber ? 'right' : 'left';
    }
    if (sideLine.oldLine?.type === 'delete') {
      return 'left';
    }
    if (sideLine.newLine?.type === 'add') {
      return 'right';
    }
    return 'full';
  };

  const getSelectedLineStyle = (side: DiffSide, sideLine: SideBySideLine): string => {
    const lineNumber = side === 'old' ? sideLine.oldLineNumber : sideLine.newLineNumber;
    if (!lineNumber) {
      return '';
    }

    // Show selection during drag
    if (dragRange?.side === side) {
      const { min, max } = dragRange;
      if (lineNumber >= min && lineNumber <= max) {
        let classes =
          'relative after:bg-blue-100 after:absolute after:inset-0 after:opacity-30 after:border-l-4 after:border-blue-500 after:pointer-events-none';
        // Add top border for first line
        if (lineNumber === min) {
          classes += ' after:border-t-2';
        }
        // Add bottom border for last line
        if (lineNumber === max) {
          classes += ' after:border-b-2';
        }
        return classes;
      }
    }

    // Show the lines of every open comment form, restored drafts included, and of
    // the saved thread under the pointer
    if ([...composers, ...hoveredThreadTarget].some((t) => targetCovers(t, side, lineNumber))) {
      return 'relative after:bg-diff-selected-bg after:absolute after:inset-0 after:border-l-5 after:border-l-diff-selected-border after:pointer-events-none';
    }

    return '';
  };

  // Convert unified diff to split format
  const convertToSideBySide = useCallback(
    (lines: DiffLine[]): SideBySideLine[] => {
      let oldLineNum = chunk.oldStart;
      let newLineNum = chunk.newStart;

      return pairChangedLines(lines).map(({ oldIndex, newIndex }) => {
        const oldLine = oldIndex === undefined ? undefined : lines[oldIndex];
        const newLine = newIndex === undefined ? undefined : lines[newIndex];

        // Compute word-level diff for a deleted line shown beside an added one
        let wordLevelDiff: WordLevelDiffResult | undefined;
        if (oldLine?.type === 'delete' && newLine) {
          if (shouldComputeWordDiff(oldLine.content, newLine.content)) {
            wordLevelDiff = computeWordLevelDiff(oldLine.content, newLine.content);
          }
        }

        const sideLine: SideBySideLine = {
          oldLine,
          newLine,
          oldLineNumber: oldLine ? (oldLine.oldLineNumber ?? oldLineNum) : undefined,
          newLineNumber: newLine ? (newLine.newLineNumber ?? newLineNum) : undefined,
          oldLineOriginalIndex: oldIndex,
          newLineOriginalIndex: newIndex,
          wordLevelDiff,
        };
        if (oldLine) oldLineNum++;
        if (newLine) newLineNum++;
        return sideLine;
      });
    },
    [chunk.oldStart, chunk.newStart],
  );

  const sideBySideLines = useMemo(
    () => convertToSideBySide(chunk.lines),
    [chunk.lines, convertToSideBySide],
  );

  return (
    <div className="bg-github-bg-primary overflow-hidden">
      <table className="w-full table-fixed border-collapse font-mono text-sm leading-5">
        <tbody>
          {sideBySideLines.map((sideLine, index) => {
            const oldThreads = sideLine.oldLineNumber
              ? getThreadsForLine(sideLine.oldLineNumber, 'old')
              : [];
            const newThreads = sideLine.newLineNumber
              ? getThreadsForLine(sideLine.newLineNumber, 'new')
              : [];
            const allThreads = [...oldThreads, ...newThreads];

            // Use the stored original indices
            const oldLineOriginalIndex = sideLine.oldLineOriginalIndex ?? -1;
            const newLineOriginalIndex = sideLine.newLineOriginalIndex ?? -1;

            // Check if the current side's line matches the cursor position
            const isHighlighted = (() => {
              if (!cursor) return false;

              // Only highlight the line on the current side
              if (cursor.side === 'left' && oldLineOriginalIndex >= 0) {
                return (
                  cursor.chunkIndex === chunkIndex && cursor.lineIndex === oldLineOriginalIndex
                );
              } else if (cursor.side === 'right' && newLineOriginalIndex >= 0) {
                return (
                  cursor.chunkIndex === chunkIndex && cursor.lineIndex === newLineOriginalIndex
                );
              }

              return false;
            })();

            // Generate IDs for navigation with side suffix
            const oldLineNavId =
              oldLineOriginalIndex >= 0
                ? `file-${fileIndex}-chunk-${chunkIndex}-line-${oldLineOriginalIndex}-left`
                : undefined;
            const newLineNavId =
              newLineOriginalIndex >= 0
                ? `file-${fileIndex}-chunk-${chunkIndex}-line-${newLineOriginalIndex}-right`
                : undefined;

            // Determine which cell to highlight
            const highlightOldCell = isHighlighted && cursor?.side === 'left';
            const highlightNewCell = isHighlighted && cursor?.side === 'right';

            return (
              <React.Fragment key={index}>
                <SideBySideLineRow
                  sideLine={sideLine}
                  oldLineNavId={oldLineNavId}
                  newLineNavId={newLineNavId}
                  highlightOldCell={highlightOldCell}
                  highlightNewCell={highlightNewCell}
                  oldSelectedStyle={getSelectedLineStyle('old', sideLine)}
                  newSelectedStyle={getSelectedLineStyle('new', sideLine)}
                  handleRowClick={handleRowClick}
                  extendDrag={extendDrag}
                  handleLineNumberMouseDown={handleLineNumberMouseDown}
                  handleCommentButtonMouseDown={handleCommentButtonMouseDown}
                  onOpenInEditor={onOpenInEditor}
                  filename={filename}
                  syntaxTheme={syntaxTheme}
                />

                {/* Comment threads row */}
                {allThreads.length > 0 && (
                  <tr className="bg-github-bg-secondary">
                    <td colSpan={4} className="p-0 border-t border-github-border">
                      {allThreads.map((thread) => {
                        const threadSide = thread.side || 'new';
                        let layout: 'left' | 'right' | 'full';

                        if (threadSide === 'old' && sideLine.oldLineNumber) {
                          layout = 'left';
                        } else if (threadSide === 'new' && sideLine.newLineNumber) {
                          layout = 'right';
                        } else {
                          layout = getCommentLayout(sideLine);
                        }

                        return (
                          <div
                            key={thread.id}
                            className={`flex ${
                              layout === 'left'
                                ? 'justify-start'
                                : layout === 'right'
                                  ? 'justify-end'
                                  : 'justify-center'
                            }`}
                          >
                            <div className={`${layout === 'full' ? 'w-full' : 'w-1/2'}`}>
                              <div className="m-2 mx-3" {...threadHoverProps(thread.id)}>
                                <CommentThreadCard
                                  thread={thread}
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
                          </div>
                        );
                      })}
                    </td>
                  </tr>
                )}

                {/* Comment form row */}
                {composers
                  .filter(
                    (anchor) =>
                      lastLineOf(anchor.lineNumber) ===
                      (anchor.side === 'old' ? sideLine.oldLineNumber : sideLine.newLineNumber),
                  )
                  .map((anchor) => (
                    <tr key={draftKey(anchor)} className="bg-github-bg-secondary">
                      <td colSpan={4} className="p-0">
                        <div
                          className={`flex ${anchor.side === 'old' ? 'justify-start' : 'justify-end'}`}
                        >
                          <div className={`w-1/2`}>
                            <LineCommentComposer
                              anchor={anchor}
                              selectedCode={shownCodeFor(codeLines, anchor)}
                              syntaxTheme={syntaxTheme}
                              onSubmit={(body, code) =>
                                onAddComment(anchor.lineNumber, body, code, anchor.side)
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
}
