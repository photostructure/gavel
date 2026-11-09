import { useCallback, useEffect, useState, type MouseEvent } from 'react';

import type { DiffLine, DiffSide, LineNumber, LineSelection } from '../../types/diff';
import { isComposerFor, numberOn, type LineTarget } from '../components/LineCommentComposer';

import type { LineDraftAnchor } from './useCommentDrafts';

interface LineDrag {
  side: DiffSide;
  startLine: number;
  endLine: number;
  fromLineNumber: boolean;
}

// How a diff chunk picks the lines of a comment: dragging, Shift-clicking from the
// last clicked line, and which comment form that selection opened.
export function useLineRangeDrag() {
  const [drag, setDrag] = useState<LineDrag | null>(null);
  const [commentingLine, setCommentingLine] = useState<LineTarget | null>(null);
  const [selectionAnchor, setSelectionAnchor] = useState<LineSelection | null>(null);

  const toggleComposer = useCallback(
    (side: DiffSide, lineNumber: LineNumber) => {
      if (commentingLine?.side === side && commentingLine?.lineNumber === lineNumber) {
        setCommentingLine(null);
      } else {
        setCommentingLine({ side, lineNumber });
      }
    },
    [commentingLine],
  );

  const closeComposer = useCallback((anchor: LineDraftAnchor) => {
    setCommentingLine((current) => (isComposerFor(anchor, current) ? null : current));
  }, []);

  const getCommentLineFromAnchor = (selection: LineSelection): LineNumber => {
    if (!selectionAnchor || selectionAnchor.side !== selection.side) {
      return selection.lineNumber;
    }

    const min = Math.min(selectionAnchor.lineNumber, selection.lineNumber);
    const max = Math.max(selectionAnchor.lineNumber, selection.lineNumber);
    return min === max ? selection.lineNumber : [min, max];
  };

  const openShiftClickComment = (selection: LineSelection) => {
    toggleComposer(selection.side, getCommentLineFromAnchor(selection));
    setSelectionAnchor(selection);
  };

  const startDrag = (selection: LineSelection, fromLineNumber: boolean) => {
    setSelectionAnchor(selection);
    setDrag({
      side: selection.side,
      startLine: selection.lineNumber,
      endLine: selection.lineNumber,
      fromLineNumber,
    });
  };

  const handleCommentButtonMouseDown = (e: MouseEvent, selection: LineSelection | null) => {
    e.stopPropagation();
    if (e.shiftKey) {
      e.preventDefault();
    }
    if (!selection) return;

    if (e.shiftKey) {
      openShiftClickComment(selection);
      return;
    }

    startDrag(selection, false);
  };

  const handleLineNumberMouseDown = (e: MouseEvent, selection: LineSelection | null) => {
    // The row's click handles Shift, and needs the earlier anchor left in place. A
    // right press, or Ctrl on macOS, opens the context menu, which can swallow mouseup.
    if (selection && e.button === 0 && !e.ctrlKey && !e.shiftKey) {
      startDrag(selection, true);
    }
  };

  // A row with no number on the drag's side does not move the end of the range.
  const extendDrag = (line: Pick<DiffLine, 'oldLineNumber' | 'newLineNumber'>) => {
    setDrag((current) => {
      if (!current) return current;
      const lineNumber = numberOn(line, current.side);
      return lineNumber && lineNumber !== current.endLine
        ? { ...current, endLine: lineNumber }
        : current;
    });
  };

  // Commit the selection wherever the mouse is released, not only on the comment
  // button itself
  useEffect(() => {
    if (!drag) {
      return undefined;
    }

    const handleGlobalMouseUp = () => {
      // Defer so the click event fired after mouseup doesn't immediately
      // close the newly opened (still empty) comment form
      setTimeout(() => {
        const min = Math.min(drag.startLine, drag.endLine);
        const max = Math.max(drag.startLine, drag.endLine);
        // A line number pressed and released in place is a click, which moves the
        // cursor; the comment button opens a form even without a drag.
        if (min !== max || !drag.fromLineNumber) {
          toggleComposer(drag.side, min === max ? min : [min, max]);
        }
        setDrag(null);
      }, 0);
    };

    document.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      document.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [drag, toggleComposer]);

  return {
    // A press on a line number is not a drag until it reaches another line.
    isDragging: drag !== null && (!drag.fromLineNumber || drag.startLine !== drag.endLine),
    dragRange: drag && {
      side: drag.side,
      min: Math.min(drag.startLine, drag.endLine),
      max: Math.max(drag.startLine, drag.endLine),
    },
    extendDrag,
    commentingLine,
    setCommentingLine,
    closeComposer,
    setSelectionAnchor,
    openShiftClickComment,
    handleCommentButtonMouseDown,
    handleLineNumberMouseDown,
  };
}
