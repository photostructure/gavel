import React from 'react';

import { DiffChunk } from '../components/DiffChunk';
import { ExpandButton } from '../components/ExpandButton';
import {
  anchorsNotShown,
  describeLines,
  LineCommentComposer,
} from '../components/LineCommentComposer';
import { draftKey, useLineDraftAnchors } from '../hooks/useCommentDrafts';
import type { PresentationChunk } from '../utils/ignoreWhitespace';

import type { DiffViewerBodyProps } from './types';

export function TextDiffViewer({
  file,
  threads,
  showAuthorBadges,
  diffMode,
  syntaxTheme,
  cursor,
  fileIndex,
  mergedChunks,
  isExpandLoading,
  canExpandHiddenLines = true,
  expandHiddenLines,
  expandAllBetweenChunks,
  onAddComment,
  onGenerateThreadPrompt,
  onToggleThreadResolved,
  onRemoveThread,
  onRestoreComment,
  onReplyToThread,
  onRemoveMessage,
  onUpdateMessage,

  onLineClick,
  onOpenInEditor,
  commentTrigger,
  onCommentTriggerHandled,
}: DiffViewerBodyProps) {
  const lineDraftAnchors = useLineDraftAnchors(file.path);
  const renderExpandButton = (
    position: 'top' | 'middle' | 'bottom',
    mergedChunk: (typeof mergedChunks)[number],
    firstOriginalIndex: number,
    lastOriginalIndex: number,
  ) => {
    if (!canExpandHiddenLines) {
      const hiddenLines =
        position === 'bottom' ? mergedChunk.hiddenLinesAfter : mergedChunk.hiddenLinesBefore;
      return hiddenLines > 0 ? (
        <div className="border-y border-github-border bg-github-bg-tertiary px-3 py-1.5 text-xs text-github-text-muted">
          {hiddenLines} {hiddenLines === 1 ? 'line' : 'lines'} outside this patch
        </div>
      ) : null;
    }
    if (position === 'top' && mergedChunk.hiddenLinesBefore > 0) {
      return (
        <ExpandButton
          direction="up"
          hiddenLines={mergedChunk.hiddenLinesBefore}
          onExpandUp={() => expandHiddenLines(file, firstOriginalIndex, 'up')}
          onExpandAll={() =>
            expandAllBetweenChunks(file, firstOriginalIndex, mergedChunk.hiddenLinesBefore)
          }
          isLoading={isExpandLoading}
        />
      );
    }

    if (position === 'middle' && mergedChunk.hiddenLinesBefore > 0) {
      return (
        <ExpandButton
          direction="both"
          hiddenLines={mergedChunk.hiddenLinesBefore}
          onExpandDown={() => expandHiddenLines(file, firstOriginalIndex - 1, 'down')}
          onExpandUp={() => expandHiddenLines(file, firstOriginalIndex, 'up')}
          onExpandAll={() =>
            expandAllBetweenChunks(file, firstOriginalIndex, mergedChunk.hiddenLinesBefore)
          }
          isLoading={isExpandLoading}
        />
      );
    }

    if (position === 'bottom' && mergedChunk.hiddenLinesAfter > 0) {
      return (
        <ExpandButton
          direction="down"
          hiddenLines={mergedChunk.hiddenLinesAfter}
          onExpandDown={() => expandHiddenLines(file, lastOriginalIndex, 'down')}
          onExpandAll={() =>
            expandHiddenLines(file, lastOriginalIndex, 'down', mergedChunk.hiddenLinesAfter)
          }
          isLoading={isExpandLoading}
        />
      );
    }

    return null;
  };

  // A draft whose line no chunk shows stays at the top of its file: a later capture
  // dropped the line, its context cannot be expanded here (DiffViewer expands the
  // gaps that hold drafts when it can), or whitespace hiding hides it.
  const strandedDrafts = anchorsNotShown(lineDraftAnchors, mergedChunks);

  return (
    <div
      className="split-diff-selection"
      onPointerDownCapture={(event) => {
        // Apply before the browser starts its native text selection. Keep the
        // opposite column unselectable across every hunk in this file.
        const cell =
          event.target instanceof Element
            ? event.target.closest<HTMLElement>('[data-diff-side]')
            : null;
        if (cell?.dataset.diffSide) {
          event.currentTarget.dataset.selectionSide = cell.dataset.diffSide;
        } else {
          delete event.currentTarget.dataset.selectionSide;
        }
      }}
    >
      {strandedDrafts.map((anchor) => (
        <LineCommentComposer
          key={draftKey(anchor)}
          anchor={anchor}
          syntaxTheme={syntaxTheme}
          title={`Comment on ${describeLines(anchor)}, which is not shown here`}
          autoFocus={false}
          onSubmit={(body, options, code) =>
            onAddComment(anchor.lineNumber, body, code, anchor.side, options)
          }
          onClose={() => {}}
        />
      ))}
      {mergedChunks.map((mergedChunk, mergedIndex) => {
        const isFirstMerged = mergedIndex === 0;
        const isLastMerged = mergedIndex === mergedChunks.length - 1;
        const firstOriginalIndex = mergedChunk.originalIndices[0] ?? 0;
        const lastOriginalIndex =
          mergedChunk.originalIndices[mergedChunk.originalIndices.length - 1] ?? 0;

        return (
          <React.Fragment key={mergedIndex}>
            {isFirstMerged &&
              renderExpandButton('top', mergedChunk, firstOriginalIndex, lastOriginalIndex)}

            {!isFirstMerged &&
              renderExpandButton('middle', mergedChunk, firstOriginalIndex, lastOriginalIndex)}

            <div id={`chunk-${file.path.replace(/[^a-zA-Z0-9]/g, '-')}-${mergedIndex}`}>
              {(mergedChunk as PresentationChunk).snapshotLines && (
                <div className="border-y border-github-border bg-github-bg-tertiary px-3 py-1.5 text-xs text-github-text-muted">
                  Whitespace-only changes hidden
                </div>
              )}
              <DiffChunk
                chunk={mergedChunk}
                chunkIndex={mergedIndex}
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
                mode={diffMode}
                syntaxTheme={syntaxTheme}
                cursor={cursor && cursor.chunkIndex === mergedIndex ? cursor : null}
                fileIndex={fileIndex}
                onLineClick={onLineClick}
                commentTrigger={
                  commentTrigger && commentTrigger.chunkIndex === mergedIndex
                    ? commentTrigger
                    : null
                }
                onCommentTriggerHandled={onCommentTriggerHandled}
                filename={file.path}
              />
            </div>

            {isLastMerged &&
              renderExpandButton('bottom', mergedChunk, firstOriginalIndex, lastOriginalIndex)}
          </React.Fragment>
        );
      })}
    </div>
  );
}
