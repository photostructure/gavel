import type { CommentThread, DiffFile, DiffSide, LineNumber } from '../../../types/diff';
import type { CursorPosition } from '../../hooks/keyboardNavigation/types';

/**
 * Finds the position of a specific line number within a file's diff chunks
 * @param file The diff file to search in
 * @param fileIndex The index of the file in the files array
 * @param targetLineNumber The line number to find
 * @returns The cursor position including file, chunk, and line indices, or null if not found
 */
function findLinePosition(
  file: DiffFile,
  fileIndex: number,
  targetLineNumber: number,
  targetSide?: DiffSide,
): CursorPosition | null {
  for (let chunkIndex = 0; chunkIndex < file.chunks.length; chunkIndex++) {
    const chunk = file.chunks[chunkIndex];
    if (!chunk) continue;

    for (let lineIndex = 0; lineIndex < chunk.lines.length; lineIndex++) {
      const line = chunk.lines[lineIndex];
      if (!line) continue;

      const lineNumber =
        targetSide === 'old'
          ? line.oldLineNumber
          : targetSide === 'new'
            ? line.newLineNumber
            : (line.newLineNumber ?? line.oldLineNumber);
      if (lineNumber === targetLineNumber) {
        return {
          fileIndex,
          chunkIndex,
          lineIndex,
          side:
            targetSide === 'old'
              ? 'left'
              : targetSide === 'new'
                ? 'right'
                : line.newLineNumber
                  ? 'right'
                  : 'left',
        };
      }
    }
  }
  return null;
}

/**
 * Finds the cursor position for a specific comment within the diff files
 * @param comment The comment to find the position for
 * @param files The array of diff files to search in
 * @returns The cursor position including file, chunk, and line indices, or null if not found
 */
export function findCommentPosition(
  commentThread: CommentThread,
  files: DiffFile[],
): CursorPosition | null {
  if (commentThread.scope === 'review') return null;
  const fileIndex = files.findIndex((f) => f.path === commentThread.file);
  if (fileIndex === -1) return null;

  const file = files[fileIndex];
  if (!file) return null;

  const targetLineNumber = Array.isArray(commentThread.line)
    ? commentThread.line[1]
    : commentThread.line;
  const targetSide = commentThread.side;

  return (
    findLinePosition(file, fileIndex, targetLineNumber, targetSide) ||
    findLinePosition(file, fileIndex, targetLineNumber, 'new') ||
    findLinePosition(file, fileIndex, targetLineNumber, 'old')
  );
}

/**
 * Finds the cursor position of a line on one side only, for an unsent line draft.
 * A draft always has a side, so a line with the same number on the other side is a
 * different line, and findCommentPosition's fallback to it would jump to the wrong
 * place.
 */
export function findSidePosition(
  target: { file: string; line: LineNumber; side: DiffSide },
  files: DiffFile[],
): CursorPosition | null {
  const fileIndex = files.findIndex((f) => f.path === target.file);
  const file = files[fileIndex];
  if (!file) return null;
  const lineNumber = Array.isArray(target.line) ? target.line[1] : target.line;
  return findLinePosition(file, fileIndex, lineNumber, target.side);
}
