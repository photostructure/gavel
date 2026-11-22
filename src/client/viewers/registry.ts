import type { DiffFile } from '../../types/diff';
import { isImageFile, isVideoFile } from '../utils/imageUtils';
import { isMarkdownFile } from '../utils/markdownUtils';
import { isNotebookFile } from '../utils/notebookUtils';

import { ImageDiffViewer } from './ImageDiffViewer';
import { MarkdownDiffViewer } from './MarkdownDiffViewer';
import { NotebookDiffViewer } from './NotebookDiffViewer';
import { TextDiffViewer } from './TextDiffViewer';
import type { DiffViewerRegistration } from './types';

const viewers: DiffViewerRegistration[] = [
  {
    id: 'image',
    match: (file) => isImageFile(file.path) || isVideoFile(file.path),
    Component: ImageDiffViewer,
    canExpandHiddenLines: () => false,
  },
  {
    id: 'markdown',
    match: (file) => isMarkdownFile(file.path),
    Component: MarkdownDiffViewer,
    canExpandHiddenLines: (file) => file.status !== 'added' && file.status !== 'deleted',
  },
  {
    id: 'notebook',
    match: (file) => isNotebookFile(file.path),
    Component: NotebookDiffViewer,
    canExpandHiddenLines: (file) => file.status !== 'added' && file.status !== 'deleted',
  },
  {
    id: 'default',
    match: () => true,
    Component: TextDiffViewer,
    canExpandHiddenLines: (file) => file.status !== 'added' && file.status !== 'deleted',
  },
];

export const getViewerForFile = (file: DiffFile): DiffViewerRegistration => {
  const fallback = viewers[viewers.length - 1];
  if (!fallback) {
    throw new Error('No diff viewers registered');
  }
  // The image, Markdown and notebook viewers read whole files by Git ref, which an unmerged
  // path does not have.
  if (file.conflicted) return fallback;
  return viewers.find((viewer) => viewer.match(file)) ?? fallback;
};

/**
 * Whether the server can send each side of `file` as a whole file. A piped diff and a conflicted
 * file have no blobs to read, a named review may be unable to rebuild a file, and the server
 * refuses a non-UTF-8 path.
 */
export function fileSidesReadable(
  file: DiffFile,
  source: { baseCommitish?: string; targetCommitish?: string },
): boolean {
  return (
    !file.contextUnavailable &&
    !file.conflicted &&
    !file.hasNonUtf8Path &&
    source.baseCommitish !== 'stdin' &&
    source.targetCommitish !== 'stdin'
  );
}

/** Whether hidden context around `file`'s hunks can be loaded and shown. */
export function fileCanExpandHiddenLines(
  file: DiffFile,
  source: { baseCommitish?: string; targetCommitish?: string },
): boolean {
  return (
    fileSidesReadable(file, source) &&
    (getViewerForFile(file).canExpandHiddenLines?.(file) ?? false)
  );
}
