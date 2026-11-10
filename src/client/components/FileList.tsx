import {
  ChevronRight,
  ChevronDown,
  FileDiff,
  FolderOpen,
  Folder,
  FilePlus,
  FileX,
  FilePen,
  Search,
  MessageSquare,
  ChevronsDownUp,
  ChevronsUpDown,
} from 'lucide-react';
import {
  memo,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react';

import { type DiffFile, type CommentThread } from '../../types/diff';
import type { AgentUpdate } from '../hooks/useAgentUpdates';
import { isSafariBrowser } from '../utils/browser';

import { Checkbox } from './Checkbox';

interface FileListProps {
  headerStatus?: ReactNode;
  files: DiffFile[];
  onScrollToFile: (path: string) => void;
  onScrollToFirstComment?: (path: string) => void;
  onFileSelected?: () => void;
  comments: CommentThread[];
  unreadUpdates: AgentUpdate[];
  reviewedFiles: Set<string>;
  viewedStateReady?: boolean;
  onToggleReviewed: (path: string) => void;
  onToggleFolderReviewed: (path: string, reviewed: boolean) => void;
  selectedFilePath: string | null;
}

interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: TreeNode[];
  file?: DiffFile;
}

const TREE_ROW_PADDING_LEFT_PX = 16;
const TREE_ICON_SIZE_PX = 16;
const TREE_ROW_GAP_PX = 8;
const TREE_INDENT_STEP_PX = TREE_ICON_SIZE_PX + TREE_ROW_GAP_PX;

// lucide's message-square path, so the unread icon has the same outline as MessageSquare.
const MESSAGE_SQUARE_PATH =
  'M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z';
const UNREAD_DOT_RADIUS = 5.5;
// The gap the mask cuts in the outline around the dot, in the 24-unit viewBox.
const UNREAD_DOT_GAP = 2.25;

// The comment bubble with a blue dot over its top-right corner. The mask cuts the outline
// away around the dot, so the dot stays apart from it on any row background.
function UnreadCommentIcon() {
  const maskId = useId();
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      overflow="visible"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <mask id={maskId}>
        <rect x={-2} y={-2} width={28} height={28} fill="white" stroke="none" />
        <circle cx={19} cy={5} r={UNREAD_DOT_RADIUS + UNREAD_DOT_GAP} fill="black" stroke="none" />
      </mask>
      <path d={MESSAGE_SQUARE_PATH} mask={`url(#${maskId})`} />
      <circle
        cx={19}
        cy={5}
        r={UNREAD_DOT_RADIUS}
        className="fill-blue-500 dark:fill-blue-400"
        stroke="none"
      />
    </svg>
  );
}

function getTreeRowPaddingLeft(depth: number): string {
  return `${depth * TREE_INDENT_STEP_PX + TREE_ROW_PADDING_LEFT_PX}px`;
}

function getAllDirectoryPaths(node: TreeNode): string[] {
  if (!node.isDirectory || !node.children) return [];
  const paths: string[] = [];
  if (node.path) paths.push(node.path);
  node.children.forEach((child) => {
    paths.push(...getAllDirectoryPaths(child));
  });
  return paths;
}

function getReviewedDirectoryPaths(node: TreeNode, reviewedFiles: Set<string>): Set<string> {
  const reviewedDirectoryPaths = new Set<string>();

  const visit = (currentNode: TreeNode): boolean => {
    if (currentNode.file) {
      return reviewedFiles.has(currentNode.file.path);
    }

    if (!currentNode.isDirectory || !currentNode.children || currentNode.children.length === 0) {
      return false;
    }

    const childrenReviewed = currentNode.children.map((child) => visit(child));
    const areAllChildrenReviewed = childrenReviewed.every(Boolean);
    if (areAllChildrenReviewed && currentNode.path) {
      reviewedDirectoryPaths.add(currentNode.path);
    }
    return areAllChildrenReviewed;
  };

  visit(node);
  return reviewedDirectoryPaths;
}

function buildFileTree(files: DiffFile[]): TreeNode {
  const root: TreeNode = {
    name: '',
    path: '',
    isDirectory: true,
    children: [],
  };

  files.forEach((file) => {
    const parts = file.path.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;

      const isLast = i === parts.length - 1;
      const pathSoFar = parts.slice(0, i + 1).join('/');

      if (!current.children) {
        current.children = [];
      }

      let child = current.children.find((c) => c.name === part && c.isDirectory === !isLast);

      if (!child) {
        child = {
          name: part,
          path: pathSoFar,
          isDirectory: !isLast,
          children: isLast ? undefined : [],
          file: isLast ? file : undefined,
        };
        current.children.push(child);
      }

      current = child;
    }
  });

  // Collapse single child directories
  const collapseDirectories = (node: TreeNode): TreeNode => {
    if (!node.isDirectory || !node.children) {
      return node;
    }

    // First, recursively collapse children
    node.children = node.children.map(collapseDirectories);

    // If this directory has only one child directory (no files), collapse them
    if (node.children.length === 1 && node.children[0]?.isDirectory && node.children[0]?.children) {
      const child = node.children[0];
      if (child) {
        // Don't collapse the root node - keep the full path structure
        if (!node.name) {
          return node;
        }
        return {
          ...node,
          name: `${node.name}/${child.name}`,
          path: child.path,
          children: child.children,
        };
      }
    }

    return node;
  };

  return collapseDirectories(root);
}

export const FileList = memo(function FileList({
  headerStatus,
  files,
  onScrollToFile,
  onScrollToFirstComment,
  onFileSelected,
  comments,
  unreadUpdates,
  reviewedFiles,
  viewedStateReady = true,
  onToggleReviewed,
  onToggleFolderReviewed,
  selectedFilePath,
}: FileListProps) {
  const fileTree = useMemo(() => buildFileTree(files), [files]);
  const shouldUseStickyDirectoryHeaders = useMemo(
    () => !isSafariBrowser(typeof navigator === 'undefined' ? '' : navigator.userAgent),
    [],
  );
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const dirContainerRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const stickyContainerStyle = {
    '--dir-row-height': 'calc(var(--spacing, 0.25rem) * 9)',
  } as CSSProperties;

  // Initialize with all directories expanded
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(
    () => new Set(getAllDirectoryPaths(fileTree)),
  );
  const [filterText, setFilterText] = useState('');

  const commentCountMap = useMemo(() => {
    const counts = new Map<string, number>();
    comments.forEach((comment) => {
      if (comment.scope === 'review') return;
      counts.set(comment.file, (counts.get(comment.file) ?? 0) + 1);
    });
    return counts;
  }, [comments]);

  // unreadUpdates also holds other reviews' threads, so count only this review's own.
  const unreadCountMap = useMemo(() => {
    const threadIds = new Set(comments.map((comment) => comment.id));
    const counts = new Map<string, number>();
    for (const { thread } of unreadUpdates) {
      if (thread.scope === 'review' || !threadIds.has(thread.id)) continue;
      counts.set(thread.file, (counts.get(thread.file) ?? 0) + 1);
    }
    return counts;
  }, [comments, unreadUpdates]);

  const diffTotals = useMemo(
    () =>
      files.reduce(
        (totals, file) => ({
          additions: totals.additions + file.additions,
          deletions: totals.deletions + file.deletions,
        }),
        { additions: 0, deletions: 0 },
      ),
    [files],
  );
  const reviewedDirectoryPaths = useMemo(
    () => getReviewedDirectoryPaths(fileTree, reviewedFiles),
    [fileTree, reviewedFiles],
  );

  // Filter the file tree based on search text
  const filteredFileTree = useMemo(() => {
    const normalizedFilter = filterText.trim().toLowerCase();

    const filterTreeNode = (node: TreeNode): TreeNode | null => {
      if (!normalizedFilter) return node;

      if (node.isDirectory && node.children) {
        const filteredChildren = node.children
          .map((child) => filterTreeNode(child))
          .filter((child) => child !== null);

        if (filteredChildren.length > 0) {
          return { ...node, children: filteredChildren };
        }
        return null;
      } else if (node.file) {
        // Check if file name matches filter
        if (node.file.path.toLowerCase().includes(normalizedFilter)) {
          return node;
        }
        return null;
      }

      return null;
    };

    return (
      filterTreeNode(fileTree) || {
        ...fileTree,
        children: [],
      }
    );
  }, [fileTree, filterText]);

  const getFileIcon = (status: DiffFile['status']) => {
    switch (status) {
      case 'added':
        return <FilePlus size={16} className="text-github-accent-text" />;
      case 'deleted':
        return <FileX size={16} className="text-github-danger" />;
      case 'renamed':
        return <FilePen size={16} className="text-github-warning" />;
      default:
        return <FileDiff size={16} className="text-github-text-secondary" />;
    }
  };

  const toggleDirectory = (path: string) => {
    setExpandedDirs((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
      return newSet;
    });
  };

  const allPaths = useMemo(() => getAllDirectoryPaths(fileTree), [fileTree]);
  const isAllExpanded = expandedDirs.size === allPaths.length && allPaths.length > 0;

  const toggleAllDirectories = () => {
    // If all directories are expanded, collapse all. Otherwise, expand all.
    if (isAllExpanded) {
      setExpandedDirs(new Set());
    } else {
      setExpandedDirs(new Set(allPaths));
    }
  };

  const handleDirectoryClick = (event: MouseEvent<HTMLDivElement>, path: string) => {
    if (!shouldUseStickyDirectoryHeaders) {
      toggleDirectory(path);
      return;
    }

    const container = scrollContainerRef.current;
    const row = event.currentTarget;

    if (!container) {
      toggleDirectory(path);
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const topOffset = Number.parseFloat(getComputedStyle(row).top || '0');
    const relativeTop = rowRect.top - containerRect.top;
    const isSticky = relativeTop <= topOffset + 1;

    if (isSticky) {
      const wrapper = dirContainerRefs.current.get(path);
      const firstChild = wrapper?.querySelector<HTMLElement>(
        '[data-tree-row="true"]:not([data-dir-header="true"])',
      );
      const rowHeight = row.getBoundingClientRect().height || 0;
      const target = firstChild ?? row;
      const depthValue = Number.parseInt(target.dataset.depth || row.dataset.depth || '0', 10);
      const stackedOffset = rowHeight * depthValue;
      const targetScrollTop = Math.max(0, target.offsetTop - stackedOffset);

      if (Math.abs(container.scrollTop - targetScrollTop) <= 1) {
        toggleDirectory(path);
        return;
      }

      container.scrollTo({ top: targetScrollTop });
      return;
    }

    toggleDirectory(path);
  };

  const renderViewedControl = (checked: boolean, onChange: () => void, title: string) =>
    viewedStateReady ? (
      <Checkbox checked={checked} onChange={onChange} title={title} className="z-10" />
    ) : (
      <button
        type="button"
        disabled
        aria-busy="true"
        aria-label="Preparing review"
        title="Preparing review"
        className="z-10 h-4 w-4 shrink-0 cursor-wait rounded border border-github-text-muted bg-github-bg-tertiary opacity-60"
      />
    );

  const renderTreeNode = (node: TreeNode, depth: number = 0): React.ReactNode => {
    if (node.isDirectory && node.children) {
      const isExpanded = expandedDirs.has(node.path);
      const isReviewed = reviewedDirectoryPaths.has(node.path);

      return (
        <div
          key={node.path}
          data-dir-container={node.path || undefined}
          ref={(el) => {
            if (!node.path) return;
            if (el) {
              dirContainerRefs.current.set(node.path, el);
            } else {
              dirContainerRefs.current.delete(node.path);
            }
          }}
        >
          {node.name && (
            <div
              className={`${shouldUseStickyDirectoryHeaders ? 'sticky ' : ''}group flex h-9 items-center gap-2 bg-github-bg-secondary px-4 hover:bg-github-bg-tertiary cursor-pointer ${
                isReviewed ? 'opacity-70' : ''
              }`}
              data-dir-header="true"
              data-tree-row="true"
              data-depth={depth}
              style={{
                paddingLeft: getTreeRowPaddingLeft(depth),
                top: shouldUseStickyDirectoryHeaders
                  ? `calc(${depth} * var(--dir-row-height))`
                  : undefined,
                zIndex: shouldUseStickyDirectoryHeaders ? 1000 - depth : undefined,
              }}
              onClick={(event) => handleDirectoryClick(event, node.path)}
            >
              {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <span className="flex items-center group-hover:hidden">
                {isExpanded ? (
                  <FolderOpen size={16} className="text-github-text-secondary" />
                ) : (
                  <Folder size={16} className="text-github-text-secondary" />
                )}
              </span>
              <span className="hidden items-center pl-[2px] group-hover:flex">
                {renderViewedControl(
                  isReviewed,
                  () => onToggleFolderReviewed(node.path, !isReviewed),
                  isReviewed ? 'Mark all files as not reviewed' : 'Mark all files as reviewed',
                )}
              </span>
              <span
                className={`text-sm text-github-text-primary font-medium flex-1 overflow-hidden text-ellipsis whitespace-nowrap ${
                  isReviewed ? 'line-through text-github-text-muted' : ''
                }`}
                title={node.name}
              >
                {node.name}
              </span>
            </div>
          )}
          {(isExpanded || !node.name) &&
            node.children.map((child) => renderTreeNode(child, node.name ? depth + 1 : depth))}
        </div>
      );
    } else if (node.file) {
      const file = node.file;
      const commentCount = commentCountMap.get(file.path) ?? 0;
      const unreadCount = unreadCountMap.get(file.path) ?? 0;
      const commentButtonLabel = `Jump to first comment in ${file.path}${
        unreadCount > 0
          ? `, ${unreadCount} unread agent message${unreadCount === 1 ? '' : 's'}`
          : ''
      }`;
      const isReviewed = reviewedFiles.has(file.path);
      const isSelected = file.path === selectedFilePath;

      return (
        <div
          key={`file:${file.path}`}
          className={`flex items-center gap-2 px-4 py-2 hover:bg-github-bg-tertiary cursor-pointer transition-colors ${
            isReviewed ? 'opacity-70' : ''
          } ${isSelected ? 'file-tree-row-selected' : ''}`}
          data-file-row="true"
          data-tree-row="true"
          data-depth={depth}
          style={{ paddingLeft: getTreeRowPaddingLeft(depth) }}
          onClick={() => {
            onScrollToFile(file.path);
            onFileSelected?.();
          }}
        >
          {renderViewedControl(
            isReviewed,
            () => onToggleReviewed(file.path),
            isReviewed ? 'Mark as not reviewed' : 'Mark as reviewed',
          )}
          {getFileIcon(node.file.status)}
          <span
            className={`text-sm text-github-text-primary flex-1 overflow-hidden text-ellipsis whitespace-nowrap ${
              isReviewed ? 'line-through text-github-text-muted' : ''
            }`}
            title={node.file.path}
          >
            {node.name}
          </span>
          {commentCount > 0 && (
            <button
              type="button"
              className="text-github-warning text-sm font-medium ml-auto flex items-center gap-1 rounded px-1 -mr-1 hover:bg-github-bg-primary focus-visible:outline-2 focus-visible:outline-github-accent"
              title={commentButtonLabel}
              aria-label={commentButtonLabel}
              onClick={(event) => {
                event.stopPropagation();
                (onScrollToFirstComment ?? onScrollToFile)(file.path);
                onFileSelected?.();
              }}
            >
              {unreadCount > 0 ? (
                <UnreadCommentIcon />
              ) : (
                <MessageSquare size={14} aria-hidden="true" />
              )}
              {commentCount}
            </button>
          )}
        </div>
      );
    }

    return null;
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-github-border bg-github-bg-tertiary">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm ui-heading m-0">Files changed ({files.length})</h3>
          <div className="ml-auto flex items-center gap-2">
            <span
              className="inline-flex gap-1 text-right text-xs font-medium whitespace-nowrap"
              title="Total additions and deletions"
              aria-label={`${diffTotals.additions} additions and ${diffTotals.deletions} deletions`}
            >
              <span className="text-github-accent-text">+{diffTotals.additions}</span>
              <span className="text-github-danger">-{diffTotals.deletions}</span>
            </span>
            <button
              onClick={toggleAllDirectories}
              className="p-1 hover:bg-github-bg-primary rounded transition-colors"
              title={isAllExpanded ? 'Collapse all' : 'Expand all'}
            >
              {isAllExpanded ? (
                <ChevronsDownUp size={16} className="text-github-text-secondary" />
              ) : (
                <ChevronsUpDown size={16} className="text-github-text-secondary" />
              )}
            </button>
          </div>
        </div>
        {headerStatus}
        <div className="relative">
          <Search
            size={16}
            className="absolute left-3 top-1/2 transform -translate-y-1/2 text-github-text-muted"
          />
          <input
            type="text"
            placeholder="Filter files..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm bg-github-bg-primary border border-github-border rounded-md focus:outline-none focus:border-github-accent text-github-text-primary placeholder-github-text-muted"
          />
        </div>
      </div>

      <div
        className="flex-1 overflow-y-auto relative z-0"
        style={stickyContainerStyle}
        ref={scrollContainerRef}
      >
        {filteredFileTree.children?.map((child) => renderTreeNode(child))}
      </div>
    </div>
  );
});
