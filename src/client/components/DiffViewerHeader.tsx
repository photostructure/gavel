import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FileDiff,
  FilePen,
  FilePlus,
  Files,
  FileX,
  FoldVertical,
  Square,
  UnfoldVertical,
} from 'lucide-react';
import { type MouseEvent, useState } from 'react';

import type { DiffFile } from '../../types/diff';
import { copyTextToClipboard } from '../utils/clipboard';
import { isDisclosureRowClick } from '../utils/domUtils';

interface FullFileToggle {
  expanded: boolean;
  onToggle: () => void;
}

interface DiffViewerHeaderProps {
  file: DiffFile;
  fullFileToggle?: FullFileToggle;
  isCollapsed: boolean;
  isFocused?: boolean;
  isReviewed: boolean;
  viewedStateReady?: boolean;
  isChangedSinceViewed?: boolean;
  onToggleCollapsed: (path: string) => void;
  onToggleAllCollapsed: (shouldCollapse: boolean) => void;
  onToggleReviewed: (path: string) => void;
  /** Opens the file in the configured editor; absent when there is no editor or file. */
  onOpenInEditor?: () => void;
}

const getFileIcon = (status: DiffFile['status']) => {
  switch (status) {
    case 'added':
      return <FilePlus size={16} className="text-github-accent-text" />;
    case 'deleted':
      return <FileX size={16} className="text-github-danger" />;
    case 'renamed':
      return <FilePen size={16} className="text-github-warning" />;
    case 'copied':
      return <Files size={16} className="text-github-warning" />;
    default:
      return <FileDiff size={16} className="text-github-text-secondary" />;
  }
};

// The row toggles collapse on any click outside a button, so each button's
// clickable area extends 0.5rem past its edges, into the gaps beside it, through an
// invisible ::after overlay.
const HIT_SLOP = 'relative after:absolute after:-inset-2';

export const DiffViewerHeader = ({
  file,
  fullFileToggle,
  isCollapsed,
  isFocused = false,
  isReviewed,
  viewedStateReady = true,
  isChangedSinceViewed = false,
  onToggleCollapsed,
  onToggleAllCollapsed,
  onToggleReviewed,
  onOpenInEditor,
}: DiffViewerHeaderProps) => {
  const [isCopied, setIsCopied] = useState(false);

  const toggleCollapsed = (e: MouseEvent) => {
    if (e.altKey) {
      // When Alt+clicking, collapse all if this file is expanded, expand all if collapsed
      onToggleAllCollapsed(!isCollapsed);
    } else {
      onToggleCollapsed(file.path);
    }
  };

  const toggleLabel = isCollapsed
    ? 'Expand file (Alt+Click to expand all)'
    : 'Collapse file (Alt+Click to collapse all)';

  return (
    <div
      data-diff-viewer-header="true"
      title={toggleLabel}
      onClick={(e) => {
        if (isDisclosureRowClick(e.target)) toggleCollapsed(e);
      }}
      className={`bg-github-bg-secondary border-t-2 border-t-github-accent border-b border-github-border px-5 py-4 auto-hide-header:py-1 flex items-center justify-between flex-wrap gap-3 sticky top-0 z-10 cursor-pointer ${
        isFocused ? 'keyboard-focused-file-header' : ''
      }`}
    >
      <div className="flex items-start gap-2 flex-[1_1_16rem] min-w-0">
        <button
          onClick={toggleCollapsed}
          aria-expanded={!isCollapsed}
          aria-label={toggleLabel}
          className="mt-0.5 shrink-0 text-github-text-muted"
        >
          {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </button>
        <span className="mt-0.5 shrink-0">{getFileIcon(file.status)}</span>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="text-sm font-mono text-github-text-primary m-0 overflow-hidden text-ellipsis whitespace-nowrap">
              {file.path}
            </h2>
            <button
              className={`${HIT_SLOP} shrink-0 bg-transparent border-none cursor-pointer px-1.5 py-1 rounded text-sm transition-all hover:bg-github-bg-tertiary ${
                isCopied
                  ? 'text-github-accent-text'
                  : 'text-github-text-secondary hover:text-github-text-primary'
              }`}
              onClick={() => {
                void copyTextToClipboard(file.path)
                  .then(() => {
                    console.log('File path copied to clipboard:', file.path);
                    setIsCopied(true);
                    setTimeout(() => setIsCopied(false), 2000);
                  })
                  .catch((err) => {
                    console.error('Failed to copy file path:', err);
                  });
              }}
              title="Copy file path"
            >
              {isCopied ? <Check size={14} /> : <Copy size={14} />}
            </button>
            {onOpenInEditor && (
              <button
                className={`${HIT_SLOP} shrink-0 bg-transparent border-none cursor-pointer px-1.5 py-1 rounded text-sm transition-all hover:bg-github-bg-tertiary text-github-text-secondary hover:text-github-text-primary`}
                onClick={onOpenInEditor}
                title="Open file in editor"
                aria-label="Open file in editor"
              >
                <ExternalLink size={14} />
              </button>
            )}
          </div>
          {file.oldPath && file.oldPath !== file.path && (
            <div className="mt-0.5 text-xs text-github-text-muted">
              {file.status === 'copied' ? 'Copied from' : 'Renamed from'}{' '}
              <span className="font-mono break-all">{file.oldPath}</span>
            </div>
          )}
          {file.hasNonUtf8Path && (
            <div className="mt-0.5 text-xs text-github-text-muted">
              A name in this change is not valid UTF-8, so gavel shows Git&apos;s quoted form and
              can&apos;t load the file&apos;s contents.
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        {isChangedSinceViewed && !isReviewed && (
          <span
            className="inline-flex h-6 items-center rounded-full border border-github-warning px-2.5 text-xs font-medium text-github-warning"
            title="Updated since you last viewed this file"
            aria-label="Updated since you last viewed this file"
          >
            Updated
          </span>
        )}
        {fullFileToggle && (
          <button
            type="button"
            className={`${HIT_SLOP} bg-transparent border-none cursor-pointer px-1.5 py-1 rounded text-sm transition-all hover:bg-github-bg-tertiary text-github-text-secondary hover:text-github-text-primary`}
            onClick={fullFileToggle.onToggle}
            title={fullFileToggle.expanded ? 'Collapse expanded lines' : 'Expand all lines'}
            aria-label={fullFileToggle.expanded ? 'Collapse expanded lines' : 'Expand all lines'}
          >
            {fullFileToggle.expanded ? <FoldVertical size={14} /> : <UnfoldVertical size={14} />}
          </button>
        )}
        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium px-1 py-0.5 rounded text-github-accent-text bg-green-100/10">
            +{file.additions}
          </span>
          <span className="font-medium px-1 py-0.5 rounded text-github-danger bg-red-100/10">
            -{file.deletions}
          </span>
        </div>
        <button
          onClick={() => onToggleReviewed(file.path)}
          disabled={!viewedStateReady}
          aria-busy={!viewedStateReady || undefined}
          // Viewed is the last control, so its area runs on to the row's right edge
          // (px-5), and stays inside the row's py-1 padding in
          // auto-hide-header mode.
          className={`${HIT_SLOP} after:-right-5 auto-hide-header:after:-inset-y-1 flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-200 disabled:cursor-wait disabled:opacity-60 ${
            isReviewed
              ? 'bg-github-accent text-white'
              : 'dark:bg-slate-600 dark:text-white dark:border-slate-500 dark:hover:bg-slate-500 dark:hover:border-slate-400 bg-github-bg-secondary text-github-text-primary border border-github-border hover:bg-github-bg-tertiary hover:border-github-text-muted'
          }`}
          title={
            !viewedStateReady
              ? 'Preparing review'
              : isReviewed
                ? 'Mark as not reviewed'
                : 'Mark as reviewed'
          }
        >
          {isReviewed ? <Check size={14} /> : <Square size={14} />}
          Viewed
        </button>
      </div>
    </div>
  );
};
