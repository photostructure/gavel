import type { DiffFile } from '../../../types/diff';
import { getCommentKey } from '../../utils/navigation/domHelpers';
import { hasContentOnSide } from '../../utils/navigation/lineHelpers';

import type { CommentNavigationItem, CursorPosition, ViewMode } from './types';

function hasCommentAtPosition(
  filePath: string,
  line: DiffFile['chunks'][number]['lines'][number],
  commentIndex: Map<string, CommentNavigationItem[]>,
): boolean {
  const keys: string[] = [];

  if (line.oldLineNumber !== undefined) {
    keys.push(getCommentKey(filePath, line.oldLineNumber, 'old'));
    keys.push(getCommentKey(filePath, line.oldLineNumber));
  }

  if (line.newLineNumber !== undefined) {
    keys.push(getCommentKey(filePath, line.newLineNumber, 'new'));
    keys.push(getCommentKey(filePath, line.newLineNumber));
  }

  return keys.some((key) => commentIndex.has(key));
}

/**
 * Creates navigation filters for different navigation targets
 */
export function createNavigationFilters(
  files: DiffFile[],
  commentIndex: Map<string, CommentNavigationItem[]>,
  viewMode: ViewMode,
  reviewedFiles?: Set<string>,
) {
  // Added files have no old-column lines and deleted files no new-column lines.
  const fileHasSide = (fileIndex: number, side: CursorPosition['side']): boolean =>
    files[fileIndex]?.chunks.some((chunk, chunkIndex) =>
      chunk.lines.some((_, lineIndex) =>
        hasContentOnSide({ fileIndex, chunkIndex, lineIndex, side }, files),
      ),
    ) ?? false;
  // Computed once: a lookup per line would rescan the file on every line it passes.
  const fileSides = files.map((_, fileIndex) => ({
    left: fileHasSide(fileIndex, 'left'),
    right: fileHasSide(fileIndex, 'right'),
  }));

  return {
    /**
     * Line navigation - navigates to lines with content on the current side
     * In unified mode, all lines are navigable
     * In split mode, only lines with content on the current side, unless the file has none
     * there; findNextMatchingPosition then moves the cursor to the other side
     * Skip lines in reviewed/collapsed files
     */
    line: (pos: CursorPosition): boolean => {
      const file = files[pos.fileIndex];
      if (!file) return false;

      // Skip if file is reviewed/collapsed
      if (reviewedFiles?.has(file.path)) return false;

      return (
        viewMode === 'unified' ||
        hasContentOnSide(pos, files) ||
        fileSides[pos.fileIndex]?.[pos.side] === false
      );
    },

    /**
     * Chunk navigation - navigates to the first line of each change chunk
     * Skips normal (unchanged) lines and finds boundaries between chunks
     * Skip chunks in reviewed/collapsed files
     */
    chunk: (pos: CursorPosition): boolean => {
      const file = files[pos.fileIndex];
      if (!file) return false;

      // Skip if file is reviewed/collapsed
      if (reviewedFiles?.has(file.path)) return false;

      const line = file.chunks[pos.chunkIndex]?.lines[pos.lineIndex];
      if (!line || line.type === 'normal') return false;

      // First line of a chunk is always a chunk boundary
      if (pos.lineIndex === 0) return true;

      // Check if previous line is normal (indicating start of a change chunk)
      const prevLine = file.chunks[pos.chunkIndex]?.lines[pos.lineIndex - 1];
      return !prevLine || prevLine.type === 'normal';
    },

    /**
     * Comment navigation - navigates to lines that have comments
     * Skip comments in reviewed/collapsed files
     */
    comment: (pos: CursorPosition): boolean => {
      const file = files[pos.fileIndex];
      if (!file) return false;

      // Skip if file is reviewed/collapsed
      if (reviewedFiles?.has(file.path)) return false;

      const line = file.chunks[pos.chunkIndex]?.lines[pos.lineIndex];
      if (!line) return false;

      return hasCommentAtPosition(file.path, line, commentIndex);
    },

    /**
     * File navigation - navigates to the first line of each file
     */
    file: (pos: CursorPosition): boolean => {
      return pos.chunkIndex === 0 && pos.lineIndex === 0;
    },
  };
}
