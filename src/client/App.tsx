import { Info, GitBranch, MessageSquare, PanelLeftClose, PanelLeft, Settings } from 'lucide-react';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

import type {
  ConversationSnapshot,
  ConversationSnapshotReview,
  ReviewVerdict,
} from '../types/conversation';
import {
  type DiffFile,
  type DiffResponse,
  type DiffSelection,
  type DiffViewMode,
  type DiffSide,
  type LineNumber,
  type CommentThread,
  type CommentIntent,
  type RevisionsResponse,
} from '../types/diff';
import { DEFAULT_DIFF_VIEW_MODE, normalizeDiffViewMode } from '../utils/diffMode';
import { toCommentThread } from '../utils/commentThreads';
import { EDITOR_SESSION_FRAGMENT_KEY, EDITOR_SESSION_HEADER } from '../utils/editorOptions';
import {
  createDiffSelection,
  diffSelectionsEqual,
  getDiffSelectionKey,
  isWorkingTreeTarget,
  normalizeBaseMode,
} from '../utils/diffSelection';

import { includeDeletedComments } from './utils/commentDeletion';
import type { CommentSubmitOptions } from './components/CommentForm';
import { CommentsDropdown } from './components/CommentsDropdown';
import { CommentsListModal, type OtherReviewConversation } from './components/CommentsListModal';
import {
  DiffQuickMenu,
  formatReviewSelection,
  type RecentReview,
} from './components/DiffQuickMenu';
import { ReviewQueueBar, type ApprovalRequest } from './components/ReviewQueueBar';
import { DiffViewer } from './components/DiffViewer';
import { FileList } from './components/FileList';
import { HelpModal } from './components/HelpModal';
import { codeInFiles } from './components/LineCommentComposer';
import { Logo } from './components/Logo';
import { ReloadButton } from './components/ReloadButton';
import { ReviewSummaryPanel } from './components/ReviewSummaryPanel';
import { AgentDeliveryAlert, AgentDeliveryStatus } from './components/AgentDeliveryStatus';
import { ReviewPresenceIndicator } from './components/ReviewPresenceIndicator';
import { DraftBadge } from './components/DraftBadge';
import { UnreadBadge } from './components/UnreadBadge';
import { useAgentUpdates } from './hooks/useAgentUpdates';
import { useNewReplyPulse } from './hooks/useNewReplyPulse';
import { RevisionDetailModal } from './components/RevisionDetailModal';
import { DEFAULT_IGNORE_WHITESPACE, SettingsModal } from './components/SettingsModal';
import { CaptureDetails } from './components/CaptureDetails';
import { AboutPanel } from './components/AboutPanel';
import { HeaderMenu } from './components/HeaderMenu';
import { VerdictControl } from './components/VerdictControl';
import { VerdictFollowUpNotice } from './components/VerdictFollowUpNotice';
import { CommentLinkNotice } from './components/CommentLinkNotice';
import { ReviewProviders } from './contexts/ReviewProviders';
import { useAppearanceSettings } from './hooks/useAppearanceSettings';
import { filesWithDrafts, useDraftCount, type LineDraftAnchor } from './hooks/useCommentDrafts';
import { useCommentLinks } from './hooks/useCommentLinks';
import { useDiffComments } from './hooks/useDiffComments';
import { useExpandedLines, type MergedChunk } from './hooks/useExpandedLines';
import { useFileWatch } from './hooks/useFileWatch';
import { useInboxDelivery } from './hooks/useInboxDelivery';
import { useKeyboardNavigation } from './hooks/useKeyboardNavigation';
import { useLazyDiffRendering } from './hooks/useLazyDiffRendering';
import { useReviewApproval } from './hooks/useReviewApproval';
import { type ReviewOpAnswer, useReviewOps } from './hooks/useReviewOps';
import { useReviewSummary } from './hooks/useReviewSummary';
import { useVerdictFollowUp } from './hooks/useVerdictFollowUp';
import { useReviewPresence } from './hooks/useReviewPresence';
import { useViewedFiles } from './hooks/useViewedFiles';
import { storageService } from './services/StorageService';
import { useViewport } from './hooks/useViewport';
import { useHideHeaderOnScroll } from './hooks/useHideHeaderOnScroll';
import { useTopVisibleFile } from './hooks/useTopVisibleFile';
import {
  onSettingsSaveError,
  readClientSettings,
  saveClientSettings,
} from './services/userSettings';
import { saveAutoViewedPatterns } from './services/autoViewedPatterns';
import { celebrateApproval } from './utils/approvalCelebration';
import { hasVerdict } from './utils/verdict';
import { hasMultipleCommentAuthors } from './utils/commentAuthors';
import { copyTextToClipboard } from './utils/clipboard';
import { getFileElementId, resetEmptyCommentFormsOutside } from './utils/domUtils';
import { findCommentPosition, findSidePosition } from './utils/navigation/positionHelpers';
import { createScrollToElement, linkScrollBehavior } from './hooks/keyboardNavigation/scrollUtils';
import type { CursorScroll } from './hooks/keyboardNavigation/types';
import { glowLinkTarget } from './utils/linkTargetGlow';
import { fileCanExpandHiddenLines } from './viewers/registry';
import {
  readReviewLocation,
  readReviewHistoryLocation,
  writeReviewLocation,
  type ReviewSelection,
} from './utils/reviewNavigation';
import {
  EMPTY_MERGED_CHUNKS_STATE,
  buildMergedChunksState,
  getMergedChunksForVersion,
} from './utils/mergedChunks';
import { buildFileLineIndex, isThreadOutdated } from './utils/outdatedComments';
import { hideWhitespaceChanges, remapWhitespaceCursor } from './utils/ignoreWhitespace';

const EMPTY_COMMENT_THREADS: CommentThread[] = [];
const EMPTY_FILES: DiffFile[] = [];

// A line draft's row on its own side; see findSidePosition.
const findDraftPosition = (anchor: LineDraftAnchor, files: DiffFile[]) =>
  findSidePosition({ file: anchor.filePath, line: anchor.lineNumber, side: anchor.side }, files);
const EMPTY_MERGED_CHUNKS: MergedChunk[] = [];
const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 600;
const SIDEBAR_DEFAULT_WIDTH = 280;

const parseDiffViewMode = (value: unknown): DiffViewMode | null => {
  switch (value) {
    case 'split':
    case 'side-by-side':
    case 'unified':
    case 'inline':
      return normalizeDiffViewMode(value);
    default:
      return null;
  }
};

const getInitialDiffViewMode = () =>
  parseDiffViewMode(readClientSettings().diffViewMode) ?? DEFAULT_DIFF_VIEW_MODE;

const getInitialIgnoreWhitespace = () => {
  const saved = readClientSettings().ignoreWhitespace;
  return typeof saved === 'boolean' ? saved : DEFAULT_IGNORE_WHITESPACE;
};

const clampSidebarWidth = (width: number) =>
  Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));

const parseSidebarWidth = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? clampSidebarWidth(value) : null;

const getInitialSidebarWidth = () =>
  parseSidebarWidth(readClientSettings().sidebarWidth) ?? SIDEBAR_DEFAULT_WIDTH;

const parseSidebarOpen = (value: unknown): boolean | null =>
  typeof value === 'boolean' ? value : null;

const getInitialFileTreeOpen = () => parseSidebarOpen(readClientSettings().sidebarOpen) ?? true;

const readEditorSessionToken = (): string | null =>
  new URLSearchParams(window.location.hash.slice(1)).get(EDITOR_SESSION_FRAGMENT_KEY);

// The legacy punctuation escape conflates dots with literal _2e_. Preserve safe caches.
function getNamedReviewStorageRef(name: string): string {
  if (!name.includes('.') && !name.includes('_2e_')) return `review:${name}`;
  const encoded = Array.from(name, (character) =>
    character.charCodeAt(0).toString(16).padStart(2, '0'),
  ).join('');
  return `named-review:${encoded}`;
}

function App() {
  const [editorSessionToken, setEditorSessionToken] = useState(readEditorSessionToken);
  useEffect(() => {
    const captureLaunchToken = () => {
      const nextToken = readEditorSessionToken();
      if (nextToken) setEditorSessionToken(nextToken);
    };
    window.addEventListener('hashchange', captureLaunchToken);
    return () => window.removeEventListener('hashchange', captureLaunchToken);
  }, []);
  const [diffData, setDiffData] = useState<DiffResponse | null>(null);
  const [diffDataVersion, setDiffDataVersion] = useState(0);
  // Bumped only by an explicit reload, not by display toggles that refetch the diff
  const [reloadVersion, setReloadVersion] = useState(0);
  const [diffMode, setDiffMode] = useState<DiffViewMode>(getInitialDiffViewMode);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(getInitialIgnoreWhitespace);
  const [loading, setLoading] = useState(true);
  const [captureReloading, setCaptureReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsSaveError, setSettingsSaveError] = useState<string | null>(null);
  useEffect(() => onSettingsSaveError(setSettingsSaveError), []);
  const [isCopiedAll, setIsCopiedAll] = useState(false);
  const [isShipping, setIsShipping] = useState(false);
  const approvalControlRef = useRef<HTMLDivElement>(null);
  // The same element, as state, so the follow-up notice re-renders once it can anchor to it.
  const [verdictAnchor, setVerdictAnchor] = useState<HTMLDivElement | null>(null);
  const setVerdictControl = useCallback((element: HTMLDivElement | null) => {
    approvalControlRef.current = element;
    setVerdictAnchor(element);
  }, []);
  const [sidebarWidth, setSidebarWidth] = useState(getInitialSidebarWidth);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isFileTreeOpen, setIsFileTreeOpen] = useState(getInitialFileTreeOpen);
  const [isDragging, setIsDragging] = useState(false);
  const [isCommentsListOpen, setIsCommentsListOpen] = useState(false);
  // Conversation unmounts while a review loads, so the thread to open afterwards waits here.
  const [threadToFocus, setThreadToFocus] = useState<string | null>(null);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const closeAbout = useCallback(() => setIsAboutOpen(false), []);
  const [isRevisionModalOpen, setIsRevisionModalOpen] = useState(false);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  // A "Go to line" or comment link jump waiting for its line to appear; see
  // handleNavigateToDraftLine.
  const [pendingLineJump, setPendingLineJump] = useState<LineDraftAnchor | null>(null);
  // How that jump scrolls once its line appears: links animate it.
  const pendingJumpBehavior = useRef<CursorScroll>('auto');
  // A linked comment whose card scrolls into view once its line is shown.
  const [threadToReveal, setThreadToReveal] = useState<string | null>(null);
  const collapsedInitializedRef = useRef(false);
  const openedDraftFilesRef = useRef(false);
  const pendingSidebarSelectionsRef = useRef(new Set<string>());
  const diffScrollContainerRef = useRef<HTMLElement | null>(null);

  // Revision selector state
  const [revisionOptions, setRevisionOptions] = useState<RevisionsResponse | null>(null);
  const [recentReviews, setRecentReviews] = useState<RecentReview[]>([]);
  const [approvalRequests, setApprovalRequests] = useState<ApprovalRequest[]>([]);
  const [reviewConversations, setReviewConversations] = useState<OtherReviewConversation[]>([]);
  const [hasLoadedReviews, setHasLoadedReviews] = useState(false);
  const recentReviewsRequestRef = useRef(0);
  const loadRecentReviewsRef = useRef<(() => Promise<void>) | null>(null);
  // Each named review's ID in the latest snapshot. A rename keeps the ID; a delete moves it to
  // deletedReviews.
  const reviewIdsRef = useRef(new Map<string, string>());
  // Switches the open review in place, as a review tab does; set once handleRevisionChange exists.
  const switchReviewRef = useRef<((selection: ReviewSelection) => void) | null>(null);
  const [selectedRevision, setSelectedRevision] = useState<ReviewSelection>(
    () => readReviewLocation() ?? createDiffSelection('', ''),
  );
  const [resolvedBaseRevision, setResolvedBaseRevision] = useState<string>('');
  const [resolvedTargetRevision, setResolvedTargetRevision] = useState<string>('');
  const hasRequestedSelectionRef = useRef(
    Boolean(selectedRevision.reviewName !== undefined || selectedRevision.targetCommitish),
  );
  const currentRequestedBaseModeRef = useRef(selectedRevision.baseMode);
  currentRequestedBaseModeRef.current = diffData?.requestedBaseMode ?? selectedRevision.baseMode;
  const selectedRevisionRef = useRef(selectedRevision);
  selectedRevisionRef.current = selectedRevision;
  const preserveReviewLocationRef = useRef(false);
  const diffRequestIdRef = useRef(0);
  const activeDiffAbortControllerRef = useRef<AbortController | null>(null);
  const resolvedSelection = useMemo<DiffSelection | null>(() => {
    if (!diffData?.baseCommitish || !diffData?.targetCommitish) {
      return null;
    }

    return createDiffSelection(
      diffData.baseCommitish,
      diffData.targetCommitish,
      diffData.requestedBaseMode,
      diffData.capture?.name,
    );
  }, [diffData]);
  const resolvedSelectionKey = useMemo(() => {
    if (!resolvedSelection) {
      return null;
    }

    return getDiffSelectionKey(resolvedSelection);
  }, [resolvedSelection]);

  const storageSelection = useMemo(() => {
    if (!resolvedSelection?.reviewName) return resolvedSelection;
    const ref = getNamedReviewStorageRef(resolvedSelection.reviewName);
    return createDiffSelection(ref, ref);
  }, [resolvedSelection]);
  const storageCommit = resolvedSelection?.reviewName
    ? storageSelection?.baseCommitish
    : diffData?.commit;

  const { settings, updateSettings } = useAppearanceSettings();
  const { isMobile } = useViewport();
  const reviewChrome = useHideHeaderOnScroll();
  const topVisibleFile = useTopVisibleFile(diffScrollContainerRef, diffData?.files ?? EMPTY_FILES);

  const commentsContextKey = useMemo(() => {
    if (!resolvedSelectionKey) {
      return null;
    }

    return JSON.stringify([
      diffData?.repositoryId ?? 'default',
      resolvedSelectionKey,
      storageCommit,
    ]);
  }, [diffData?.repositoryId, storageCommit, resolvedSelectionKey]);
  // Unsent comment drafts are kept per review. commentsContextKey is null only for a
  // diff response without a base and target; those share one draft scope. Unnamed
  // stdin patches all have the same selection, so the patch's digest tells them apart.
  const reviewDraftScope = commentsContextKey ?? 'default';
  const draftScope =
    diffData?.stdinDiffDigest === undefined
      ? reviewDraftScope
      : `${reviewDraftScope}:${diffData.stdinDiffDigest}`;
  const draftCount = useDraftCount(draftScope);
  const commentSessionQueryString = useMemo(() => {
    if (!resolvedSelection) {
      return null;
    }

    if (resolvedSelection.reviewName) {
      return new URLSearchParams({ review: resolvedSelection.reviewName }).toString();
    }
    const params = new URLSearchParams({
      base: resolvedSelection.baseCommitish,
      target: resolvedSelection.targetCommitish,
    });
    if (resolvedSelection.baseMode === 'merge-base') {
      params.set('baseMode', resolvedSelection.baseMode);
    }

    return params.toString();
  }, [resolvedSelection]);
  const getCommentApiUrl = useCallback(
    (path: string) => {
      if (!commentSessionQueryString) {
        return path;
      }
      return `${path}?${commentSessionQueryString}`;
    },
    [commentSessionQueryString],
  );
  // The server finds a review's comments by its selection, so a moved commit keeps the queue.
  const reviewScope = useMemo(
    () =>
      resolvedSelectionKey &&
      JSON.stringify([diffData?.repositoryId ?? 'default', resolvedSelectionKey]),
    [diffData?.repositoryId, resolvedSelectionKey],
  );
  const reviewOps = useReviewOps(reviewScope, commentSessionQueryString, diffData?.repositoryId);
  // Moves a renamed review's waiting changes to its new name; scoped as reviewScope is.
  const retargetOpsRef = useRef<(from: string, to: string) => void>(() => {});
  const namedScope = (name: string) =>
    JSON.stringify([
      diffData?.repositoryId ?? 'default',
      getDiffSelectionKey(createDiffSelection('', '', undefined, name)),
    ]);
  retargetOpsRef.current = (from, to) => reviewOps.retarget(namedScope(from), namedScope(to));
  const { enqueue, loaded: hasLoadedComments } = reviewOps;
  const {
    threads,
    addThread,
    addReviewThread,
    replyToThread,
    toggleThreadResolved,
    removeThread,
    deletedComments,
    restoreComment,
    removeMessage,
    updateMessage,
    clearAllComments,
    generateThreadPrompt,
    generateAllCommentsPrompt,
  } = useDiffComments(reviewScope, reviewOps.threads, enqueue, diffData?.capture);
  const fileOfThread = useCallback(
    (threadId: string) => threads.find((thread) => thread.id === threadId)?.filePath,
    [threads],
  );
  const summary = useReviewSummary(
    commentSessionQueryString ? getCommentApiUrl('/api/review-summary') : null,
  );
  const refreshSummary = summary.refresh;
  const approval = useReviewApproval(
    diffData?.shipIt && commentSessionQueryString ? getCommentApiUrl('/api/approval') : null,
  );
  const refreshApproval = approval.refresh;
  const commentsCaptureKey = diffData?.capture
    ? `${diffData.capture.version}:${diffData.capture.patchDigest}`
    : null;
  const activeCommentsContextRef = useRef({
    key: commentsContextKey,
    captureKey: commentsCaptureKey,
    generation: 0,
  });
  // Counts changes of review, commit or capture, so work that finishes later, such as a verdict
  // answer or the viewed-file updates below, can tell that the page moved on.
  if (
    activeCommentsContextRef.current.key !== commentsContextKey ||
    activeCommentsContextRef.current.captureKey !== commentsCaptureKey
  ) {
    activeCommentsContextRef.current = {
      key: commentsContextKey,
      captureKey: commentsCaptureKey,
      generation: activeCommentsContextRef.current.generation + 1,
    };
  }
  const commentsGeneration = activeCommentsContextRef.current.generation;
  const fetchDiffDataRef = useRef<((selection?: ReviewSelection) => Promise<void>) | null>(null);
  // Counts verdict clicks, so only the latest one's answer moves the page on.
  const verdictClickRef = useRef(0);
  // Runs once the server answers a verdict, which can be long after the click when the first
  // send fails. The ref holds the latest render's version, so it reads the current page state.
  const finishVerdict = async (
    verdict: ReviewVerdict | 'clear',
    answer: ReviewOpAnswer,
    click: number,
    generation: number,
    shownVerdict: ReviewVerdict | undefined,
  ) => {
    // The reviewer moved to another review, so its reload and next step no longer apply.
    const sameReview = () => activeCommentsContextRef.current.generation === generation;
    const latest = () => sameReview() && verdictClickRef.current === click;
    if (!sameReview()) return;
    // Another tab sent it, so only the server knows how it went.
    if (answer === 'elsewhere') {
      await refreshApproval();
      return;
    }
    if (answer.status === 'rejected') {
      // The capture, summary or diff changed. Without a file watcher no Reload prompt appears,
      // so reload here, re-checking viewed files so a collapsed file whose diff changed is flagged.
      await Promise.all([refreshSummary(), refreshApproval(), fetchDiffDataRef.current?.()]);
      if (sameReview()) setReloadVersion((prev) => prev + 1);
      return;
    }
    await refreshApproval();
    // A later click replaced this verdict, so its burst and next step would be wrong.
    if (!latest()) return;
    if (verdict === 'clear') {
      verdictFollowUp.cancel();
      return;
    }
    // Another tab or reviewer may have changed or cleared the verdict before this read.
    const stillGiven = () => latest() && approval.servedVerdict() === verdict;
    if (!stillGiven()) return;
    if (verdict === 'approve' && shownVerdict !== 'approve' && approvalControlRef.current) {
      celebrateApproval(approvalControlRef.current, settings.approvalAnimations);
    }
    // The next step depends on the other reviews' verdicts. start() sees the list from the
    // click's render; the hook corrects the step from the refreshed list on the next one.
    await loadRecentReviewsRef.current?.();
    if (stillGiven()) verdictFollowUp.start();
  };
  const finishVerdictRef = useRef(finishVerdict);
  finishVerdictRef.current = finishVerdict;

  const handleVerdict = async (verdict: ReviewVerdict | 'clear') => {
    const approving = verdict === 'approve';
    if (
      !approval.ready ||
      isShipping ||
      captureReloading ||
      // A verdict answers the comments, so it waits until they load.
      (verdict === 'reject' && !hasLoadedComments) ||
      (approving && (!hasLoadedComments || !summary.ready))
    ) {
      return;
    }

    setIsShipping(true);
    try {
      // Reject does not endorse the proposed message, so it sends no summaryVersion.
      const capture = diffData?.capture;
      const { sent, answer } = enqueue({
        type: 'verdict.set',
        verdict,
        ...(approving ? { summaryVersion: summary.version } : {}),
        ...(capture ? { captureVersion: capture.version, patchDigest: capture.patchDigest } : {}),
        ...(diffData?.diffDigest !== undefined ? { diffDigest: diffData.diffDigest } : {}),
      });
      const click = ++verdictClickRef.current;
      const finished = answer.then((result) =>
        finishVerdictRef.current(verdict, result, click, commentsGeneration, approval.verdict),
      );
      // After a failed send the verdict waits in the queue, and the header says so; the controls
      // free up, and the answer to a later retry finishes it.
      if (await sent) await finished;
    } finally {
      setIsShipping(false);
    }
  };

  // The server sends its saved patterns with each diff. After an edit in
  // Settings, this page uses its own value until a page reload; a change made
  // in another browser meanwhile is overwritten by the next edit here.
  const [editedAutoViewedPatterns, setEditedAutoViewedPatterns] = useState<string[] | null>(null);
  const autoViewedPatterns = editedAutoViewedPatterns ?? diffData?.autoViewedPatterns ?? [];
  const handleAutoViewedPatternsChange = useCallback((patterns: string[]) => {
    setEditedAutoViewedPatterns(patterns);
    saveAutoViewedPatterns(patterns);
  }, []);

  // Viewed files management
  const {
    viewedFiles,
    changedSinceViewedFiles,
    hasLoadedInitialViewedFiles,
    toggleFileViewed,
    setFilesViewed,
    clearViewedFiles,
  } = useViewedFiles(
    storageSelection?.baseCommitish,
    storageSelection?.targetCommitish,
    storageCommit,
    undefined,
    diffData?.files,
    diffData?.repositoryId, // Repository identifier for storage isolation
    autoViewedPatterns,
    storageSelection?.baseMode,
    commentsCaptureKey ?? undefined,
    reloadVersion,
  );

  const viewedStateReady = !diffData?.capture || hasLoadedInitialViewedFiles;
  // Storage keeps a viewed record for a path even after it leaves the diff
  // (renamed away, or the change reverted), so review progress counts only the
  // files the current diff still has.
  const viewedFilesInDiffCount = useMemo(
    () => (diffData?.files ?? []).filter((file) => viewedFiles.has(file.path)).length,
    [diffData, viewedFiles],
  );

  // Expand files un-viewed on reload because their diff changed since they were viewed
  const previousViewedFilesRef = useRef(viewedFiles);
  useEffect(() => {
    const previousViewedFiles = previousViewedFilesRef.current;
    previousViewedFilesRef.current = viewedFiles;
    const unviewedChangedFiles = [...changedSinceViewedFiles].filter(
      (filePath) => previousViewedFiles.has(filePath) && !viewedFiles.has(filePath),
    );
    if (unviewedChangedFiles.length === 0) return;
    setCollapsedFiles((prev) => {
      const newSet = new Set(prev);
      unviewedChangedFiles.forEach((filePath) => newSet.delete(filePath));
      return newSet;
    });
  }, [viewedFiles, changedSinceViewedFiles]);

  // Reset initialization flag when diff context changes
  useEffect(() => {
    collapsedInitializedRef.current = false;
    openedDraftFilesRef.current = false;
    pendingSidebarSelectionsRef.current.clear();
  }, [diffData?.repositoryId, resolvedSelectionKey, diffData?.commit, commentsCaptureKey]);

  // Initialize collapsed files from viewed files (only once per diff)
  useEffect(() => {
    if (!collapsedInitializedRef.current && hasLoadedInitialViewedFiles) {
      const pendingSelections = new Set(pendingSidebarSelectionsRef.current);
      pendingSidebarSelectionsRef.current.clear();
      setCollapsedFiles((current) => {
        const nextCollapsedFiles = new Set(viewedFiles);
        // A file holding an unsent draft opens, so the restored draft shows.
        for (const filePath of filesWithDrafts(draftScope, fileOfThread)) {
          nextCollapsedFiles.delete(filePath);
        }
        // Preserve sidebar selections and any later manual collapse while loading.
        for (const filePath of pendingSelections) {
          if (current.has(filePath)) nextCollapsedFiles.add(filePath);
          else nextCollapsedFiles.delete(filePath);
        }
        return nextCollapsedFiles;
      });
      collapsedInitializedRef.current = true;
    }
  }, [viewedFiles, hasLoadedInitialViewedFiles, draftScope, fileOfThread]);

  // Reply and edit drafts find their file through their thread, so once the threads
  // load, open the files whose threads hold a draft.
  useEffect(() => {
    if (!hasLoadedComments || openedDraftFilesRef.current) return;
    openedDraftFilesRef.current = true;
    const draftFiles = filesWithDrafts(draftScope, fileOfThread);
    if (draftFiles.length === 0) return;
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      draftFiles.forEach((filePath) => next.delete(filePath));
      return next;
    });
  }, [hasLoadedComments, draftScope, fileOfThread]);
  const isScrollContextCurrent = useCallback(
    () =>
      (commentsCaptureKey === null && activeCommentsContextRef.current.captureKey === null) ||
      activeCommentsContextRef.current.generation === commentsGeneration,
    [commentsCaptureKey, commentsGeneration],
  );
  const {
    renderedFilePaths,
    ensureFileRendered,
    ensureFilesRenderedUpTo,
    registerLazyFileContainer,
    scrollFileIntoDiffContainer,
    isFileScrolledPastContainerTop,
    cancelFileScroll,
  } = useLazyDiffRendering({
    diffData,
    diffScrollContainerRef,
    setDiffData,
    isScrollContextCurrent,
  });

  const handleSidebarFileSelected = useCallback(
    (filePath: string, target?: 'first-comment') => {
      if (!collapsedInitializedRef.current) pendingSidebarSelectionsRef.current.add(filePath);
      setCollapsedFiles((previous) => {
        if (!previous.has(filePath)) return previous;
        const nextCollapsedFiles = new Set(previous);
        nextCollapsedFiles.delete(filePath);
        return nextCollapsedFiles;
      });
      scrollFileIntoDiffContainer(filePath, target);
    },
    [scrollFileIntoDiffContainer],
  );

  const toggleFileReviewed = useCallback(
    async (filePath: string) => {
      if (!diffData || !viewedStateReady) return;
      const file = diffData.files.find((f) => f.path === filePath);
      if (!file) return;

      const wasViewed = viewedFiles.has(filePath);
      // Measure before the collapse re-renders: only re-anchor the header when
      // the user is scrolled past it (deep inside a long file), so the viewport
      // doesn't land in unrelated content after collapsing (#164). If the header
      // is already visible, stay stationary and let files below fill up (#402).
      const shouldScrollToHeader = !wasViewed && isFileScrolledPastContainerTop(filePath);
      await toggleFileViewed(filePath, file);
      if (
        (diffData.capture || activeCommentsContextRef.current.captureKey !== null) &&
        activeCommentsContextRef.current.generation !== commentsGeneration
      )
        return;

      // Update collapsed state based on viewed state
      setCollapsedFiles((prev) => {
        const newSet = new Set(prev);
        if (!wasViewed) {
          // Marking as viewed -> collapse the file
          newSet.add(filePath);
        } else {
          // Marking as not viewed -> expand the file
          newSet.delete(filePath);
        }
        return newSet;
      });

      if (shouldScrollToHeader) {
        setTimeout(() => {
          if (!isScrollContextCurrent()) return;
          scrollFileIntoDiffContainer(filePath);
        }, 100);
      }
    },
    [
      diffData,
      viewedStateReady,
      commentsGeneration,
      isFileScrolledPastContainerTop,
      isScrollContextCurrent,
      scrollFileIntoDiffContainer,
      toggleFileViewed,
      viewedFiles,
    ],
  );

  const toggleFolderReviewed = useCallback(
    async (folderPath: string, reviewed: boolean) => {
      if (!diffData || !viewedStateReady) return;
      const folderFiles = diffData.files.filter((file) => file.path.startsWith(`${folderPath}/`));
      if (folderFiles.length === 0) return;

      await setFilesViewed(folderFiles, reviewed);
      if (
        (diffData.capture || activeCommentsContextRef.current.captureKey !== null) &&
        activeCommentsContextRef.current.generation !== commentsGeneration
      )
        return;

      // Keep the collapse state of every file in the folder in sync with its viewed state
      setCollapsedFiles((prev) => {
        const newSet = new Set(prev);
        folderFiles.forEach((file) => {
          if (reviewed) {
            newSet.add(file.path);
          } else {
            newSet.delete(file.path);
          }
        });
        return newSet;
      });
    },
    [diffData, setFilesViewed, viewedStateReady, commentsGeneration],
  );

  const toggleFileCollapsed = useCallback((filePath: string) => {
    setCollapsedFiles((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(filePath)) {
        newSet.delete(filePath);
      } else {
        newSet.add(filePath);
      }
      return newSet;
    });
  }, []);

  const toggleAllFilesCollapsed = useCallback(
    (shouldCollapse: boolean) => {
      if (!diffData) return;

      if (shouldCollapse) {
        // Collapse all files
        setCollapsedFiles(new Set(diffData.files.map((f) => f.path)));
      } else {
        // Expand all files
        setCollapsedFiles(new Set());
      }
    },
    [diffData],
  );

  const handleMobileFileSelected = useCallback(() => {
    setIsFileTreeOpen(false);
  }, []);

  const handleDiffModeChange = useCallback((mode: DiffViewMode) => {
    setDiffMode(mode);
    saveClientSettings({ diffViewMode: mode });
  }, []);

  const handleIgnoreWhitespaceChange = useCallback((ignore: boolean) => {
    setIgnoreWhitespace(ignore);
    saveClientSettings({ ignoreWhitespace: ignore });
  }, []);

  // Lift expand state to App level so navigation and rendering share the same merged chunks
  const {
    isLoading: isExpandLoading,
    expandLines,
    expandAllBetweenChunks,
    expandAllLines,
    collapseExpandedLines,
    prefetchFileContent,
    getMergedChunks,
    lastUpdatedAt,
  } = useExpandedLines({
    baseCommitish: diffData?.baseCommitish,
    targetCommitish: diffData?.targetCommitish,
    diffIdentity: diffDataVersion,
    contextUnavailable: Boolean(diffData?.capture),
  });

  const getMergedChunksRef = useRef(getMergedChunks);
  useEffect(() => {
    getMergedChunksRef.current = getMergedChunks;
  }, [getMergedChunks]);

  const [mergedChunksState, setMergedChunksState] = useState(EMPTY_MERGED_CHUNKS_STATE);
  const filesByPath = useMemo(() => {
    const map = new Map<string, DiffResponse['files'][number]>();
    diffData?.files.forEach((file) => {
      map.set(file.path, file);
    });
    return map;
  }, [diffData]);

  // Recompute merged chunks for the current fetched diff only.
  useEffect(() => {
    if (!diffData) {
      setMergedChunksState(EMPTY_MERGED_CHUNKS_STATE);
      return;
    }

    setMergedChunksState(
      buildMergedChunksState(diffDataVersion, renderedFilePaths, filesByPath, (file) =>
        getMergedChunksRef.current(file),
      ),
    );
  }, [diffData, diffDataVersion, filesByPath, renderedFilePaths, lastUpdatedAt]);

  // Create files with merged chunks for keyboard navigation
  const canonicalFiles = useMemo(() => {
    if (!diffData) return [];
    return diffData.files.map((file) => ({
      ...file,
      chunks:
        getMergedChunksForVersion(mergedChunksState, diffDataVersion, file.path) || file.chunks,
    }));
  }, [diffData, diffDataVersion, mergedChunksState]);

  const fileLineIndexByPath = useMemo(() => {
    const map = new Map<string, ReturnType<typeof buildFileLineIndex>>();
    canonicalFiles.forEach((file) => {
      map.set(file.path, buildFileLineIndex(file));
    });
    return map;
  }, [canonicalFiles]);

  const normalizedThreads = useMemo<CommentThread[]>(
    () =>
      threads.map((thread) => ({
        ...toCommentThread(thread),
        isOutdated:
          thread.scope !== 'review' &&
          isThreadOutdated(thread, fileLineIndexByPath.get(thread.filePath), diffData?.capture),
      })),
    [threads, fileLineIndexByPath, diffData?.capture],
  );
  const displayThreads = useMemo<CommentThread[]>(
    () =>
      includeDeletedComments(threads, deletedComments).map((thread) => ({
        ...toCommentThread(thread),
        deleted: thread.deleted,
        deletedMessageIds: thread.deletedMessageIds,
        isOutdated:
          thread.scope !== 'review' &&
          isThreadOutdated(thread, fileLineIndexByPath.get(thread.filePath), diffData?.capture),
      })),
    [threads, deletedComments, fileLineIndexByPath, diffData?.capture],
  );
  // Comment links name a review; a deleted one has nothing left to show.
  const liveReviewConversations = useMemo(
    () => reviewConversations.filter((review) => !review.deleted),
    [reviewConversations],
  );
  const otherReviews = useMemo(
    () =>
      reviewConversations.filter(
        // A deleted review may share its name with the open one.
        (review) => review.deleted || !diffSelectionsEqual(review.selection, resolvedSelection),
      ),
    [reviewConversations, resolvedSelection],
  );
  const unreadCandidateThreads = useMemo(
    () => [
      ...(hasLoadedComments ? normalizedThreads : []),
      ...otherReviews.flatMap((review) => review.threads),
    ],
    [hasLoadedComments, normalizedThreads, otherReviews],
  );
  // Scoped to the repository because thread IDs are unique, and any review's threads can be
  // marked read from Conversation while another review is open.
  const readMarkScope = diffData ? (diffData.repositoryId ?? 'default') : null;
  const {
    updates: agentUpdates,
    allUpdates: allAgentUpdates,
    setRead: setAgentMessageRead,
  } = useAgentUpdates(unreadCandidateThreads, readMarkScope);
  const replyPulse = useNewReplyPulse(
    allAgentUpdates,
    agentUpdates,
    hasLoadedComments && hasLoadedReviews,
  );
  const unreadReviews = new Set(
    agentUpdates.flatMap(
      (update) =>
        otherReviews.find((review) => review.threads.includes(update.thread))?.key ??
        resolvedSelectionKey ??
        [],
    ),
  );
  const showAuthorBadges = useMemo(
    () => hasMultipleCommentAuthors(normalizedThreads.flatMap((thread) => thread.messages)),
    [normalizedThreads],
  );
  const threadsByFile = useMemo(() => {
    const map = new Map<string, CommentThread[]>();
    displayThreads.forEach((thread) => {
      if (thread.scope === 'review') return;
      const entry = map.get(thread.file);
      if (entry) {
        entry.push(thread);
      } else {
        map.set(thread.file, [thread]);
      }
    });
    return map;
  }, [displayThreads]);

  // Keep imported patches canonical for viewed hashes and comment snapshots;
  // rendering and keyboard navigation share only this presentation projection.
  const isImportedPatch = Boolean(diffData?.capture) || diffData?.targetCommitish === 'stdin';
  const navigableFiles = useMemo(
    () =>
      canonicalFiles.map((file) => ({
        ...file,
        chunks:
          isImportedPatch && ignoreWhitespace
            ? hideWhitespaceChanges(
                file.chunks,
                threadsByFile.get(file.path) ?? EMPTY_COMMENT_THREADS,
              )
            : file.chunks,
      })),
    [canonicalFiles, isImportedPatch, ignoreWhitespace, threadsByFile],
  );
  const diffFilePaths = useMemo(
    () => new Set(navigableFiles.map((file) => file.path)),
    [navigableFiles],
  );
  const presentationChunksByPath = useMemo(() => {
    const map = new Map<string, MergedChunk[]>();
    navigableFiles.forEach((file) => {
      const canonicalChunks = getMergedChunksForVersion(
        mergedChunksState,
        diffDataVersion,
        file.path,
      );
      if (canonicalChunks) {
        map.set(
          file.path,
          canonicalChunks.map((chunk, index) => ({ ...chunk, ...file.chunks[index] })),
        );
      }
    });
    return map;
  }, [navigableFiles, mergedChunksState, diffDataVersion]);
  // The code the diff shows now under a line draft, for drafts sent from Conversation.
  const codeForDraft = useCallback(
    (anchor: LineDraftAnchor) => codeInFiles(navigableFiles, anchor),
    [navigableFiles],
  );

  // State to trigger comment creation from keyboard
  const [commentTrigger, setCommentTrigger] = useState<{
    fileIndex: number;
    chunkIndex: number;
    lineIndex: number;
  } | null>(null);
  const handleWatchReload = useCallback(async () => {
    await fetchDiffDataRef.current?.();
    setReloadVersion((prev) => prev + 1);
    await refreshApproval();
    await refreshSummary();
    // A commit that moves HEAD creates a review on the server without any other event.
    await loadRecentReviewsRef.current?.();
  }, [refreshApproval, refreshSummary]);
  const refreshComments = reviewOps.refresh;
  const handleCommentsChanged = useCallback(async () => {
    // The event doesn't say which review changed, so re-read them all. Without this, a new
    // reply on another review wouldn't reach the badge until some other event refreshed the list.
    void loadRecentReviewsRef.current?.();
    try {
      await refreshComments();
    } catch (commentsError) {
      console.error('Failed to refresh comments from server:', commentsError);
    }
  }, [refreshComments]);

  const captureReloadRequestRef = useRef(0);
  const handleCaptureChanged = useCallback(async (reviewName?: string) => {
    const recent = loadRecentReviewsRef.current?.();
    const currentName = selectedRevisionRef.current.reviewName;
    if (!currentName || (reviewName && reviewName !== currentName)) {
      await recent;
      return;
    }
    const request = ++captureReloadRequestRef.current;
    setCaptureReloading(true);
    try {
      await Promise.all([fetchDiffDataRef.current?.(), recent]);
    } finally {
      if (request === captureReloadRequestRef.current) setCaptureReloading(false);
    }
  }, []);

  // Another review's approval or proposal can change what the review bar shows.
  const handleApprovalChanged = useCallback(async () => {
    await Promise.all([refreshApproval(), loadRecentReviewsRef.current?.()]);
  }, [refreshApproval]);
  const handleSummaryChanged = useCallback(async () => {
    await Promise.all([refreshSummary(), loadRecentReviewsRef.current?.()]);
  }, [refreshSummary]);

  const inboxDelivery = useInboxDelivery(resolvedSelection);

  // An agent renamed or deleted a named review; loadRecentReviews moves the open one. The inbox
  // list names reviews, and the server sends no inbox event for an agent's rename.
  const refreshInboxDelivery = inboxDelivery.refresh;
  const handleReviewsChanged = useCallback(async () => {
    await Promise.all([loadRecentReviewsRef.current?.(), refreshInboxDelivery()]);
  }, [refreshInboxDelivery]);

  // File watch for reload functionality - initialize with callback
  const { shouldReload, reload, watchState, isConnected } = useFileWatch(
    handleWatchReload,
    handleCommentsChanged,
    handleApprovalChanged,
    handleSummaryChanged,
    handleCaptureChanged,
    refreshInboxDelivery,
    handleReviewsChanged,
  );
  // Changes that failed to reach the server go again once the live connection opens, after a
  // drop or while changes wait. A first connect with nothing waiting follows the load, which
  // already read the review.
  const retryReviewOps = reviewOps.retry;
  const connectionRef = useRef<'never' | 'open' | 'dropped'>('never');
  const opsWaitingRef = useRef(reviewOps.waiting);
  opsWaitingRef.current = reviewOps.waiting;
  useEffect(() => {
    if (!isConnected) {
      if (connectionRef.current === 'open') connectionRef.current = 'dropped';
      return;
    }
    if (
      connectionRef.current === 'dropped' ||
      (connectionRef.current === 'never' && opsWaitingRef.current)
    )
      retryReviewOps().catch((commentsError: unknown) =>
        console.error('Failed to refresh comments from server:', commentsError),
      );
    connectionRef.current = 'open';
  }, [isConnected, retryReviewOps]);

  // Track which file the mouse is over so `v` works without a cursor
  const hoveredFileIndexRef = useRef<number | null>(null);
  const getHoveredFileIndex = useCallback(() => hoveredFileIndexRef.current, []);

  const { cursor, isHelpOpen, setIsHelpOpen, setCursorPosition, rememberFilePosition } =
    useKeyboardNavigation({
      files: navigableFiles,
      comments: normalizedThreads.filter((thread) => thread.scope !== 'review'),
      viewMode: diffMode,
      reviewedFiles: viewedFiles,
      viewedStateReady,
      onToggleReviewed: toggleFileReviewed,
      getHoveredFileIndex,
      onCreateComment: () => {
        if (cursor) {
          setCommentTrigger({
            fileIndex: cursor.fileIndex,
            chunkIndex: cursor.chunkIndex,
            lineIndex: cursor.lineIndex,
          });
        }
      },
      onCopyAllComments: () => {
        if (threads.length > 0) {
          void handleCopyAllComments();
        }
      },
      onDeleteAllComments: () => {
        if (threads.length > 0 && confirm('Delete all comments?')) {
          clearAllComments();
        }
      },
      onShowCommentsList: () => {
        setPendingLineJump(null);
        setThreadToReveal(null);
        setIsCommentsListOpen(true);
      },
      onRefresh: () => {
        reload();
      },
    });

  const previousPresentationRef = useRef({
    files: navigableFiles,
    ignoreWhitespace,
    captureKey: commentsCaptureKey,
  });
  useEffect(() => {
    const previous = previousPresentationRef.current;
    previousPresentationRef.current = {
      files: navigableFiles,
      ignoreWhitespace,
      captureKey: commentsCaptureKey,
    };
    if (
      cursor &&
      commentsCaptureKey &&
      previous.captureKey === commentsCaptureKey &&
      previous.ignoreWhitespace !== ignoreWhitespace
    ) {
      setCursorPosition(remapWhitespaceCursor(previous.files, navigableFiles, cursor));
    }
  }, [navigableFiles, ignoreWhitespace, commentsCaptureKey, cursor, setCursorPosition]);

  // Viewed button in the diff header: silently remember the toggled file as
  // the navigation position, so keyboard navigation resumes from it without
  // showing any keyboard UI for a mouse interaction
  const handleViewedButtonToggle = useCallback(
    (filePath: string) => {
      void toggleFileReviewed(filePath);
      if (diffData) {
        const fileIndex = diffData.files.findIndex((f) => f.path === filePath);
        if (fileIndex !== -1) {
          rememberFilePosition(fileIndex);
        }
      }
    },
    [toggleFileReviewed, diffData, rememberFilePosition],
  );

  useEffect(() => {
    if (!diffData || !cursor) return;

    const filePath = diffData.files[cursor.fileIndex]?.path;
    if (!filePath || renderedFilePaths.has(filePath)) return;

    ensureFilesRenderedUpTo(filePath);
    requestAnimationFrame(() => {
      setCursorPosition(cursor);
    });
  }, [cursor, diffData, ensureFilesRenderedUpTo, renderedFilePaths, setCursorPosition]);

  const handleLineClick = useCallback(
    (fileIndex: number, chunkIndex: number, lineIndex: number, side: 'left' | 'right') => {
      setCursorPosition({
        fileIndex,
        chunkIndex,
        lineIndex,
        side,
      });
    },
    [setCursorPosition],
  );

  const handleCommentTriggerHandled = useCallback(() => {
    setCommentTrigger(null);
  }, [setCommentTrigger]);

  // Only several reviews need telling apart in a copied prompt.
  const promptReviewTabName =
    approvalRequests.length > 1
      ? approvalRequests.find((review) => diffSelectionsEqual(review.selection, resolvedSelection))
          ?.name
      : undefined;
  // A piped diff has no repository path; gavel's launch directory is the closest match.
  const promptOrigin = useMemo(
    () => ({
      repo: diffData?.reviewContext?.repositoryPath ?? diffData?.reviewContext?.workingDirectory,
      session: diffData?.reviewContext?.agentSessionId,
    }),
    [diffData?.reviewContext],
  );
  const handleGenerateThreadPrompt = useCallback(
    (thread: CommentThread) =>
      generateThreadPrompt(thread.id, { ...promptOrigin, reviewTabName: promptReviewTabName }),
    [generateThreadPrompt, promptOrigin, promptReviewTabName],
  );

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(
        SIDEBAR_MIN_WIDTH,
        Math.min(SIDEBAR_MAX_WIDTH, startWidth + (e.clientX - startX)),
      );
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const fetchDiffData = useCallback(
    async (selection?: ReviewSelection, preserveLocation = preserveReviewLocationRef.current) => {
      const requestId = diffRequestIdRef.current + 1;
      diffRequestIdRef.current = requestId;
      activeDiffAbortControllerRef.current?.abort();
      const controller = new AbortController();
      activeDiffAbortControllerRef.current = controller;
      try {
        const requestedSelection =
          selection ?? (hasRequestedSelectionRef.current ? selectedRevisionRef.current : undefined);
        const params = new URLSearchParams({
          ignoreWhitespace: String(ignoreWhitespace),
        });
        if (requestedSelection?.reviewName !== undefined) {
          params.set('review', requestedSelection.reviewName);
        } else {
          if (requestedSelection?.baseCommitish)
            params.set('base', requestedSelection.baseCommitish);
          if (requestedSelection?.targetCommitish)
            params.set('target', requestedSelection.targetCommitish);
          if (requestedSelection?.baseMode === 'merge-base')
            params.set('baseMode', requestedSelection.baseMode);
          if (requestedSelection?.retained) params.set('retainedReview', '1');
        }

        const response = await fetch(`/api/diff?${params}`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          // The server explains some failures (e.g. a broken ~/.gavel/config.json)
          // in a JSON body; Express's own error pages are HTML.
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? 'Failed to fetch diff data');
        }
        const data = (await response.json()) as DiffResponse;
        if (diffRequestIdRef.current !== requestId) {
          return;
        }
        setDiffData(data);
        setDiffDataVersion((prev) => prev + 1);
        const requestedBase = data.requestedBaseCommitish ?? data.baseCommitish;
        const requestedTarget = data.requestedTargetCommitish ?? data.targetCommitish;
        if (requestedBase && requestedTarget && !preserveLocation) {
          writeReviewLocation(
            {
              ...createDiffSelection(
                requestedBase,
                requestedTarget,
                data.requestedBaseMode,
                data.capture?.name,
              ),
              ...(requestedSelection?.retained ? { retained: true as const } : {}),
            },
            'replace',
            createDiffSelection(
              data.baseCommitish ?? requestedBase,
              data.targetCommitish ?? requestedTarget,
              data.requestedBaseMode,
              data.capture?.name,
            ),
          );
        }

        // Update resolved revision state from server response
        setResolvedBaseRevision(
          data.baseCommitish && data.requestedBaseMode !== 'merge-base' ? data.baseCommitish : '',
        );
        if (data.targetCommitish) setResolvedTargetRevision(data.targetCommitish);

        if (!hasRequestedSelectionRef.current) {
          if (requestedBase && requestedTarget) {
            const launchSelection = createDiffSelection(
              requestedBase,
              requestedTarget,
              data.requestedBaseMode,
              data.capture?.name,
            );
            hasRequestedSelectionRef.current = true;
            selectedRevisionRef.current = launchSelection;
            setSelectedRevision(launchSelection);
          }
        }

        if (data.capture && requestedBase && requestedTarget) {
          const namedSelection = createDiffSelection(
            requestedBase,
            requestedTarget,
            data.requestedBaseMode,
            data.capture.name,
          );
          hasRequestedSelectionRef.current = true;
          selectedRevisionRef.current = namedSelection;
          setSelectedRevision(namedSelection);
        }

        // Lock files are now automatically marked as viewed by useViewedFiles hook
      } catch (err) {
        if ((err as { name?: string } | null)?.name === 'AbortError') {
          return;
        }
        if (diffRequestIdRef.current !== requestId) {
          return;
        }
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        if (activeDiffAbortControllerRef.current === controller) {
          activeDiffAbortControllerRef.current = null;
        }
        if (diffRequestIdRef.current === requestId) {
          setLoading(false);
        }
      }
    },
    [ignoreWhitespace],
  );
  fetchDiffDataRef.current = fetchDiffData;

  const previousIgnoreWhitespaceRef = useRef(ignoreWhitespace);
  useEffect(() => {
    const whitespaceChanged = previousIgnoreWhitespaceRef.current !== ignoreWhitespace;
    previousIgnoreWhitespaceRef.current = ignoreWhitespace;
    // Imported patches use a local projection; refetching would only rebuild the same
    // immutable patch and temporarily discard the merged display chunks.
    if (
      whitespaceChanged &&
      (selectedRevisionRef.current.reviewName !== undefined ||
        selectedRevisionRef.current.targetCommitish === 'stdin')
    )
      return;
    void fetchDiffData();
  }, [fetchDiffData, ignoreWhitespace]);

  useEffect(() => {
    return () => {
      activeDiffAbortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (isMobile && diffMode !== 'unified') {
      setDiffMode('unified');
    }
  }, [diffMode, isMobile]);

  // Save only values that changed, so opening gavel writes no settings cookie,
  // including when development mode runs mount effects twice.
  const savedSidebarWidthRef = useRef(sidebarWidth);
  useEffect(() => {
    if (sidebarWidth === savedSidebarWidthRef.current) {
      return;
    }
    savedSidebarWidthRef.current = sidebarWidth;
    saveClientSettings({ sidebarWidth });
  }, [sidebarWidth]);

  const savedSidebarOpenRef = useRef(isFileTreeOpen);
  useEffect(() => {
    if (isFileTreeOpen === savedSidebarOpenRef.current) {
      return;
    }
    savedSidebarOpenRef.current = isFileTreeOpen;
    saveClientSettings({ sidebarOpen: isFileTreeOpen });
  }, [isFileTreeOpen]);

  // Fetch revision options on mount
  useEffect(() => {
    fetch('/api/revisions')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: RevisionsResponse | null) => {
        setRevisionOptions(data);
        if (
          data?.resolvedBase &&
          normalizeBaseMode(currentRequestedBaseModeRef.current) !== 'merge-base'
        ) {
          setResolvedBaseRevision((prev) => prev || data.resolvedBase || '');
        }
        if (data?.resolvedTarget) {
          setResolvedTargetRevision((prev) => prev || data.resolvedTarget || '');
        }
      })
      .catch(() => setRevisionOptions(null));
  }, []);

  const loadRecentReviews = useCallback(async () => {
    const requestId = ++recentReviewsRequestRef.current;
    try {
      const response = await fetch('/api/conversation/snapshot');
      if (!response.ok) return;
      const snapshot = (await response.json()) as ConversationSnapshot;
      if (requestId !== recentReviewsRequestRef.current) return;
      // Follow the open named review by its ID, which also covers a rename or delete this page
      // missed while disconnected, even when a new review has since taken the name. After a
      // delete the page shows the uncommitted changes, as the server's default view then does.
      const shown = selectedRevisionRef.current;
      const id =
        shown.reviewName === undefined ? undefined : reviewIdsRef.current.get(shown.reviewName);
      const known = snapshot.reviews.find((review) => review.id === id);
      // Every renamed review's waiting changes follow it, whichever review the page shows.
      const previousNames = new Map([...reviewIdsRef.current].map(([name, key]) => [key, name]));
      for (const review of snapshot.reviews) {
        const before = previousNames.get(review.id);
        if (review.capture && before !== undefined && before !== review.capture.name)
          retargetOpsRef.current(before, review.capture.name);
      }
      reviewIdsRef.current = new Map(
        snapshot.reviews.flatMap((review) =>
          review.capture ? [[review.capture.name, review.id]] : [],
        ),
      );
      if (known?.capture && known.capture.name !== shown.reviewName)
        switchReviewRef.current?.({ ...shown, reviewName: known.capture.name, retained: true });
      else if (snapshot.deletedReviews?.some((review) => review.id === id))
        switchReviewRef.current?.(createDiffSelection('HEAD', '.'));
      const reviews = snapshot.reviews.map((review) => ({
        review,
        selection: review.capture
          ? { ...review.selection, reviewName: review.capture.name }
          : review.selection,
        title:
          (review.summary.commitMessage.trim() || review.summary.rationale.trim()).split('\n')[0] ??
          '',
      }));
      setRecentReviews(
        reviews
          .filter(
            ({ review }) =>
              Boolean(review.capture) ||
              review.threads.length > 0 ||
              Boolean(review.summary.commitMessage.trim() || review.summary.rationale.trim()),
          )
          .map(({ review, selection, title }) => ({
            selection,
            capture: review.capture,
            title,
            threadCount: review.threads.length,
          }))
          .reverse(),
      );
      // Proposed commit messages are what agents ask approval for; a message the server
      // copied from a browsed commit is not one.
      const proposals = reviews.filter(
        ({ review }) =>
          !review.capture &&
          Boolean(review.summary.commitMessage.trim()) &&
          !review.summary.fromCommit,
      );
      // A commit that moves HEAD gives an unnamed working-tree review a new base, so a new
      // review; the old one stays on the server, and its approval lapses once the next edit
      // changes its diff. Only the newest one per target, with or without a proposal, is
      // pending. A base browsed for the same target before an agent proposed hides the
      // older review too; that is unsupported.
      const newestWorkingTree = new Map(
        reviews
          .filter(
            ({ review }) =>
              !review.capture && isWorkingTreeTarget(review.selection.targetCommitish),
          )
          .map(({ review }) => [review.selection.targetCommitish, review.id]),
      );
      const tabbedReviews = reviews.filter(
        (entry) =>
          entry.review.capture ||
          (proposals.includes(entry) &&
            (!isWorkingTreeTarget(entry.review.selection.targetCommitish) ||
              newestWorkingTree.get(entry.review.selection.targetCommitish) === entry.review.id)),
      );
      const requests = tabbedReviews.map(({ review, selection, title }) => ({
        selection,
        name: formatReviewSelection(selection),
        title,
        approval: review.approval,
      }));
      setApprovalRequests(requests);
      const toConversation = (
        review: ConversationSnapshotReview,
        selection: DiffSelection,
      ): OtherReviewConversation => {
        const conversationThreads = review.threads.map(toCommentThread);
        return {
          key: getDiffSelectionKey(selection),
          name: formatReviewSelection(selection),
          selection,
          threads: conversationThreads,
          showAuthorBadges: hasMultipleCommentAuthors(
            conversationThreads.flatMap((thread) => thread.messages),
          ),
        };
      };
      setReviewConversations([
        ...reviews
          .filter((entry) => entry.review.threads.length > 0 || tabbedReviews.includes(entry))
          .map(({ review, selection }) => toConversation(review, selection)),
        // A new review may reuse a deleted one's name, so a deleted review is keyed by its ID.
        ...(snapshot.deletedReviews ?? [])
          .filter((review) => review.threads.length > 0)
          .map((review) => ({
            ...toConversation(review, review.selection),
            key: `deleted:${review.id}`,
            deleted: true as const,
          })),
      ]);
      setHasLoadedReviews(true);
      // The picker is gone while an agent asks for approval; so is a dialog it opened.
      if (requests.length > 0) setIsRevisionModalOpen(false);
    } catch (historyError) {
      console.error('Could not load recent reviews:', historyError);
    }
  }, []);

  loadRecentReviewsRef.current = loadRecentReviews;
  useEffect(() => {
    void loadRecentReviews();
  }, [loadRecentReviews]);

  const handleRevisionChange = useCallback(
    // null when the browser already moved to the review's URL (Back or Forward).
    async (nextSelection: ReviewSelection, history: 'push' | 'replace' | null = 'push') => {
      // Skip if no actual change
      if (
        diffSelectionsEqual(nextSelection, selectedRevisionRef.current) &&
        nextSelection.retained === selectedRevisionRef.current.retained
      )
        return;

      if (history) writeReviewLocation(nextSelection, history);
      preserveReviewLocationRef.current = history === null;

      hasRequestedSelectionRef.current = true;
      selectedRevisionRef.current = nextSelection;
      setSelectedRevision(nextSelection);
      setLoading(true);
      setError(null);
      await fetchDiffData(nextSelection, history === null);
    },
    [fetchDiffData],
  );

  useEffect(() => {
    const restoreReview = () => {
      // A comment link's entry differs only in its fragment. Restoring its saved resolved
      // selection would reload the review, and pin a Git comparison to its launch commits.
      const requested = readReviewLocation();
      const shown = selectedRevisionRef.current;
      if (
        requested &&
        diffSelectionsEqual(requested, shown) &&
        (requested.reviewName !== undefined ||
          Boolean(requested.retained) === Boolean(shown.retained))
      )
        return;
      const selection = readReviewHistoryLocation();
      if (selection) void handleRevisionChange(selection, null);
    };
    window.addEventListener('popstate', restoreReview);
    return () => window.removeEventListener('popstate', restoreReview);
  }, [handleRevisionChange]);

  // Replace, not push: a page whose history holds one entry may close itself once every
  // review has a verdict.
  switchReviewRef.current = (selection) => void handleRevisionChange(selection, 'replace');
  const openReviewFromTab = useCallback(
    (selection: DiffSelection) =>
      void handleRevisionChange({ ...selection, retained: true }, 'replace'),
    [handleRevisionChange],
  );
  const openOtherReviewThread = useCallback(
    (review: OtherReviewConversation, threadId: string) => {
      setThreadToFocus(threadId);
      openReviewFromTab(review.selection);
    },
    [openReviewFromTab],
  );
  const clearThreadToFocus = useCallback(() => setThreadToFocus(null), []);
  // A listener subscription cannot start a new turn in the owning Codex chat.
  const requiresResume = /^codex\b/i.test(diffData?.reviewContext?.agent ?? '');
  const verdictFollowUp = useVerdictFollowUp({
    reviews: approvalRequests,
    current: resolvedSelection,
    currentHasVerdict: approval.verdict !== undefined,
    // A verdict that did not reach the owning session needs the same hand-back before the tab
    // closes. The follow-up reads this when its countdown ends, so a failure that arrives during
    // the countdown still counts.
    requiresResume: requiresResume || inboxDelivery.delivery?.status === 'failed',
    onSwitch: openReviewFromTab,
  });

  // Leaving with a review that has no verdict asks first. Browsers show their own wording and
  // paint the pulse only if the reviewer stays.
  const reviewsNeedVerdict =
    Boolean(diffData?.shipIt) && approvalRequests.some((review) => !hasVerdict(review.approval));
  const { pulseNow } = verdictFollowUp;
  useEffect(() => {
    if (!reviewsNeedVerdict) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      pulseNow();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [reviewsNeedVerdict, pulseNow]);

  // Clear viewed files on initial load if requested via CLI flag; the server clears comments.
  const hasCleanedRef = useRef(false);
  useEffect(() => {
    if (diffData?.clearComments && !hasCleanedRef.current) {
      hasCleanedRef.current = true;
      clearViewedFiles();
      console.log(
        '✅ All existing comments and viewed files cleared as requested via --clean flag',
      );
    }
  }, [diffData?.clearComments, clearViewedFiles]);

  // Earlier versions kept a copy of sent threads, and undo copies, in the browser. The threads in
  // it that the server lacks are sent once, unless --clean asked for none, and then both go.
  const migratedRecordsRef = useRef(new Set<string>());
  useEffect(() => {
    if (!hasLoadedComments || !storageSelection) return;
    const record = [
      storageSelection.baseCommitish,
      storageSelection.targetCommitish,
      storageCommit,
      undefined,
      diffData?.repositoryId,
      storageSelection.baseMode,
    ] as const;
    const recordKey = JSON.stringify(record);
    if (migratedRecordsRef.current.has(recordKey)) return;
    migratedRecordsRef.current.add(recordKey);
    const kept = storageService.getCommentThreads(...record);
    if (!diffData?.clearComments)
      for (const thread of kept)
        if (!threads.some(({ id }) => id === thread.id)) enqueue({ type: 'thread.add', thread });
    storageService.removeCommentThreads(...record);
  }, [
    hasLoadedComments,
    storageSelection,
    storageCommit,
    diffData?.repositoryId,
    diffData?.clearComments,
    threads,
    enqueue,
  ]);

  const reviewPresence = useReviewPresence();
  const reviewContext = diffData?.reviewContext;
  const pageTitle =
    diffData?.title ??
    (reviewContext
      ? `${reviewContext.repositoryName || 'Imported diff'} — gavel (${window.location.host})`
      : undefined);
  const unreadCount = agentUpdates.length;
  useEffect(() => {
    if (!pageTitle) return;
    const previous = document.title;
    document.title = unreadCount > 0 ? `(${unreadCount}) ${pageTitle}` : pageTitle;
    return () => {
      document.title = previous;
    };
  }, [pageTitle, unreadCount]);
  const agentReadContext = useMemo(
    () => ({
      enabled: hasLoadedComments && !captureReloading,
      unreadKeys: new Set(agentUpdates.map((update) => update.key)),
      setRead: setAgentMessageRead,
    }),
    [hasLoadedComments, captureReloading, agentUpdates, setAgentMessageRead],
  );
  const markAllReviewsRepliesRead = useCallback(() => {
    for (const update of agentUpdates) {
      setAgentMessageRead(update.thread.id, update.message.id, update.revision, true);
    }
  }, [agentUpdates, setAgentMessageRead]);
  const markThisReviewRepliesRead = useCallback(() => {
    for (const update of agentUpdates) {
      if (normalizedThreads.includes(update.thread)) {
        setAgentMessageRead(update.thread.id, update.message.id, update.revision, true);
      }
    }
  }, [agentUpdates, normalizedThreads, setAgentMessageRead]);

  const handleAddComment = useCallback(
    (
      file: string,
      line: LineNumber,
      body: string,
      codeContent?: string,
      side?: DiffSide,
      options?: CommentSubmitOptions,
    ): Promise<void> => {
      addThread({
        filePath: file,
        body,
        isQuestion: options?.isQuestion,
        intent: options?.intent,
        side: side || 'new',
        line: typeof line === 'number' ? line : { start: line[0], end: line[1] },
        codeSnapshot:
          codeContent !== undefined
            ? {
                content: codeContent,
                language: undefined,
              }
            : undefined,
      });
      return Promise.resolve();
    },
    [addThread],
  );

  const handleCopyAllComments = async () => {
    try {
      const prompt = generateAllCommentsPrompt({
        ...promptOrigin,
        requestedBaseCommitish: diffData?.requestedBaseCommitish,
        requestedTargetCommitish: diffData?.requestedTargetCommitish,
        baseMode: normalizeBaseMode(diffData?.requestedBaseMode),
        resolvedBaseCommitish: diffData?.baseCommitish,
        resolvedTargetCommitish: diffData?.targetCommitish,
      });
      await copyTextToClipboard(prompt);
      setIsCopiedAll(true);
      setTimeout(() => setIsCopiedAll(false), 2000);
    } catch (error) {
      console.error('Failed to copy all comments prompt:', error);
    }
  };

  const handleReplyToThread = useCallback(
    (threadId: string, body: string, intent?: CommentIntent): Promise<void> => {
      replyToThread({ threadId, body, intent });
      return Promise.resolve();
    },
    [replyToThread],
  );

  const handleNavigateToComment = (thread: CommentThread) => {
    if (!diffData) return;

    const position = findCommentPosition(thread, navigableFiles);
    if (position) {
      setCursorPosition(position);
    }
  };

  // A draft's or comment link's line may sit in hidden context that DiffViewer has not
  // expanded yet (after a reload, or while the file is not rendered); it appears in
  // navigableFiles once DiffViewer does, and the jump waits for it. Until then the view sits
  // at the top of its file. The next click anywhere, or opening Conversation, cancels the wait.
  useEffect(() => {
    if (!pendingLineJump) return;
    const position = findDraftPosition(pendingLineJump, navigableFiles);
    if (!position) return;
    // The scroll to the file would otherwise correct itself back to the header.
    cancelFileScroll();
    setPendingLineJump(null);
    const behavior = pendingJumpBehavior.current;
    requestAnimationFrame(() => setCursorPosition(position, behavior));
  }, [pendingLineJump, navigableFiles, setCursorPosition, cancelFileScroll]);

  // The draft's file may be collapsed (marked viewed after the draft was written), so
  // it opens either way. A line the hunks show gets the cursor once its rows render;
  // scrolling to the file as well would end at its header, because that scroll
  // corrects itself 180 ms later. Otherwise the jump scrolls to the file, which renders
  // it so DiffViewer can expand the draft's context, and waits for the line.
  const handleNavigateToDraftLine = (anchor: LineDraftAnchor, behavior: CursorScroll = 'auto') => {
    const position = findDraftPosition(anchor, navigableFiles);
    if (!position) {
      pendingJumpBehavior.current = behavior;
      setPendingLineJump(anchor);
      handleSidebarFileSelected(anchor.filePath);
      return;
    }
    setCollapsedFiles((previous) => {
      if (!previous.has(anchor.filePath)) return previous;
      const next = new Set(previous);
      next.delete(anchor.filePath);
      return next;
    });
    requestAnimationFrame(() => setCursorPosition(position, behavior));
  };

  // A comment link's line can show unless the hunks leave it out and the diff cannot load the
  // context around them (a named review's capture, piped input, an image).
  const canShowLinkedLine = (anchor: LineDraftAnchor) => {
    const file = navigableFiles.find((candidate) => candidate.path === anchor.filePath);
    if (!file || !diffData) return false;
    return (
      findDraftPosition(anchor, navigableFiles) !== null ||
      fileCanExpandHiddenLines(file, {
        contextUnavailable: Boolean(diffData.capture),
        baseCommitish: diffData.baseCommitish,
        targetCommitish: diffData.targetCommitish,
      })
    );
  };
  const linkedFilePaths = useMemo(() => navigableFiles.map((file) => file.path), [navigableFiles]);
  const commentLinks = useCommentLinks({
    ready: !loading && hasLoadedComments,
    currentSelection: resolvedSelection,
    reviews: liveReviewConversations,
    threads: normalizedThreads,
    filePaths: linkedFilePaths,
    switchReview: openReviewFromTab,
    canShowLine: canShowLinkedLine,
    jumpToLine: (anchor) => {
      setIsCommentsListOpen(false);
      handleNavigateToDraftLine(anchor, linkScrollBehavior());
    },
    openFile: (filePath) => {
      setIsCommentsListOpen(false);
      handleSidebarFileSelected(filePath);
    },
    // The line's own scroll would still be animating when the card is measured, so the card
    // reveal below is this jump's only scroll.
    jumpToThread: (anchor, threadId) => {
      setIsCommentsListOpen(false);
      handleNavigateToDraftLine(anchor, 'none');
      setThreadToReveal(threadId);
    },
    focusInConversation: (threadId) => {
      setThreadToFocus(threadId);
      setIsCommentsListOpen(true);
    },
  });

  // A thread jump moves the cursor to the thread's line without scrolling; this scrolls the
  // comment card below it to the top third of the screen when the card is not fully visible.
  // The card renders with its line, so this waits until any pending line jump has landed and
  // the card exists.
  const scrollToElement = useMemo(() => createScrollToElement(), []);
  useEffect(() => {
    if (!threadToReveal || pendingLineJump) return;
    const frame = requestAnimationFrame(() => {
      const elementId = `comment-thread-${threadToReveal}`;
      const card = document.getElementById(elementId);
      if (!card) return;
      setThreadToReveal(null);
      // The glow holds while a smooth scroll brings the card in, so it is still there on arrival.
      const behavior = linkScrollBehavior();
      const scrolling = scrollToElement(elementId, behavior) && behavior === 'smooth';
      glowLinkTarget(card, scrolling ? diffScrollContainerRef.current : null);
    });
    return () => cancelAnimationFrame(frame);
  }, [threadToReveal, pendingLineJump, cursor, scrollToElement]);

  const handleOpenInEditor = useCallback(
    async (filePath: string, lineNumber: number) => {
      try {
        const response = await fetch('/api/open-in-editor', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(editorSessionToken ? { [EDITOR_SESSION_HEADER]: editorSessionToken } : {}),
          },
          body: JSON.stringify({
            filePath,
            line: lineNumber,
          }),
        });

        if (!response.ok) {
          const payload: unknown = await response.json().catch(() => null);
          let message = response.statusText;
          if (
            payload &&
            typeof payload === 'object' &&
            'error' in payload &&
            typeof (payload as { error?: unknown }).error === 'string'
          ) {
            message = (payload as { error: string }).error;
          }
          console.error('Failed to open file in editor:', message);
        }
      } catch (error) {
        console.error('Failed to open file in editor:', error);
      }
    },
    [editorSessionToken],
  );

  const handleGlobalClick = (e: React.MouseEvent) => {
    // Clear cursor position
    setCursorPosition(null);
    setPendingLineJump(null);
    setThreadToReveal(null);

    // Check if clicking on a comment button
    const target = e.target as HTMLElement;
    const isCommentButton = target.closest('[data-comment-button="true"]');
    const isOpenInEditorButton = target.closest('[data-open-in-editor-button="true"]');
    const isShiftRangeClick = e.shiftKey && target.closest('[data-diff-line-row="true"]');

    // Close empty comment forms (unless clicking on a comment button)
    if (!isCommentButton && !isOpenInEditorButton && !isShiftRangeClick) {
      resetEmptyCommentFormsOutside(target);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-dvh bg-github-bg-primary">
        <div className="text-github-text-secondary text-base">Loading diff...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-dvh bg-github-bg-primary text-center gap-2">
        <h2 className="text-github-danger text-2xl mb-2">Error</h2>
        <p className="text-github-text-secondary text-base">{error}</p>
      </div>
    );
  }

  if (!diffData) {
    return (
      <div className="flex flex-col items-center justify-center h-dvh bg-github-bg-primary text-center gap-2">
        <h2 className="text-github-danger text-2xl mb-2">No data</h2>
        <p className="text-github-text-secondary text-base">No diff data available</p>
      </div>
    );
  }

  const allFilesViewed =
    diffData.files.length > 0 && viewedFilesInDiffCount === diffData.files.length;
  const canOpenInEditor = diffData.openInEditorAvailable !== false && Boolean(editorSessionToken);

  return (
    <ReviewProviders
      agentUpdates={agentReadContext}
      draftScope={draftScope}
      followCommentLink={commentLinks.follow}
    >
      <div className="h-dvh flex flex-col" onClickCapture={handleGlobalClick}>
        {/* The 0fr row collapses the header group to nothing without measuring it, and the
            diff below grows into the space. */}
        <div
          data-testid="review-chrome"
          data-hidden={reviewChrome.headerHidden ? 'true' : 'false'}
          className="grid min-h-0 transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none"
          style={{ gridTemplateRows: reviewChrome.headerHidden ? '0fr' : '1fr' }}
          onFocusCapture={reviewChrome.revealHeader}
        >
          <div ref={reviewChrome.headerRef} className="flex min-h-0 flex-col overflow-hidden">
            <header
              className="review-toolbar flex shrink-0 flex-wrap items-stretch justify-end gap-1 border-b border-github-border bg-github-bg-secondary px-3 py-2 text-sm text-github-text-primary md:gap-2"
              data-testid="compact-review-header"
            >
              {diffData.capture && (
                <div role="status" aria-label="Named review capture" className="sr-only">
                  <span>{diffData.capture.name}</span>
                  <span>capture v{diffData.capture.version}</span>
                  <span>{diffData.capture.patchDigest.slice(0, 12)}</span>
                </div>
              )}
              <div className="mr-auto flex min-w-0 max-w-full flex-wrap items-center gap-1 md:gap-2">
                <button
                  type="button"
                  onClick={() => setIsFileTreeOpen(!isFileTreeOpen)}
                  className="shrink-0 rounded p-2 hover:bg-github-bg-tertiary"
                  title={isFileTreeOpen ? 'Collapse file tree' : 'Expand file tree'}
                  aria-expanded={isFileTreeOpen}
                  aria-controls="file-tree-panel"
                  aria-label="Toggle file tree panel"
                >
                  {isFileTreeOpen ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
                </button>
                <h1 className="sr-only shrink-0 md:not-sr-only">
                  <Logo style={{ height: '18px', color: 'var(--color-github-text-primary)' }} />
                </h1>
                {captureReloading && (
                  <span role="status" className="text-xs text-github-text-secondary">
                    Updating capture…
                  </span>
                )}
              </div>
              <AgentDeliveryStatus delivery={inboxDelivery.delivery} />
              {/* While an agent asks for approval, the tabs are the way between reviews. Picking
              another comparison would create a review the tabs can't place. */}
              {revisionOptions && approvalRequests.length === 0 ? (
                <DiffQuickMenu
                  options={revisionOptions}
                  selection={selectedRevision}
                  resolvedBaseRevision={resolvedBaseRevision}
                  resolvedTargetRevision={resolvedTargetRevision}
                  resolvedSelection={resolvedSelection}
                  capture={diffData.capture}
                  onSelectDiff={(selection) => void handleRevisionChange(selection)}
                  onSelectReview={(selection) =>
                    void handleRevisionChange({ ...selection, retained: true })
                  }
                  onOpen={loadRecentReviews}
                  recentReviews={recentReviews.filter(
                    (review) => !diffSelectionsEqual(review.selection, resolvedSelection),
                  )}
                  onOpenAdvanced={() => setIsRevisionModalOpen(true)}
                />
              ) : (
                <HeaderMenu
                  title={diffData.capture?.name ?? diffData.commit}
                  label={
                    <>
                      <GitBranch size={14} aria-hidden="true" />
                      <span className="max-w-[24ch] truncate max-lg:sr-only">
                        {diffData.capture?.name ?? diffData.commit}
                      </span>
                    </>
                  }
                >
                  {diffData.capture ? (
                    <CaptureDetails capture={diffData.capture} />
                  ) : (
                    <code className="break-all">{diffData.commit}</code>
                  )}
                </HeaderMenu>
              )}
              <button
                type="button"
                aria-haspopup="dialog"
                aria-label="Settings"
                title="Settings"
                className="inline-flex items-center gap-1.5 rounded-md border border-github-border px-3 py-1.5 font-medium hover:bg-github-bg-tertiary"
                onClick={() => setIsSettingsOpen(true)}
              >
                <Settings size={14} aria-hidden="true" />
                <span className="sr-only lg:not-sr-only">Settings</span>
              </button>
              <button
                type="button"
                aria-expanded={isAboutOpen}
                aria-controls="about-panel"
                aria-haspopup="dialog"
                aria-label="About"
                title="About"
                className="inline-flex items-center gap-1.5 rounded-md border border-github-border px-3 py-1.5 font-medium hover:bg-github-bg-tertiary"
                onClick={() => {
                  setIsCommentsListOpen(false);
                  setIsAboutOpen(true);
                }}
              >
                <Info size={14} aria-hidden="true" />
                <span className="sr-only lg:not-sr-only">About</span>
              </button>
              <ReloadButton
                shouldReload={shouldReload}
                isReloading={watchState.isReloading}
                onReload={reload}
                changeType={watchState.lastChangeType}
                compact
              />
              <button
                type="button"
                aria-label="Conversation"
                aria-expanded={isCommentsListOpen}
                aria-controls="conversation-panel"
                aria-haspopup="dialog"
                aria-describedby="conversation-unread-status"
                title={
                  reviewPresence?.listeners
                    ? 'Conversation — agent listener attached'
                    : 'Conversation — no agent listener attached'
                }
                onClick={() => {
                  setIsAboutOpen(false);
                  setPendingLineJump(null);
                  setIsCommentsListOpen(true);
                }}
                className="relative inline-flex items-center gap-1.5 rounded-md border border-github-border px-3 py-1.5 font-medium hover:bg-github-bg-tertiary"
              >
                <MessageSquare size={14} aria-hidden="true" />
                <span className="sr-only lg:not-sr-only">Conversation</span>
                {/* On mobile the badge sits on the button's corner, so it doesn't widen the header. */}
                <span
                  id="conversation-unread-status"
                  aria-live="polite"
                  aria-atomic="true"
                  className="inline-flex gap-1 tabular-nums max-md:absolute max-md:-top-1.5 max-md:-right-1"
                >
                  <UnreadBadge count={agentUpdates.length} pulse={replyPulse} />
                  <DraftBadge count={draftCount} />
                  <span className="sr-only">
                    {agentUpdates.length
                      ? `${agentUpdates.length} unread agent message${agentUpdates.length === 1 ? '' : 's'}`
                      : 'No unread agent messages'}
                    {draftCount > 0 && `, ${draftCount} unsent draft${draftCount === 1 ? '' : 's'}`}
                  </span>
                </span>
              </button>
              {diffData.shipIt && (
                <VerdictControl
                  key={commentsContextKey}
                  containerRef={setVerdictControl}
                  verdict={approval.verdict}
                  busy={isShipping || captureReloading}
                  disabled={!approval.ready || !hasLoadedComments}
                  approveDisabled={!summary.ready}
                  onVerdict={(verdict) => void handleVerdict(verdict)}
                  onClear={() => void handleVerdict('clear')}
                />
              )}
              <VerdictFollowUpNotice
                anchor={verdictAnchor}
                step={verdictFollowUp.step}
                onCancel={verdictFollowUp.cancel}
                onProceed={verdictFollowUp.proceed}
              />
              {approval.error && (
                <span role="alert" className="w-full text-xs text-github-danger">
                  {approval.error}
                </span>
              )}
              {settingsSaveError && (
                <span role="alert" className="w-full text-xs text-github-danger">
                  {settingsSaveError}
                </span>
              )}
              <AgentDeliveryAlert delivery={inboxDelivery.delivery} />
              {reviewOps.alert && (
                <span role="alert" className="w-full text-xs text-github-danger">
                  {reviewOps.alert}
                </span>
              )}
            </header>
            <ReviewQueueBar
              reviews={approvalRequests}
              current={resolvedSelection}
              approvals={Boolean(diffData.shipIt)}
              pulse={verdictFollowUp.pulse}
              unreadReviews={unreadReviews}
              onSelect={openReviewFromTab}
            />
          </div>
        </div>
        {revisionOptions && (
          <RevisionDetailModal
            key={isRevisionModalOpen ? getDiffSelectionKey(selectedRevision) : 'closed'}
            isOpen={isRevisionModalOpen}
            onClose={() => setIsRevisionModalOpen(false)}
            options={revisionOptions}
            selection={selectedRevision}
            resolvedBaseRevision={resolvedBaseRevision}
            resolvedTargetRevision={resolvedTargetRevision}
            onApply={(selection) => void handleRevisionChange(selection)}
          />
        )}

        {isMobile && isFileTreeOpen && (
          <button
            type="button"
            aria-label="Close file tree"
            className="fixed inset-0 bg-black/40 z-30"
            onClick={() => setIsFileTreeOpen(false)}
          />
        )}

        <div className="flex flex-1 overflow-hidden relative">
          <div
            className={`relative overflow-hidden ${!isDragging ? '!transition-all !duration-300 !ease-in-out' : ''}`}
            style={{
              width: isMobile ? '0px' : isFileTreeOpen ? `${sidebarWidth}px` : '0px',
            }}
          >
            <aside
              id="file-tree-panel"
              className={`bg-github-bg-secondary overflow-y-auto flex flex-col ${
                isMobile
                  ? 'fixed inset-y-0 right-0 z-40 w-[min(85vw,360px)] border-l border-github-border transition-transform duration-300 ease-out'
                  : 'relative border-r border-github-border'
              }`}
              style={{
                width: isMobile ? 'min(85vw, 360px)' : `${sidebarWidth}px`,
                minWidth: isMobile ? '0px' : '200px',
                maxWidth: isMobile ? 'none' : '600px',
                height: '100%',
                transform: isMobile
                  ? isFileTreeOpen
                    ? 'translateX(0)'
                    : 'translateX(100%)'
                  : undefined,
              }}
            >
              <div className="flex-1 overflow-y-auto">
                <FileList
                  files={diffData.files}
                  headerStatus={
                    <div className="mb-3 text-xs text-github-text-secondary">
                      <span className="ui-value">
                        {allFilesViewed
                          ? 'All files viewed'
                          : `${viewedFilesInDiffCount} / ${diffData.files.length} files viewed`}
                      </span>
                      <progress
                        className="mt-1 h-1 w-full accent-github-accent"
                        value={viewedFilesInDiffCount}
                        max={Math.max(1, diffData.files.length)}
                        aria-label="Files viewed"
                      />
                    </div>
                  }
                  onScrollToFile={handleSidebarFileSelected}
                  onScrollToFirstComment={(path) =>
                    handleSidebarFileSelected(path, 'first-comment')
                  }
                  onScrollToSummary={
                    // Nothing to jump to while both fields are blank.
                    summary.commitMessage.trim() || summary.rationale.trim()
                      ? () => {
                          const main = diffScrollContainerRef.current;
                          if (!main) throw new Error('The diff scroll area is not mounted');
                          // A file click's lazy-render scroll could still land and pull the view back.
                          cancelFileScroll();
                          main.scrollTo({ top: 0 });
                        }
                      : undefined
                  }
                  onFileSelected={isMobile ? handleMobileFileSelected : undefined}
                  comments={normalizedThreads}
                  unreadUpdates={agentUpdates}
                  reviewedFiles={viewedFiles}
                  viewedStateReady={viewedStateReady}
                  onToggleReviewed={toggleFileReviewed}
                  onToggleFolderReviewed={toggleFolderReviewed}
                  selectedFilePath={topVisibleFile.topFilePath}
                />
              </div>
            </aside>
          </div>

          {!isMobile && (
            <div
              className={`bg-github-border hover:bg-github-text-muted cursor-col-resize ${!isDragging ? '!transition-all !duration-300 !ease-in-out' : ''}`}
              style={{
                width: isFileTreeOpen ? '4px' : '0px',
              }}
              onMouseDown={handleMouseDown}
              title="Drag to resize file list"
            />
          )}

          <main
            ref={diffScrollContainerRef}
            className="flex-1 overflow-y-auto"
            onScroll={(event) => {
              reviewChrome.onScroll(event);
              topVisibleFile.onScroll(event);
            }}
          >
            {/* Here rather than in the header so the fields size to their content and scroll
                away with the diff. */}
            <ReviewSummaryPanel
              summary={summary}
              committed={!diffData.capture && diffData.targetCommitMessage !== undefined}
            />
            {diffData.files.map((file, fileIndex) => {
              const fileThreads = threadsByFile.get(file.path) ?? EMPTY_COMMENT_THREADS;
              const mergedChunks = presentationChunksByPath.get(file.path) ?? EMPTY_MERGED_CHUNKS;
              const isRendered = renderedFilePaths.has(file.path);
              return (
                <div
                  key={file.path}
                  id={getFileElementId(file.path)}
                  data-file-path={file.path}
                  data-rendered={isRendered ? 'true' : 'false'}
                  ref={(node) => registerLazyFileContainer(file.path, node)}
                  className="mb-6"
                  onMouseEnter={() => {
                    hoveredFileIndexRef.current = fileIndex;
                  }}
                  onMouseLeave={() => {
                    if (hoveredFileIndexRef.current === fileIndex) {
                      hoveredFileIndexRef.current = null;
                    }
                  }}
                >
                  {isRendered ? (
                    <DiffViewer
                      file={file}
                      threads={fileThreads}
                      showAuthorBadges={showAuthorBadges}
                      diffMode={diffMode}
                      reviewedFiles={viewedFiles}
                      viewedStateReady={viewedStateReady}
                      isChangedSinceViewed={changedSinceViewedFiles.has(file.path)}
                      onToggleReviewed={handleViewedButtonToggle}
                      collapsedFiles={collapsedFiles}
                      onToggleCollapsed={toggleFileCollapsed}
                      onToggleAllCollapsed={toggleAllFilesCollapsed}
                      onAddComment={handleAddComment}
                      onGenerateThreadPrompt={handleGenerateThreadPrompt}
                      onToggleThreadResolved={toggleThreadResolved}
                      onRemoveThread={removeThread}
                      onRestoreComment={restoreComment}
                      onReplyToThread={handleReplyToThread}
                      onRemoveMessage={removeMessage}
                      onUpdateMessage={updateMessage}
                      onOpenInEditor={canOpenInEditor ? handleOpenInEditor : undefined}
                      syntaxTheme={settings.syntaxTheme}
                      baseCommitish={diffData.baseCommitish}
                      targetCommitish={diffData.targetCommitish}
                      contextUnavailable={Boolean(diffData.capture)}
                      cursor={cursor?.fileIndex === fileIndex ? cursor : null}
                      isFocused={cursor?.fileIndex === fileIndex}
                      fileIndex={fileIndex}
                      onLineClick={handleLineClick}
                      commentTrigger={
                        commentTrigger?.fileIndex === fileIndex ? commentTrigger : null
                      }
                      onCommentTriggerHandled={handleCommentTriggerHandled}
                      mergedChunks={mergedChunks}
                      expandLines={expandLines}
                      expandAllBetweenChunks={expandAllBetweenChunks}
                      expandAllLines={expandAllLines}
                      collapseExpandedLines={collapseExpandedLines}
                      prefetchFileContent={prefetchFileContent}
                      isExpandLoading={isExpandLoading}
                      diffVersion={diffDataVersion}
                      pendingJump={pendingLineJump?.filePath === file.path ? pendingLineJump : null}
                    />
                  ) : (
                    <div className="bg-github-bg-secondary border border-github-border rounded-md px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs ui-heading">Deferred Rendering</div>
                          <div className="text-sm font-mono text-github-text-primary truncate">
                            {file.path}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => ensureFileRendered(file.path)}
                          className="px-3 py-1.5 text-xs rounded border border-github-border text-github-text-secondary hover:text-github-text-primary hover:bg-github-bg-tertiary"
                        >
                          Load now
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </main>
        </div>

        {isSettingsOpen && (
          <SettingsModal
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            settings={settings}
            onSettingsChange={updateSettings}
            autoViewedPatterns={autoViewedPatterns}
            onAutoViewedPatternsChange={handleAutoViewedPatternsChange}
            diffMode={diffMode}
            onDiffModeChange={handleDiffModeChange}
            splitAvailable={!isMobile}
            ignoreWhitespace={ignoreWhitespace}
            onIgnoreWhitespaceChange={handleIgnoreWhitespaceChange}
          />
        )}

        <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
        {isAboutOpen && (
          <AboutPanel
            context={diffData.reviewContext}
            onClose={closeAbout}
            onShowShortcuts={() => {
              setIsAboutOpen(false);
              setIsHelpOpen(true);
            }}
          />
        )}
        <CommentsListModal
          isOpen={isCommentsListOpen}
          unsentDrafts={{
            diffFilePaths,
            onAddComment: handleAddComment,
            onNavigateToLine: handleNavigateToDraftLine,
            codeFor: codeForDraft,
          }}
          onClose={() => {
            setIsCommentsListOpen(false);
            setThreadToFocus(null);
          }}
          headerActions={
            <>
              {/* The header's agent status covers reviews an agent session owns. This listener
                  view, with its resume prompt, remains for older servers and for reviews no
                  session owns, which phones' headers have no room to show. */}
              {(!inboxDelivery.delivery || inboxDelivery.delivery.status === 'unavailable') && (
                <ReviewPresenceIndicator
                  presence={reviewPresence}
                  requiresResume={requiresResume}
                />
              )}
              {threads.length > 0 && (
                <CommentsDropdown
                  commentsCount={threads.length}
                  isCopiedAll={isCopiedAll}
                  onCopyAll={handleCopyAllComments}
                  onDeleteAll={clearAllComments}
                />
              )}
            </>
          }
          unreadUpdates={agentUpdates}
          readScope={commentsContextKey}
          onMarkAllRead={markThisReviewRepliesRead}
          onMarkAllReviewsRead={markAllReviewsRepliesRead}
          otherReviews={otherReviews}
          currentReviewName={
            resolvedSelection ? formatReviewSelection(resolvedSelection) : undefined
          }
          onOpenOtherReviewThread={openOtherReviewThread}
          // Waiting for the server's threads lets it pick the first unread reply.
          focusThreadId={hasLoadedComments ? threadToFocus : null}
          onThreadFocused={clearThreadToFocus}
          onNavigate={handleNavigateToComment}
          comments={displayThreads}
          onAddGeneralComment={(body, options) => {
            addReviewThread(body, options);
            return Promise.resolve();
          }}
          showAuthorBadges={showAuthorBadges}
          onToggleThreadResolved={toggleThreadResolved}
          onRemoveThread={removeThread}
          onRestoreComment={restoreComment}
          onGenerateThreadPrompt={handleGenerateThreadPrompt}
          onReplyToThread={handleReplyToThread}
          onRemoveMessage={removeMessage}
          onUpdateMessage={updateMessage}
          syntaxTheme={settings.syntaxTheme}
        />
        <CommentLinkNotice message={commentLinks.notice} onDismiss={commentLinks.dismissNotice} />
      </div>
    </ReviewProviders>
  );
}

export default App;
