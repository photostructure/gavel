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
  return viewers.find((viewer) => viewer.match(file)) ?? fallback;
};

/** Whether hidden context around `file`'s hunks can be loaded and shown. */
export function fileCanExpandHiddenLines(
  file: DiffFile,
  source: { baseCommitish?: string; targetCommitish?: string },
): boolean {
  const hasBlobContent =
    !file.contextUnavailable &&
    source.baseCommitish !== 'stdin' &&
    source.targetCommitish !== 'stdin';
  // The server refuses a non-UTF-8 path, so an expansion would fill the gap with blank rows.
  return (
    hasBlobContent &&
    !file.hasNonUtf8Path &&
    (getViewerForFile(file).canExpandHiddenLines?.(file) ?? false)
  );
}
