import { toCommentThread } from '../utils/commentThreads.js';
import { spawn } from 'child_process';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { type Server } from 'http';
import type { AddressInfo } from 'net';
import { hostname } from 'os';
import { join, dirname, isAbsolute, resolve, sep } from 'path';
import { fileURLToPath } from 'url';

import express, { type Express, type ErrorRequestHandler } from 'express';
import open from 'open';
import { WebSocket, WebSocketServer } from 'ws';

import type {
  ReviewApproval,
  ReviewStoreStatus,
  ReviewSummary,
  ReviewVerdict,
  ConversationStreamEvent,
} from '../types/conversation.js';
import type { ServerEvent, ServerShutdownEvent } from '../types/events.js';
import { writeJsonl } from './event-output.js';
import type { NamedReviewStart, ReviewCapture } from '../types/review.js';
import { NamedReviewError, NamedReviewStore, type NamedReviewState } from './named-reviews.js';
import { getCaptureRepository, validateCapture } from './review-capture.js';
import { openReviewStore, savedReviewKey, type SavedReview } from './review-store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { type DiffMode, type WatchEvent } from '../types/watch.js';
import {
  LIVE_OTHER_SERVER,
  LIVE_PATH,
  type LiveServerMessage,
  type LiveVisibilityMessage,
} from '../types/live.js';
import { formatCommentsOutput } from '../utils/commentFormatting.js';
import {
  mergeCommentImports,
  mergeCommentThreads,
  normalizeCommentImports,
  serializeCommentImports,
} from '../utils/commentImports.js';
import {
  buildEditorSpawnSpec,
  CUSTOM_EDITOR_ID,
  EDITOR_OPTIONS,
  EDITOR_SESSION_FRAGMENT_KEY,
  EDITOR_SESSION_HEADER,
  NONE_EDITOR_ID,
  parseEditorArgsTemplate,
  resolveEditorOption,
} from '../utils/editorOptions.js';
import { getFileExtension } from '../utils/fileUtils.js';

import { FileWatcherService } from './file-watcher.js';
import { Conversation, onRevision, registerConversationRoutes } from './conversation.js';
import { ReviewPresence } from './review-presence.js';
import {
  SessionInbox,
  inboxRuntimeDir,
  isThisHost,
  parseInboxTarget,
  type InboxTarget,
} from './session-inbox.js';
import { emptyReviewSummary, parseReviewSummaryInput } from './review-summary.js';
import { GitDiffParser } from './git-diff.js';
import {
  parseAutoViewedPatternsBody,
  readUserConfig,
  writeAutoViewedPatterns,
} from './user-config.js';

import {
  type BaseMode,
  type CommentImport,
  type Comment,
  type CommentThread,
  type DiffCommentThread,
  type DiffResponse,
  type DiffSelection,
  type GeneratedStatusResponse,
  type RevisionsResponse,
  type ReviewContext,
} from '@/types/diff.js';
import {
  createDiffSelection,
  diffSelectionsEqual,
  getDiffSelectionKey,
  isWorkingTreeTarget,
} from '../utils/diffSelection.js';

export interface ServerOptions {
  namedReview?: NamedReviewStart;
  selection?: DiffSelection;
  // The command line named the commit-ish rather than defaulting to HEAD.
  explicitTarget?: boolean;
  stdinDiff?: string;
  preferredPort?: number;
  host?: string;
  openBrowser?: boolean;
  ignoreWhitespace?: boolean;
  clearComments?: boolean;
  shipIt?: boolean;
  conversation?: boolean;
  jsonl?: boolean;
  onEvent?: (event: ServerEvent) => void;
  onReady?: (server: {
    shutdown: (reason: ServerShutdownEvent['reason']) => Promise<void>;
    port: number;
  }) => void;
  commitMessage?: string;
  why?: string;
  commentImports?: CommentImport[];
  keepAlive?: boolean;
  diffMode?: DiffMode;
  repoPath?: string;
  contextLines?: number;
  title?: string;
  agent?: string;
  agentSessionName?: string;
  agentSessionId?: string;
  /** The launching Claude Code session's inbox: human review activity is sent there. */
  inbox?: InboxTarget;
}

const GENERATED_STATUS_CACHE_TTL_MS = 60_000;
const MAX_DIFF_CACHE_ENTRIES = 8;

function createDiffCacheKey(selection: DiffSelection, ignoreWhitespace: boolean) {
  return `${getDiffSelectionKey(selection)}\u0000${ignoreWhitespace ? '1' : '0'}`;
}

function getCachedDiffResponse(
  cache: Map<string, DiffResponse>,
  key: string,
): DiffResponse | undefined {
  const cached = cache.get(key);
  if (!cached) {
    return undefined;
  }

  // Refresh insertion order to keep the most recently used entry.
  cache.delete(key);
  cache.set(key, cached);
  return cached;
}

function setCachedDiffResponse(cache: Map<string, DiffResponse>, key: string, value: DiffResponse) {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, value);

  while (cache.size > MAX_DIFF_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey !== 'string') {
      break;
    }
    cache.delete(oldestKey);
  }
}

interface CommentSessionState {
  threads: DiffCommentThread[];
  version: number;
}

function createResolvedCommentSelection(
  responseDiffData: DiffResponse,
  fallbackSelection: DiffSelection,
  stdinDiff: boolean,
): DiffSelection {
  const baseCommitish =
    responseDiffData.baseCommitish ?? (stdinDiff ? 'stdin' : fallbackSelection.baseCommitish);
  const targetCommitish =
    responseDiffData.targetCommitish ?? (stdinDiff ? 'stdin' : fallbackSelection.targetCommitish);
  const baseMode = responseDiffData.requestedBaseMode ?? fallbackSelection.baseMode;

  return createDiffSelection(
    baseCommitish,
    targetCommitish,
    baseMode,
    fallbackSelection.reviewName,
  );
}

// A save that found its lock briefly contended tries again after this long.
const SAVE_RETRY_MS = 50;
const VERDICT_LOG_NAMES: Record<ReviewVerdict, string> = {
  'as-is': 'approved as-is',
  'after-comments': 'approved after comments',
  reject: 'rejected',
};

function createCommentSessionKey(selection: DiffSelection): string {
  return getDiffSelectionKey(selection);
}

// The digest of a staged or worktree diff with no changes, whitespace included.
const EMPTY_DIFF_DIGEST = createHash('sha256').digest('hex');

// What `git commit` stores for a message: no trailing spaces, at most one blank line in a row.
function normalizeCommitMessage(message: string): string {
  return message
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function startServer(options: ServerOptions): Promise<{
  port: number;
  url: string;
  launchUrl: string;
  isEmpty?: boolean;
  server?: Server;
  shutdown: (reason: ServerShutdownEvent['reason']) => Promise<void>;
}> {
  if (options.namedReview && options.conversation === false) {
    throw new Error('Named reviews require conversation mode');
  }
  const app = express();
  const captureRepository = await getCaptureRepository(options.repoPath ?? process.cwd()).catch(
    (error) => {
      if (options.namedReview) throw error;
      // Stdin patches also work outside Git, but a Git-backed server must bind
      // future named captures to the canonical worktree root, not the launch folder.
      return undefined;
    },
  );
  const repositoryPath =
    captureRepository?.repositoryRoot ?? resolve(options.repoPath ?? process.cwd());
  const repositoryId =
    captureRepository?.repositoryId ?? createHash('sha256').update(repositoryPath).digest('hex');
  const namedReviews = new NamedReviewStore({ repositoryRoot: repositoryPath, repositoryId });
  const conversationEnabled = Boolean(
    options.namedReview || options.conversation || options.jsonl || options.onEvent,
  );
  // Review state outlives this process only for a Git repository's conversation reviews.
  const reviewStore =
    captureRepository && conversationEnabled ? await openReviewStore(repositoryPath) : undefined;
  const storeServer = reviewStore?.registerServer();
  // Cleanup that fails, such as on a read-only store, leaves the files and lets the server run.
  let cleanupError: string | undefined;
  if (reviewStore && storeServer) {
    let problems: string[];
    try {
      problems = reviewStore.vacuum(storeServer.owner);
    } catch (error) {
      problems = [
        `${reviewStore.directory}: ${error instanceof Error ? error.message : String(error)}`,
      ];
    }
    if (problems.length) {
      cleanupError = `could not clean up ${problems.length} saved-review file(s), which stay; saving is unaffected: ${problems.join('; ')}`;
      console.error(`gavel ${cleanupError}`);
    }
  }
  // Reviews another running server owns: this one neither restores nor saves them, and the
  // snapshot names them, so an agent knows their changes here are not being saved.
  const ownedElsewhere = new Set<string>();
  // Under --clean, the launched review's key: it alone starts without its saved comments.
  let cleanKey: string | undefined;
  function loadSavedReview(key: string | undefined): SavedReview | undefined {
    if (!reviewStore || !storeServer || !key) return undefined;
    if (reviewStore.ownedByAnotherServer(key, storeServer.owner)) {
      ownedElsewhere.add(key);
      return undefined;
    }
    const saved = reviewStore.load(key);
    return saved && key === cleanKey ? { ...saved, threads: [], progress: [] } : saved;
  }
  const reviewLabel = (selection: DiffSelection) =>
    selection.reviewName ?? `${selection.baseCommitish}..${selection.targetCommitish}`;
  const reviewKey = (selection: DiffSelection) =>
    savedReviewKey(
      repositoryId,
      selection,
      selection.reviewName ? namedReviews.get(selection.reviewName)?.metadata : undefined,
    );
  // A name and patch an earlier server saved come back with their capture history.
  function createNamedReview(name: string, capture: ReviewCapture): NamedReviewState {
    const saved = loadSavedReview(
      savedReviewKey(
        repositoryId,
        createDiffSelection(capture.baseCommit, '.', undefined, name),
        capture,
      ),
    );
    if (!reviewStore || !saved?.captures) return namedReviews.create(name, capture);
    return namedReviews.restore(
      name,
      saved.captures.map((entry) => reviewStore.loadCapture(repositoryId, entry)),
    );
  }
  const initialNamedReview = options.namedReview
    ? createNamedReview(options.namedReview.name, options.namedReview.capture)
    : undefined;
  const editorSessionToken = randomBytes(16).toString('base64url');
  const editorSessionTokenBytes = Buffer.from(editorSessionToken);
  const editorSelection = process.env.GAVEL_EDITOR ?? process.env.EDITOR;
  const editorOption = resolveEditorOption(editorSelection);
  if (
    process.env.GAVEL_EDITOR &&
    !EDITOR_OPTIONS.some((option) => option.id === process.env.GAVEL_EDITOR?.toLowerCase())
  ) {
    console.warn(`Unknown GAVEL_EDITOR preset: ${process.env.GAVEL_EDITOR}; using vscode`);
  }
  const editorCommand =
    editorOption.id === CUSTOM_EDITOR_ID
      ? (process.env.GAVEL_EDITOR_COMMAND ?? '').trim()
      : editorOption.command;
  const editorArgsTemplate =
    editorOption.id === CUSTOM_EDITOR_ID
      ? (process.env.GAVEL_EDITOR_ARGS ?? '').trim()
      : editorOption.argsTemplate;
  const customEditorArgsSafe =
    editorOption.id !== CUSTOM_EDITOR_ID ||
    (() => {
      const tokens = parseEditorArgsTemplate(editorArgsTemplate);
      return (
        tokens.some((token) => token === '%file' || token === '%file:%line') &&
        tokens.every(
          (token) => !token.includes('%file') || token === '%file' || token === '%file:%line',
        )
      );
    })();
  if (editorOption.id === CUSTOM_EDITOR_ID) {
    if (!editorCommand) {
      console.warn('GAVEL_EDITOR=custom requires GAVEL_EDITOR_COMMAND');
    } else if (!editorArgsTemplate) {
      console.warn('GAVEL_EDITOR=custom requires GAVEL_EDITOR_ARGS');
    } else if (!customEditorArgsSafe) {
      console.warn('GAVEL_EDITOR_ARGS must pass %file or %file:%line as a separate argument');
    }
  }
  const editorAvailable =
    !options.stdinDiff &&
    editorOption.id !== NONE_EDITOR_ID &&
    editorCommand !== '' &&
    editorArgsTemplate !== '' &&
    customEditorArgsSafe;
  const initialCommentImports = options.commentImports || [];
  const initialSelection =
    initialNamedReview?.selection ?? options.selection ?? createDiffSelection('', '');
  const commentImportId =
    initialCommentImports.length > 0
      ? createHash('sha256').update(serializeCommentImports(initialCommentImports)).digest('hex')
      : undefined;
  const parser = new GitDiffParser(repositoryPath);
  const reviewContext: ReviewContext = {
    source: options.stdinDiff ? 'stdin' : 'git',
    ...(options.stdinDiff
      ? {}
      : { repositoryName: await parser.getRepositoryName(), repositoryPath }),
    workingDirectory: process.cwd(),
    hostname: hostname(),
    ...(options.agent ? { agent: options.agent } : {}),
    ...(options.agentSessionName ? { agentSessionName: options.agentSessionName } : {}),
    ...(options.agentSessionId ? { agentSessionId: options.agentSessionId } : {}),
  };
  const fileWatcher = new FileWatcherService();
  const presence = new ReviewPresence();
  let closing = false;
  let reviewerDisconnectTimer: NodeJS.Timeout | undefined;
  const pendingEvents: ConversationStreamEvent[] = [];
  let ready = false;
  // Created once the port is known; human events cannot arrive before the server listens.
  let inbox: SessionInbox | undefined;
  const emit = (event: ServerEvent) => {
    if (options.jsonl) writeJsonl(event);
    options.onEvent?.(event);
  };
  const conversation = conversationEnabled
    ? new Conversation(
        (event) => {
          scheduleSave(event.reviewId);
          inbox?.handle(event);
          if (ready) emit(event);
          else pendingEvents.push(event);
        },
        undefined,
        (selection) => (reviewStore ? loadSavedReview(reviewKey(selection)) : undefined),
      )
    : undefined;
  // One request can emit several events, such as a summary change and the approval it revokes.
  // Saving once they have all run keeps every saved state one the server actually reached.
  const unsavedReviews = new Set<string>();
  let saveQueued = false;
  // Set once the server closes and gives up its locks; a pending retry then saves nothing.
  let storeReleased = false;
  // Why the latest save failed or waits, until every queued review saves; the snapshot reports it.
  let saveError: string | undefined;
  function scheduleSave(reviewId: string): void {
    if (!reviewStore) return;
    unsavedReviews.add(reviewId);
    if (saveQueued) return;
    saveQueued = true;
    queueMicrotask(flushSaves);
  }
  function flushSaves(): void {
    if (!reviewStore || storeReleased) return;
    saveQueued = false;
    let busy = false;
    for (const id of [...unsavedReviews]) {
      try {
        if (saveReview(id)) {
          unsavedReviews.delete(id);
          continue;
        }
        busy = true;
        saveError = `waiting for another server to release the lock on review ${id} under ${reviewStore.directory}`;
      } catch (error) {
        // Throwing here would end the server and lose every review it holds in memory. The
        // review stays queued, so its next change retries the save.
        saveError = `could not save review ${id} under ${reviewStore.directory}: ${error instanceof Error ? error.message : String(error)}`;
        console.error(`gavel ${saveError}`);
      }
    }
    if (unsavedReviews.size === 0) saveError = undefined;
    // A contended lock frees within milliseconds, so retry without waiting for the next change.
    if (busy && !saveQueued) {
      saveQueued = true;
      setTimeout(flushSaves, SAVE_RETRY_MS).unref();
    }
  }
  // The saved file each review last wrote, so a named review's recapture replaces its old file.
  const savedReviewKeys = new Map<string, string>();
  /** Saves a review if it needs it; false when its lock is briefly contended and it must retry. */
  function saveReview(reviewId: string): boolean {
    if (!reviewStore || !storeServer || !conversation) return true;
    const review = conversation.exportReview(reviewId);
    const key = reviewKey(review.selection);
    if (!key || ownedElsewhere.has(key)) return true;
    // Browsing a commit seeds its own message; that alone is not worth a file.
    const worthSaving =
      review.capture ||
      review.threads.length > 0 ||
      review.approval.updatedAt !== undefined ||
      (review.summary.version > 0 && !review.summary.fromCommit);
    if (!worthSaving && !reviewStore.has(key)) return true;
    const history = review.selection.reviewName
      ? namedReviews.history(review.selection.reviewName)
      : [];
    for (const entry of history) reviewStore.saveCapture(entry.capture);
    const result = reviewStore.save(
      key,
      {
        format: 1,
        repositoryId,
        ...review,
        ...(history.length
          ? {
              captures: history.map(({ metadata }) => ({
                version: metadata.version,
                patchDigest: metadata.patchDigest,
                baseCommit: metadata.baseCommit,
              })),
            }
          : {}),
        updatedAt: new Date().toISOString(),
      },
      storeServer.owner,
    );
    if (result === 'busy') return false;
    // Another running server saved it first; this one keeps its copy in memory only.
    if (result === 'owned') {
      ownedElsewhere.add(key);
      return true;
    }
    // Only now that the replacement is saved does the record of an earlier capture go.
    const previousKey = savedReviewKeys.get(reviewId);
    if (previousKey && previousKey !== key) reviewStore.remove(previousKey, storeServer.owner);
    savedReviewKeys.set(reviewId, key);
    return true;
  }
  const humanLog = options.jsonl ? console.error : console.log;
  const approvals = new Map<string, ReviewApproval>();
  const summaries = new Map<string, ReviewSummary>();
  const initialSummary = parseReviewSummaryInput({
    commitMessage: options.commitMessage ?? '',
    rationale: options.why ?? '',
    baseVersion: 0,
  });
  if (!initialSummary) {
    throw new Error('Commit message must be at most 16000 characters and rationale at most 4000');
  }
  const generatedStatusCache = new Map<
    string,
    { value: GeneratedStatusResponse; expiresAt: number }
  >();
  const diffDataCache = new Map<string, DiffResponse>();
  const initialIgnoreWhitespace = options.ignoreWhitespace || false;
  const parseBaseMode = (value: unknown): BaseMode | undefined => {
    if (value === 'merge-base') {
      return 'merge-base';
    }

    return undefined;
  };

  // Give named capture clients a machine-readable size error.
  const handleNamedReviewBodyLimit: ErrorRequestHandler = (error: unknown, _req, res, next) => {
    if (
      typeof error === 'object' &&
      error !== null &&
      'type' in error &&
      error.type === 'entity.too.large'
    ) {
      res.status(413).json({
        error:
          'Named review request exceeds the 16 MiB serialized JSON limit. Narrow the selected patch, or launch a new local review with --review and --capture.',
      });
      return;
    }
    next(error);
  };
  app.use('/api/reviews', express.json({ limit: '16mb' }), handleNamedReviewBodyLimit);
  app.use(express.json());
  app.use(express.text()); // For sendBeacon text/plain requests

  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', 'http://localhost:*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
  });

  // Skip validation if using stdin diff
  if (!options.stdinDiff && !initialNamedReview) {
    const isValidCommit = await parser.validateCommit(initialSelection.targetCommitish);
    if (!isValidCommit) {
      throw new Error(`Invalid or non-existent commit: ${initialSelection.targetCommitish}`);
    }
  }

  // Generate initial diff data for isEmpty check
  let initialDiffData: DiffResponse;
  function parseNamedDiff(review: NamedReviewState): DiffResponse {
    return {
      ...parser.parseStdinDiff(review.capture.patch),
      commit: `Review: ${review.metadata.name}`,
      baseCommitish: review.metadata.baseCommit,
      targetCommitish: '.',
      capture: review.metadata,
    };
  }
  if (initialNamedReview) {
    initialDiffData = parseNamedDiff(initialNamedReview);
  } else if (options.stdinDiff) {
    // Parse stdin diff directly
    initialDiffData = parser.parseStdinDiff(options.stdinDiff);
  } else {
    initialDiffData = await parser.parseDiff(
      initialSelection,
      initialIgnoreWhitespace,
      options.contextLines,
    );
    setCachedDiffResponse(
      diffDataCache,
      createDiffCacheKey(initialSelection, initialIgnoreWhitespace),
      initialDiffData,
    );
  }

  // Function to invalidate cache when file changes are detected
  const invalidateCache = () => {
    diffDataCache.clear();
    generatedStatusCache.clear();
    parser.clearResolvedCommitCache();
  };

  // Track current revisions for cache invalidation
  let currentSelection = initialSelection;
  let currentCommentSelection = createResolvedCommentSelection(
    initialDiffData,
    initialSelection,
    Boolean(options.stdinDiff),
  );
  // The latest resolved review for each requested index or worktree diff, such as HEAD vs staged.
  const resolvedWorkingTreeSelections = new Map<string, DiffSelection>();
  const workingTreeTracking = new Map<string, Promise<void>>();
  // Resolved commits, so the launched diff stays put when HEAD moves and matches its review.
  const launch = initialNamedReview || options.explicitTarget ? currentCommentSelection : undefined;
  if (options.clearComments) cleanKey = reviewKey(currentCommentSelection);
  // Ensure agents can discover the initial review even before a comment is posted.
  conversation?.getSummary(currentCommentSelection);
  if (initialNamedReview)
    conversation?.setCapture(currentCommentSelection, initialNamedReview.metadata);
  // Capture the initial review before listening; requests during later startup can change selection.
  const launchReview = conversation
    ?.snapshot()
    .reviews.find((entry) => diffSelectionsEqual(entry.selection, currentCommentSelection));
  // Save the cleared comments now, so a later launch without --clean does not bring them back.
  if (options.clearComments && launchReview) scheduleSave(launchReview.id);
  // A restored review that already proposes this message keeps it, and with it its approval. A
  // message copied from the commit is no proposal, so passing the same text still proposes it.
  const restoredSummary = conversation?.getSummary(currentCommentSelection);
  if (
    (initialSummary.commitMessage || initialSummary.rationale) &&
    (restoredSummary?.commitMessage !== initialSummary.commitMessage ||
      restoredSummary.rationale !== initialSummary.rationale ||
      restoredSummary.fromCommit)
  ) {
    const summary = {
      commitMessage: initialSummary.commitMessage,
      rationale: initialSummary.rationale,
      version: (restoredSummary?.version ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    summaries.set(getDiffSelectionKey(currentCommentSelection), summary);
    conversation?.setSummary(currentCommentSelection, summary);
  }

  seedCommittedSummary(currentCommentSelection, initialDiffData);
  await trackWorkingTreeReview(initialSelection, currentCommentSelection, initialDiffData);

  function parseRepositoryRelativePath(filepath: unknown):
    | { ok: true; path: string }
    | {
        ok: false;
        error: 'Invalid file path' | 'File path outside repository';
      } {
    if (typeof filepath !== 'string' || filepath.length === 0) {
      return { ok: false, error: 'Invalid file path' };
    }

    const normalizedFilepath = filepath.replace(/\\/g, '/');
    const hasParentTraversal = normalizedFilepath.split('/').some((segment) => segment === '..');
    if (isAbsolute(filepath) || normalizedFilepath.startsWith('/') || hasParentTraversal) {
      return { ok: false, error: 'File path outside repository' };
    }

    const resolvedPath = resolve(repositoryPath, normalizedFilepath);
    if (resolvedPath !== repositoryPath && !resolvedPath.startsWith(`${repositoryPath}${sep}`)) {
      return { ok: false, error: 'File path outside repository' };
    }

    return { ok: true, path: normalizedFilepath };
  }

  const commentSessions = new Map<string, CommentSessionState>();
  // A relaunch that repeats its reading-guide comments finds them already in a restored review.
  const restoredCommentThreads = conversation?.getThreads(currentCommentSelection) ?? [];
  const initialCommentThreads = mergeCommentImports(
    restoredCommentThreads,
    initialCommentImports,
  ).threads.map((thread) => ({
    ...thread,
    ...(initialNamedReview && !thread.capture
      ? {
          capture: {
            version: initialNamedReview.metadata.version,
            patchDigest: initialNamedReview.metadata.patchDigest,
          },
        }
      : {}),
  }));
  if (initialCommentThreads.length > 0) {
    commentSessions.set(createCommentSessionKey(currentCommentSelection), {
      threads: initialCommentThreads,
      version: 1,
    });
    conversation?.update(
      currentCommentSelection,
      restoredCommentThreads,
      initialCommentThreads,
      'agent',
    );
  }

  function getCommentSelectionFromQuery(query: Record<string, unknown>): DiffSelection {
    if (typeof query.review === 'string') {
      const review = namedReviews.get(query.review);
      if (!review) throw new NamedReviewError('Named review not found', 404);
      return review.selection;
    }
    const hasBase = typeof query.base === 'string';
    const hasTarget = typeof query.target === 'string';
    const hasBaseMode = typeof query.baseMode === 'string';

    if (!hasBase && !hasTarget && !hasBaseMode) {
      return currentCommentSelection;
    }

    return createDiffSelection(
      hasBase ? (query.base as string) : currentCommentSelection.baseCommitish,
      hasTarget ? (query.target as string) : currentCommentSelection.targetCommitish,
      hasBaseMode
        ? parseBaseMode(query.baseMode)
        : hasBase || hasTarget
          ? undefined
          : currentCommentSelection.baseMode,
    );
  }

  // Never silently fall back to another task for a misspelled review name.
  app.use('/api', (req, res, next) => {
    if (req.query.review !== undefined) {
      try {
        if (typeof req.query.review !== 'string')
          throw new NamedReviewError('Expected one review name', 400);
        if (!namedReviews.get(req.query.review))
          throw new NamedReviewError('Named review not found', 404);
      } catch (error) {
        res
          .status(error instanceof NamedReviewError ? error.status : 400)
          .json({ error: error instanceof Error ? error.message : 'Invalid review name' });
        return;
      }
    }
    next();
  });

  function describeNamedReview(review: NamedReviewState) {
    const snapshot = conversation
      ?.snapshot()
      .reviews.find((entry) => diffSelectionsEqual(entry.selection, review.selection));
    return { reviewId: snapshot?.id, ...review.metadata };
  }

  function reviewError(res: express.Response, error: unknown) {
    res.status(error instanceof NamedReviewError ? error.status : 400).json({
      error: error instanceof Error ? error.message : 'Invalid capture',
      ...(error instanceof NamedReviewError && error.current ? { current: error.current } : {}),
    });
  }

  app.get('/api/reviews/:name', (req, res) => {
    try {
      const version = req.query.version === undefined ? undefined : Number(req.query.version);
      const review = namedReviews.get(req.params.name, version);
      if (!review) throw new NamedReviewError('Named review capture not found', 404);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ ...describeNamedReview(review), files: review.capture.files });
    } catch (error) {
      reviewError(res, error);
    }
  });

  app.post('/api/reviews', (req, res) => {
    try {
      if (!conversation) throw new NamedReviewError('Named reviews require conversation mode', 400);
      const input = req.body as { name?: unknown; capture?: unknown; inbox?: unknown } | null;
      if (!input || typeof input.name !== 'string')
        throw new NamedReviewError('Expected review name and capture', 400);
      // null: the creator has no inbox, so the launching session must not receive this review.
      const owner =
        input.inbox === undefined || input.inbox === null
          ? input.inbox
          : parseInboxTarget(input.inbox);
      if (owner === undefined && input.inbox !== undefined)
        throw new NamedReviewError(
          'Expected inbox with sessionId, socket, and optional token',
          400,
        );
      if (owner && !isThisHost(req.socket.remoteAddress))
        throw new NamedReviewError('Only a process on this machine can name an inbox', 403);
      const capture = validateCapture(input.capture);
      parser.parseStdinDiff(capture.patch);
      const review = createNamedReview(input.name, capture);
      conversation.setCapture(review.selection, review.metadata);
      const described = describeNamedReview(review);
      if (owner !== undefined && described.reviewId) inbox?.setOwner(described.reviewId, owner);
      res.json({ ...described, updated: true });
      fileWatcher.broadcast({
        type: 'reviewCaptureChanged',
        reviewName: review.metadata.name,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      reviewError(res, error);
    }
  });

  app.post('/api/reviews/:name/capture', (req, res) => {
    try {
      const input = req.body as { expectedVersion?: unknown; capture?: unknown } | null;
      if (!input || typeof input.expectedVersion !== 'number')
        throw new NamedReviewError('Expected expectedVersion and capture', 400);
      const capture = validateCapture(input.capture);
      parser.parseStdinDiff(capture.patch);
      const { review, changed } = namedReviews.update(
        req.params.name,
        input.expectedVersion,
        capture,
      );
      if (changed) {
        conversation?.setCapture(review.selection, review.metadata);
        if (currentSelection.reviewName === review.metadata.name) {
          currentSelection = review.selection;
          currentCommentSelection = review.selection;
        }
        fileWatcher.broadcast({
          type: 'reviewCaptureChanged',
          reviewName: review.metadata.name,
          timestamp: new Date().toISOString(),
        });
        fileWatcher.broadcast({ type: 'approvalChanged', timestamp: new Date().toISOString() });
      }
      res.json({ ...describeNamedReview(review), updated: changed });
    } catch (error) {
      reviewError(res, error);
    }
  });

  function getOrCreateCommentSession(selection: DiffSelection): CommentSessionState {
    const key = createCommentSessionKey(selection);
    const existing = commentSessions.get(key);
    if (existing) {
      return existing;
    }

    // A review an earlier server saved opens with its comments.
    const threads = conversation?.getThreads(selection) ?? [];
    const nextSession: CommentSessionState = { threads, version: threads.length > 0 ? 1 : 0 };
    commentSessions.set(key, nextSession);
    return nextSession;
  }

  app.get('/api/diff', async (req, res) => {
    const ignoreWhitespace = req.query.ignoreWhitespace === 'true';
    const hasBase = typeof req.query.base === 'string';
    const hasTarget = typeof req.query.target === 'string';
    const hasBaseMode = typeof req.query.baseMode === 'string';
    const namedReview =
      typeof req.query.review === 'string'
        ? namedReviews.get(req.query.review)
        : !hasBase && !hasTarget && !hasBaseMode && currentSelection.reviewName
          ? namedReviews.get(currentSelection.reviewName)
          : undefined;
    const requestedSelection =
      namedReview?.selection ??
      createDiffSelection(
        hasBase ? (req.query.base as string) : currentSelection.baseCommitish,
        hasTarget ? (req.query.target as string) : currentSelection.targetCommitish,
        hasBaseMode
          ? parseBaseMode(req.query.baseMode)
          : hasBase || hasTarget
            ? undefined
            : currentSelection.baseMode,
      );
    const shouldIncludeCommentImports =
      initialCommentImports.length > 0 &&
      (Boolean(options.stdinDiff) || diffSelectionsEqual(requestedSelection, initialSelection));

    let responseDiffData = initialDiffData;
    if (namedReview) {
      responseDiffData = parseNamedDiff(namedReview);
    } else if (!options.stdinDiff) {
      // Retained reviews already have a resolved base. Keep their original
      // mode for comment identity while calculating the saved comparison directly.
      const calculationSelection =
        req.query.retainedReview === '1'
          ? createDiffSelection(
              requestedSelection.baseCommitish,
              requestedSelection.targetCommitish,
            )
          : requestedSelection;
      const cacheKey = createDiffCacheKey(calculationSelection, ignoreWhitespace);
      const cached = getCachedDiffResponse(diffDataCache, cacheKey);
      if (cached) {
        responseDiffData = cached;
      } else {
        try {
          responseDiffData = await parser.parseDiff(
            calculationSelection,
            ignoreWhitespace,
            options.contextLines,
          );
        } catch (error) {
          console.error('Error fetching diff:', error);
          res.status(500).json({
            error: error instanceof Error ? error.message : 'Failed to fetch diff',
          });
          return;
        }
        setCachedDiffResponse(diffDataCache, cacheKey, responseDiffData);
        generatedStatusCache.clear();
      }
    }

    currentSelection = requestedSelection;

    currentCommentSelection = createResolvedCommentSelection(
      responseDiffData,
      requestedSelection,
      Boolean(options.stdinDiff),
    );

    await trackWorkingTreeReview(requestedSelection, currentCommentSelection, responseDiffData);
    seedCommittedSummary(currentCommentSelection, responseDiffData);

    const baseCommitish =
      responseDiffData.baseCommitish ?? (options.stdinDiff ? 'stdin' : undefined);
    const targetCommitish =
      responseDiffData.targetCommitish ?? (options.stdinDiff ? 'stdin' : undefined);
    const requestedBaseCommitish =
      responseDiffData.requestedBaseCommitish ??
      (requestedSelection.baseCommitish || (options.stdinDiff ? 'stdin' : undefined));
    const requestedTargetCommitish =
      responseDiffData.requestedTargetCommitish ??
      (requestedSelection.targetCommitish || (options.stdinDiff ? 'stdin' : undefined));
    const requestedBaseMode = responseDiffData.requestedBaseMode ?? requestedSelection.baseMode;

    // A config.json the user broke by hand blocks the diff; the message names
    // the file so the page can say what to fix.
    let autoViewedPatterns: string[];
    try {
      ({ autoViewedPatterns } = await readUserConfig());
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
      return;
    }

    res.json({
      ...responseDiffData,
      ignoreWhitespace,
      openInEditorAvailable: editorAvailable,
      baseCommitish,
      targetCommitish,
      requestedBaseCommitish,
      requestedTargetCommitish,
      requestedBaseMode,
      clearComments: options.clearComments,
      shipIt: options.shipIt,
      repositoryId,
      reviewContext,
      title: options.title,
      commentImports: shouldIncludeCommentImports ? initialCommentImports : undefined,
      commentImportId: shouldIncludeCommentImports ? commentImportId : undefined,
      autoViewedPatterns,
    });
  });

  app.get(/^\/api\/generated-status\/(.*)$/, async (req, res) => {
    if (typeof req.query.review === 'string') {
      res.status(404).json({ error: 'Generated status is not available for a frozen capture' });
      return;
    }
    if (options.stdinDiff) {
      res.status(400).json({ error: 'Generated status is not available for stdin diff' });
      return;
    }

    try {
      const filepathResult = parseRepositoryRelativePath(req.params[0]);
      if (!filepathResult.ok) {
        res.status(400).json({ error: filepathResult.error });
        return;
      }
      const normalizedFilepath = filepathResult.path;

      const ref = (req.query.ref as string) || currentSelection.targetCommitish || 'HEAD';
      const cacheKey = `${ref}:${normalizedFilepath}`;
      const now = Date.now();
      const cached = generatedStatusCache.get(cacheKey);
      if (cached && cached.expiresAt > now) {
        res.json(cached.value);
        return;
      }

      const status = await parser.getGeneratedStatus(normalizedFilepath, ref);
      const response: GeneratedStatusResponse = {
        path: normalizedFilepath,
        ref,
        ...status,
      };
      generatedStatusCache.set(cacheKey, {
        value: response,
        expiresAt: now + GENERATED_STATUS_CACHE_TTL_MS,
      });

      res.json(response);
    } catch (error) {
      console.error('Error fetching generated status:', error);
      res.status(500).json({ error: 'Failed to get generated status' });
    }
  });

  // Get available revisions for revision selector
  app.get('/api/revisions', async (_req, res) => {
    if (currentSelection.reviewName && currentSelection.baseCommitish === 'unborn') {
      res.json({
        specialOptions: [],
        branches: [],
        commits: [],
        ...(launch ? { launch } : {}),
      } satisfies RevisionsResponse);
      return;
    }
    if (options.stdinDiff) {
      res.status(400).json({ error: 'Revision selection not available for stdin diff' });
      return;
    }

    try {
      const { branches, commits, originDefaultBranch, resolvedBase, resolvedTarget } =
        await parser.getRevisionOptions(
          currentSelection.baseCommitish,
          currentSelection.targetCommitish,
        );

      const response: RevisionsResponse = {
        specialOptions: [
          { value: '.', label: 'All Uncommitted Changes' },
          { value: 'staged', label: 'Staging Area' },
          { value: 'working', label: 'Working Directory' },
        ],
        branches,
        commits,
        originDefaultBranch,
        resolvedBase,
        resolvedTarget,
        ...(launch ? { launch } : {}),
      };

      res.json(response);
    } catch (error) {
      console.error('Error fetching revisions:', error);
      res.status(500).json({ error: 'Failed to fetch revisions' });
    }
  });

  app.get(/^\/api\/line-count\/(.*)$/, async (req, res) => {
    try {
      if (typeof req.query.review === 'string') {
        res.status(404).json({ error: 'Extra context is not available for a frozen capture' });
        return;
      }
      if (options.stdinDiff) {
        res.status(404).json({ error: 'Line count not available for stdin diff' });
        return;
      }

      const filepathResult = parseRepositoryRelativePath(req.params[0]);
      if (!filepathResult.ok) {
        res.status(400).json({ error: filepathResult.error });
        return;
      }
      const filepath = filepathResult.path;
      const oldRef = req.query.oldRef as string | undefined;
      const oldPathResult = req.query.oldPath
        ? parseRepositoryRelativePath(req.query.oldPath)
        : { ok: true as const, path: filepath };
      if (!oldPathResult.ok) {
        res.status(400).json({ error: oldPathResult.error });
        return;
      }
      const newRef = req.query.newRef as string | undefined;
      const oldPath = oldPathResult.path;

      const result: { oldLineCount?: number; newLineCount?: number } = {};

      if (oldRef) {
        try {
          result.oldLineCount = await parser.getLineCount(oldPath, oldRef);
        } catch {
          result.oldLineCount = 0;
        }
      }
      if (newRef) {
        try {
          result.newLineCount = await parser.getLineCount(filepath, newRef);
        } catch {
          result.newLineCount = 0;
        }
      }

      res.json(result);
    } catch (error) {
      console.error('Error fetching line count:', error);
      res.status(500).json({ error: 'Failed to get line count' });
    }
  });

  app.get(/^\/api\/blob\/(.*)$/, async (req, res) => {
    try {
      if (typeof req.query.review === 'string') {
        res.status(404).json({ error: 'Blob content is not available for a frozen capture' });
        return;
      }
      // If using stdin diff, blob content is not available
      if (options.stdinDiff) {
        res.status(404).json({ error: 'Blob content not available for stdin diff' });
        return;
      }

      const filepathResult = parseRepositoryRelativePath(req.params[0]);
      if (!filepathResult.ok) {
        res.status(400).json({ error: filepathResult.error });
        return;
      }
      const filepath = filepathResult.path;
      const ref = (req.query.ref as string) || 'HEAD';

      const blob = await parser.getBlobContent(filepath, ref);

      // Determine content type based on file extension
      const ext = getFileExtension(filepath);
      const contentTypes: { [key: string]: string } = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        bmp: 'image/bmp',
        svg: 'image/svg+xml',
        webp: 'image/webp',
        ico: 'image/x-icon',
        tiff: 'image/tiff',
        tif: 'image/tiff',
        avif: 'image/avif',
        heic: 'image/heic',
        heif: 'image/heif',
      };

      const contentType = contentTypes[ext || ''] || 'application/octet-stream';

      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.send(blob);
    } catch (error) {
      console.error('Error fetching blob:', error);
      res.status(404).json({ error: 'File not found' });
    }
  });

  function normalizeLineValue(line: unknown): NonNullable<DiffCommentThread['position']>['line'] {
    if (Array.isArray(line) && line.length === 2) {
      const start = line[0] as unknown;
      const end = line[1] as unknown;
      if (
        typeof start === 'number' &&
        typeof end === 'number' &&
        Number.isInteger(start) &&
        Number.isInteger(end) &&
        start > 0 &&
        end > 0 &&
        start <= end
      ) {
        return { start, end };
      }
    }

    if (typeof line === 'number' && Number.isInteger(line) && line > 0) {
      return line;
    }

    return 1;
  }

  function normalizeComment(comment: Comment): DiffCommentThread {
    const now = new Date().toISOString();
    const timestamp = typeof comment.timestamp === 'string' ? comment.timestamp : now;
    const threadId =
      typeof comment.id === 'string' && comment.id.length > 0
        ? comment.id
        : createHash('sha256').update(JSON.stringify(comment)).digest('hex').slice(0, 12);
    const filePath =
      typeof comment.file === 'string' && comment.file.length > 0 ? comment.file : '<unknown file>';

    return {
      id: threadId,
      filePath,
      createdAt: timestamp,
      updatedAt: timestamp,
      position: {
        side: comment.side ?? 'new',
        line: normalizeLineValue(comment.line),
      },
      codeSnapshot:
        typeof comment.codeContent === 'string'
          ? {
              content: comment.codeContent,
            }
          : undefined,
      messages: [
        {
          id: threadId,
          body: comment.body,
          author: comment.author,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    };
  }

  function normalizeThreadPayload(thread: CommentThread | DiffCommentThread): DiffCommentThread {
    if (thread.scope === 'review') {
      return {
        id: thread.id,
        scope: 'review',
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        messages: thread.messages,
        resolution: thread.resolution,
        isQuestion: thread.isQuestion,
        capture: thread.capture,
      };
    }
    if ('filePath' in thread && 'position' in thread) {
      return thread;
    }

    const threadId =
      typeof thread.id === 'string' && thread.id.length > 0
        ? thread.id
        : createHash('sha256').update(JSON.stringify(thread)).digest('hex').slice(0, 12);
    const now = new Date().toISOString();
    const messages =
      Array.isArray(thread.messages) && thread.messages.length > 0
        ? thread.messages.map((message, index) => ({
            id:
              typeof message.id === 'string' && message.id.length > 0
                ? message.id
                : `${threadId}:${index}`,
            body: message.body,
            author: message.author,
            origin: message.origin,
            intent: message.intent,
            createdAt: message.createdAt || thread.createdAt || now,
            updatedAt: message.updatedAt || message.createdAt || thread.updatedAt || now,
          }))
        : [
            {
              id: threadId,
              body: '',
              createdAt: thread.createdAt || now,
              updatedAt: thread.updatedAt || thread.createdAt || now,
            },
          ];
    const firstMessage = messages[0];
    const lastMessage = messages[messages.length - 1];

    return {
      id: threadId,
      capture: thread.capture,
      resolution: thread.resolution,
      isQuestion: thread.isQuestion,
      filePath:
        typeof thread.file === 'string' && thread.file.length > 0 ? thread.file : '<unknown file>',
      createdAt: thread.createdAt || firstMessage?.createdAt || now,
      updatedAt: thread.updatedAt || lastMessage?.updatedAt || thread.createdAt || now,
      position: {
        side: thread.side ?? 'new',
        line: normalizeLineValue(thread.line),
      },
      codeSnapshot:
        typeof thread.codeContent === 'string'
          ? {
              content: thread.codeContent,
            }
          : undefined,
      messages,
    };
  }

  function parseCommentsPayload(body: unknown): DiffCommentThread[] {
    const payload =
      typeof body === 'string'
        ? (JSON.parse(body) as {
            comments?: Comment[];
            threads?: Array<CommentThread | DiffCommentThread>;
          })
        : (body as {
            comments?: Comment[];
            threads?: Array<CommentThread | DiffCommentThread>;
          });

    if (Array.isArray(payload.threads)) {
      return payload.threads.map(normalizeThreadPayload);
    }

    if (Array.isArray(payload.comments)) {
      return payload.comments.map(normalizeComment);
    }

    return [];
  }

  // Version the client based its push on (omitted by older clients).
  function parseBaseVersion(payload: unknown): number | undefined {
    if (!payload || typeof payload !== 'object') return undefined;
    const value = (payload as { baseVersion?: unknown }).baseVersion;
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
  }

  function parseCommentImportsPayload(body: unknown): CommentImport[] {
    if (typeof body === 'string') {
      return normalizeCommentImports(JSON.parse(body));
    }

    return normalizeCommentImports(body);
  }

  function updateCommentSession(
    selection: DiffSelection,
    nextThreads: DiffCommentThread[],
    origin: 'user' | 'agent' = 'user',
    anchorCapture?: DiffCommentThread['capture'],
  ): boolean {
    const session = getOrCreateCommentSession(selection);
    const capture = selection.reviewName
      ? namedReviews.get(selection.reviewName)?.metadata
      : undefined;
    // Progress is process-local agent state, never restored or overwritten by browser payloads.
    nextThreads = nextThreads.map((thread) => {
      let threadCapture: DiffCommentThread['capture'];
      if (capture && selection.reviewName) {
        threadCapture = session.threads.find((existing) => existing.id === thread.id)?.capture;
        if (!threadCapture) {
          threadCapture = thread.capture ??
            anchorCapture ?? {
              version: capture.version,
              patchDigest: capture.patchDigest,
            };
          const original = namedReviews.get(selection.reviewName, threadCapture.version);
          if (!original || original.metadata.patchDigest !== threadCapture.patchDigest) {
            throw new Error('Comment capture is unavailable');
          }
          threadCapture = {
            version: original.metadata.version,
            patchDigest: original.metadata.patchDigest,
          };
        }
      }
      return {
        ...thread,
        capture: threadCapture,
        messages: thread.messages.map((message) => ({ ...message, progress: undefined })),
      };
    });
    const previous = JSON.stringify(session.threads);
    const next = JSON.stringify(nextThreads);
    const previousThreads = session.threads;
    session.threads = nextThreads;

    if (previous === next) {
      return false;
    }

    session.version += 1;
    const previousApprovalCursor = conversation?.getApproval(selection).cursor;
    conversation?.update(selection, previousThreads, nextThreads, origin);
    if (previousApprovalCursor !== conversation?.getApproval(selection).cursor)
      fileWatcher.broadcast({ type: 'approvalChanged', timestamp: new Date().toISOString() });
    fileWatcher.broadcast({
      type: 'commentsChanged',
      version: session.version,
      timestamp: new Date().toISOString(),
    });
    return true;
  }

  if (conversation) {
    registerConversationRoutes(
      app,
      conversation,
      (selection, threads) => {
        updateCommentSession(selection, threads, 'agent');
      },
      (selection) =>
        fileWatcher.broadcast({
          type: 'commentsChanged',
          version: getOrCreateCommentSession(selection).version,
          timestamp: new Date().toISOString(),
        }),
      presence,
      async () => {
        for (const review of conversation.snapshot().reviews)
          await revokeApprovalIfDiffChanged(review.selection);
      },
      storeStatus,
    );
  }

  function storeStatus(): ReviewStoreStatus | undefined {
    if (!reviewStore) return undefined;
    // Only reviews whose current key another server holds: a recapture can free one.
    const memoryOnly = (conversation?.snapshot().reviews ?? [])
      .filter((review) => {
        const key = reviewKey(review.selection);
        return key !== undefined && ownedElsewhere.has(key);
      })
      .map((review) => reviewLabel(review.selection));
    const error = [
      saveError,
      reviewStore.heartbeatError,
      cleanupError,
      memoryOnly.length
        ? `kept in memory only because another running gavel server saves them: ${memoryOnly.join(', ')}`
        : undefined,
    ]
      .filter(Boolean)
      .join('; ');
    return { directory: reviewStore.directory, ...(error ? { error } : {}) };
  }

  function getReviewSummary(selection: DiffSelection): ReviewSummary {
    return (
      conversation?.getSummary(selection) ??
      summaries.get(getDiffSelectionKey(selection)) ??
      emptyReviewSummary()
    );
  }

  function seedSummary(
    selection: DiffSelection,
    commitMessage: string,
    rationale: string,
    fromCommit = false,
  ): void {
    const previous = getReviewSummary(selection);
    // Saved edits, including an intentional clear, always take precedence over a seeded summary.
    if (previous.version !== 0 || previous.commitMessage || previous.rationale) return;
    const summary: ReviewSummary = {
      commitMessage,
      rationale,
      version: 1,
      updatedAt: new Date().toISOString(),
      ...(fromCommit ? { fromCommit: true as const } : {}),
    };
    summaries.set(getDiffSelectionKey(selection), summary);
    conversation?.setSummary(selection, summary);
  }

  function seedCommittedSummary(selection: DiffSelection, diff: DiffResponse): void {
    if (selection.reviewName || diff.targetCommitMessage === undefined) return;
    seedSummary(selection, diff.targetCommitMessage, '', true);
  }

  function isLiveWorkingTreeSelection(selection: DiffSelection): boolean {
    return (
      !options.stdinDiff && !selection.reviewName && isWorkingTreeTarget(selection.targetCommitish)
    );
  }

  async function trackWorkingTreeReview(
    requested: DiffSelection,
    resolved: DiffSelection,
    diff: DiffResponse,
  ): Promise<void> {
    // A response without a digest saw the diff change mid-read, so it settles nothing.
    const { diffDigest } = diff;
    if (!isLiveWorkingTreeSelection(requested) || diffDigest === undefined) return;
    const key = getDiffSelectionKey(requested);
    // One move at a time, so a later move reads the summary an earlier one carried.
    const tracked = (workingTreeTracking.get(key) ?? Promise.resolve()).then(async () => {
      const previous = resolvedWorkingTreeSelections.get(key);
      resolvedWorkingTreeSelections.set(key, resolved);
      if (previous) await carrySummaryToNewBase(previous, resolved, diffDigest);
      revokeIfDiffChanged(resolved, diffDigest);
    });
    // This request receives a failure; the chain only orders the next move after it.
    workingTreeTracking.set(
      key,
      tracked.catch(() => {}),
    );
    await tracked;
  }

  // A commit that moves HEAD gives a staged or . diff a new base, and so a new review.
  // Its proposed message still describes the same pending work, so it follows, unless
  // the proposal is what landed.
  async function carrySummaryToNewBase(
    previous: DiffSelection,
    next: DiffSelection,
    diffDigest: string,
  ): Promise<void> {
    if (diffSelectionsEqual(previous, next) || diffDigest === EMPTY_DIFF_DIGEST) return;
    const summary = getReviewSummary(previous);
    if (summary.version === 0) return;
    const proposed = normalizeCommitMessage(summary.commitMessage);
    const landed = await parser.getCommitMessages(previous.baseCommitish, next.baseCommitish);
    // --signoff and commit-msg hooks append trailers after the proposed text.
    if (
      landed
        .map(normalizeCommitMessage)
        .some((message) => message === proposed || message.startsWith(`${proposed}\n`))
    )
      return;
    seedSummary(next, summary.commitMessage, summary.rationale);
  }

  // An as-is approval covers the index or worktree diff the reviewer saw. After-comments lets the
  // agent change the diff, so its recorded digest is never compared, and a rejected change must
  // not ask for a verdict again once the agent reverts it, so only as-is is cleared.
  function revokeIfDiffChanged(selection: DiffSelection, diffDigest: string | undefined): void {
    const approval =
      conversation?.getApproval(selection) ?? approvals.get(getDiffSelectionKey(selection));
    if (
      !approval ||
      onRevision(approval.verdict) !== 'clear' ||
      approval.diffDigest === undefined ||
      approval.diffDigest === diffDigest
    )
      return;
    const revoked = conversation?.clearVerdict(selection, 'agent') ?? {
      updatedAt: new Date().toISOString(),
    };
    approvals.set(getDiffSelectionKey(selection), revoked);
    // Without a file watcher the cached diff is stale; drop it so a reload shows the change.
    invalidateCache();
    humanLog(`Approval revoked because the diff changed: ${selection.targetCommitish}`);
    fileWatcher.broadcast({ type: 'approvalChanged', timestamp: new Date().toISOString() });
  }

  async function getCurrentDiffDigest(selection: DiffSelection): Promise<string | undefined> {
    // A resolved selection already names its base commit, so skip the merge-base lookup.
    const diff = await parser.parseDiff(
      createDiffSelection(selection.baseCommitish, selection.targetCommitish),
      false,
      options.contextLines,
    );
    return diff.diffDigest;
  }

  async function revokeApprovalIfDiffChanged(selection: DiffSelection): Promise<void> {
    const approval =
      conversation?.getApproval(selection) ?? approvals.get(getDiffSelectionKey(selection));
    if (!approval || onRevision(approval.verdict) !== 'clear' || approval.diffDigest === undefined)
      return;
    revokeIfDiffChanged(selection, await getCurrentDiffDigest(selection));
  }

  app.get('/api/review-summary', (req, res) => {
    const selection = getCommentSelectionFromQuery(req.query as Record<string, unknown>);
    res.setHeader('Cache-Control', 'no-store');
    res.json(getReviewSummary(selection));
  });

  // Only agents write the proposal; the browser shows it read-only and asks for changes in a comment.
  if (conversation) {
    app.post('/api/conversation/summary', (req, res) => {
      if (!req.is('application/json')) {
        res.status(415).json({ error: 'Review summary requires application/json' });
        return;
      }
      const input = parseReviewSummaryInput(req.body);
      if (!input) {
        res.status(400).json({
          error:
            'Expected commitMessage (at most 16000 characters), rationale (at most 4000), and non-negative integer baseVersion',
        });
        return;
      }
      const reviewId = (req.body as Record<string, unknown>).reviewId;
      if (typeof reviewId !== 'string' || !reviewId) {
        res.status(400).json({ error: 'Expected reviewId from a conversation snapshot or event' });
        return;
      }
      const review = conversation.findReview(reviewId);
      if (!review) {
        res.status(404).json({ error: 'Review no longer exists' });
        return;
      }
      const selection = review.selection;
      const previous = getReviewSummary(selection);
      if (previous.version !== input.baseVersion) {
        res
          .status(409)
          .json({ error: 'Review summary changed; read its latest version', summary: previous });
        return;
      }
      // Saving a message copied from the commit adopts it as a proposal even when the
      // text is unchanged, so only a save of an existing proposal can be a no-op.
      if (
        !previous.fromCommit &&
        previous.commitMessage === input.commitMessage &&
        previous.rationale === input.rationale
      ) {
        res.json(previous);
        return;
      }
      const summary: ReviewSummary = {
        commitMessage: input.commitMessage,
        rationale: input.rationale,
        version: previous.version + 1,
        updatedAt: new Date().toISOString(),
      };
      summaries.set(getDiffSelectionKey(selection), summary);
      // setSummary revokes an Approve as-is and moves an Approve after comments to this version.
      conversation.setSummary(selection, summary);
      fileWatcher.broadcast({ type: 'approvalChanged', timestamp: new Date().toISOString() });
      fileWatcher.broadcast({
        type: 'reviewSummaryChanged',
        timestamp: new Date().toISOString(),
      });
      res.json(summary);
    });
  }

  app.post('/api/comments', (req, res) => {
    try {
      const selection = getCommentSelectionFromQuery(req.query as Record<string, unknown>);
      const body: unknown =
        typeof req.body === 'string' ? (JSON.parse(req.body) as unknown) : req.body;
      const nextThreads = parseCommentsPayload(body);
      const baseVersion = parseBaseVersion(body);
      let anchorCapture: DiffCommentThread['capture'];
      if (selection.reviewName && body && typeof body === 'object') {
        const input = body as { captureVersion?: unknown; patchDigest?: unknown };
        if (input.captureVersion !== undefined || input.patchDigest !== undefined) {
          if (typeof input.captureVersion !== 'number' || typeof input.patchDigest !== 'string') {
            throw new Error('Expected captureVersion and patchDigest');
          }
          const original = namedReviews.get(selection.reviewName, input.captureVersion);
          if (!original || original.metadata.patchDigest !== input.patchDigest) {
            throw new Error('Comment capture is unavailable');
          }
          anchorCapture = { version: input.captureVersion, patchDigest: input.patchDigest };
        }
      }
      const session = getOrCreateCommentSession(selection);

      // Stale baseVersion means another writer (e.g. an agent) changed comments since the
      // client's last read, so merge rather than overwrite. A matching/absent version replaces.
      const isStale = typeof baseVersion === 'number' && baseVersion !== session.version;
      const resolvedThreads = isStale
        ? mergeCommentThreads(session.threads, nextThreads).threads
        : nextThreads;

      updateCommentSession(selection, resolvedThreads, 'user', anchorCapture);

      res.json({
        success: true,
        merged: isStale,
        version: session.version,
        threads: conversation?.withProgress(selection, session.threads) ?? session.threads,
      });
    } catch (error) {
      console.error('Error parsing comments:', error);
      res.status(400).json({ error: 'Invalid comment data' });
    }
  });

  app.post('/api/comment-imports', (req, res) => {
    try {
      const selection = getCommentSelectionFromQuery(req.query as Record<string, unknown>);
      const session = getOrCreateCommentSession(selection);
      const commentImports = parseCommentImportsPayload(req.body);
      const importId = createHash('sha256')
        .update(serializeCommentImports(commentImports))
        .digest('hex');
      const merged = mergeCommentImports(session.threads, commentImports);
      const changed = updateCommentSession(selection, merged.threads, 'agent');

      res.json({
        success: true,
        changed,
        count: commentImports.length,
        importId,
        warnings: merged.warnings,
      });
    } catch (error) {
      console.error('Error parsing comment imports:', error);
      res.status(400).json({ error: 'Invalid comment import data' });
    }
  });

  app.post('/api/comments/:threadId/resolution', (req, res) => {
    if (!req.is('application/json')) {
      res.status(415).json({ error: 'Resolution updates require application/json' });
      return;
    }
    const input = req.body as { resolved?: unknown; reviewId?: unknown } | null;
    if (
      !input ||
      typeof input.resolved !== 'boolean' ||
      (input.reviewId !== undefined && typeof input.reviewId !== 'string')
    ) {
      res.status(400).json({ error: 'Expected resolved boolean and optional reviewId' });
      return;
    }
    const review =
      typeof input.reviewId === 'string' ? conversation?.findReview(input.reviewId) : undefined;
    if (input.reviewId !== undefined && !review) {
      res.status(404).json({ error: 'Review not found' });
      return;
    }
    const selection =
      review?.selection ?? getCommentSelectionFromQuery(req.query as Record<string, unknown>);
    const session = getOrCreateCommentSession(selection);
    if (!session.threads.some((thread) => thread.id === req.params.threadId)) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }
    const resolution = { resolved: input.resolved, updatedAt: new Date().toISOString() };
    updateCommentSession(
      selection,
      session.threads.map((thread) =>
        thread.id === req.params.threadId
          ? { ...thread, updatedAt: resolution.updatedAt, resolution }
          : thread,
      ),
      'agent',
    );
    res.json({ success: true });
  });

  app.delete('/api/comments/:threadId', (req, res) => {
    const selection = getCommentSelectionFromQuery(req.query as Record<string, unknown>);
    const session = getOrCreateCommentSession(selection);
    const threadId = req.params.threadId;
    const nextThreads = session.threads.filter((thread) => thread.id !== threadId);

    if (nextThreads.length === session.threads.length) {
      res.status(404).json({ error: `Thread not found: ${threadId}` });
      return;
    }

    updateCommentSession(selection, nextThreads, 'agent');

    res.json({
      success: true,
      threadId,
      version: session.version,
    });
  });

  app.get('/api/comments-json', (req, res) => {
    const selection = getCommentSelectionFromQuery(req.query as Record<string, unknown>);
    const session = getOrCreateCommentSession(selection);
    res.json({
      version: session.version,
      threads: conversation?.withProgress(selection, session.threads) ?? session.threads,
    });
  });

  app.get('/api/comments-output', (req, res) => {
    const selection = getCommentSelectionFromQuery(req.query as Record<string, unknown>);
    const session = getOrCreateCommentSession(selection);
    res.type('text/plain');

    if (session.threads.length > 0) {
      const output = formatCommentsOutput(session.threads.map(toCommentThread));
      res.send(output);
    } else {
      res.send('');
    }
  });

  app.put('/api/auto-viewed-patterns', async (req, res) => {
    let patterns: string[] | null;
    try {
      const body: unknown = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      patterns = parseAutoViewedPatternsBody(body);
    } catch {
      patterns = null;
    }

    if (!patterns) {
      res.status(400).json({ error: 'Expected { patterns: string[] }' });
      return;
    }

    try {
      await writeAutoViewedPatterns(patterns);
      res.json({ patterns });
    } catch (error) {
      console.error('Error saving auto-viewed patterns:', error);
      res.status(500).json({ error: 'Failed to save auto-viewed patterns' });
    }
  });

  app.post('/api/open-in-editor', async (req, res) => {
    if (options.stdinDiff) {
      res.status(400).json({ error: 'Open in editor is not available for stdin diff' });
      return;
    }

    const suppliedTokenBytes = Buffer.from(req.get(EDITOR_SESSION_HEADER) ?? '');
    if (
      suppliedTokenBytes.length !== editorSessionTokenBytes.length ||
      !timingSafeEqual(suppliedTokenBytes, editorSessionTokenBytes)
    ) {
      res.status(403).json({ error: 'Open in editor is not authorized' });
      return;
    }

    const { filePath, line, editor } = (req.body ?? {}) as {
      filePath?: unknown;
      line?: unknown;
      editor?: unknown;
    };

    // The HTTP client can select a file and line, but never a process or argv.
    if (typeof filePath !== 'string' || editor !== undefined) {
      res.status(400).json({ error: 'Invalid request payload' });
      return;
    }

    const filepathResult = parseRepositoryRelativePath(filePath);
    if (!filepathResult.ok) {
      res.status(400).json({ error: filepathResult.error });
      return;
    }
    const resolvedPath = resolve(repositoryPath, filepathResult.path);

    if (!editorAvailable) {
      res.status(400).json({
        error: customEditorArgsSafe
          ? 'Open in editor is disabled'
          : 'Custom editor arguments must pass %file or %file:%line as a separate argument',
      });
      return;
    }

    const lineNumber = (() => {
      const parsed = Number.parseInt(String(line ?? ''), 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    })();

    const spawnSpec = buildEditorSpawnSpec({
      command: editorCommand,
      argsTemplate: editorArgsTemplate,
      filePath: resolvedPath,
      lineNumber,
    });

    if (!spawnSpec) {
      res.status(500).json({ error: 'Invalid editor configuration' });
      return;
    }

    const launched = await new Promise<boolean>((resolvePromise) => {
      // No windowsHide here, unlike the git/gh calls elsewhere: a console editor
      // (vim, nano) needs its window on Windows.
      const child = spawn(spawnSpec.command, [...spawnSpec.args], {
        stdio: 'ignore',
        detached: true,
      });
      child.once('error', (error) => {
        const code = (error as NodeJS.ErrnoException).code;
        if (code && code !== 'ENOENT') {
          console.error('Failed to launch editor CLI:', error);
        }
        resolvePromise(false);
      });
      child.once('spawn', () => {
        child.unref();
        resolvePromise(true);
      });
    });

    if (!launched) {
      res.status(500).json({
        error: `Failed to launch editor: command "${spawnSpec.command}" is not available on PATH`,
      });
      return;
    }

    res.json({ success: true });
  });

  // Function to output comments when server shuts down
  function outputFinalComments(selection = currentCommentSelection) {
    const session = getOrCreateCommentSession(selection);
    if (!options.jsonl && session.threads.length > 0) {
      console.log(formatCommentsOutput(session.threads.map(toCommentThread)));
    }
  }

  if (options.shipIt) {
    app.get('/api/approval', async (req, res) => {
      const selection = getCommentSelectionFromQuery(req.query as Record<string, unknown>);
      await revokeApprovalIfDiffChanged(selection);
      res.setHeader('Cache-Control', 'no-store');
      res.json(
        conversation?.getApproval(selection) ?? approvals.get(getDiffSelectionKey(selection)) ?? {},
      );
    });

    function reportVerdict(
      selection: DiffSelection,
      previous: ReviewApproval | undefined,
      approval: ReviewApproval,
    ): void {
      approvals.set(getDiffSelectionKey(selection), approval);
      if (previous?.cursor === approval.cursor && previous?.verdict === approval.verdict) return;
      humanLog(
        `Verdict: ${approval.verdict ? VERDICT_LOG_NAMES[approval.verdict] : 'cleared'} (${selection.targetCommitish})`,
      );
      fileWatcher.broadcast({ type: 'approvalChanged', timestamp: new Date().toISOString() });
    }

    // A verdict is bound to the capture or diff the reviewer saw; approvals also to the summary.
    app.put('/api/approval', async (req, res) => {
      if (!req.is('application/json')) {
        res.status(415).json({ error: 'Approval requires application/json' });
        return;
      }
      const input = req.body as {
        verdict?: unknown;
        summaryVersion?: unknown;
        captureVersion?: unknown;
        patchDigest?: unknown;
        diffDigest?: unknown;
      } | null;
      const verdict = input?.verdict;
      if (!input || (verdict !== 'as-is' && verdict !== 'after-comments' && verdict !== 'reject')) {
        res.status(400).json({ error: 'Expected verdict: as-is, after-comments, or reject' });
        return;
      }
      if (verdict === 'after-comments' && !conversation) {
        res.status(400).json({ error: 'Approval after comments requires conversations' });
        return;
      }
      if (
        input.summaryVersion !== undefined &&
        (typeof input.summaryVersion !== 'number' ||
          !Number.isSafeInteger(input.summaryVersion) ||
          input.summaryVersion < 0)
      ) {
        res.status(400).json({ error: 'Expected a non-negative integer summaryVersion' });
        return;
      }
      // Reject does not endorse the proposed message, so it ignores the summary.
      const approving = verdict !== 'reject';
      const selection = getCommentSelectionFromQuery(req.query as Record<string, unknown>);
      // Read Git first: a summary edit during the await must still fail the check below.
      const diffDigest = isLiveWorkingTreeSelection(selection)
        ? await getCurrentDiffDigest(selection)
        : undefined;
      if (diffDigest !== undefined && input.diffDigest !== diffDigest) {
        // Without a file watcher the cached diff is stale; drop it so a reload shows the change.
        invalidateCache();
        res.status(409).json({
          error: 'Diff changed; reload it before choosing a verdict',
          diffDigest,
        });
        return;
      }
      const summary = getReviewSummary(selection);
      const capture = selection.reviewName
        ? namedReviews.get(selection.reviewName)?.metadata
        : undefined;
      if (
        capture &&
        (input.captureVersion !== capture.version ||
          input.patchDigest !== capture.patchDigest ||
          (approving && input.summaryVersion !== summary.version))
      ) {
        res.status(409).json({
          error: 'Review capture or summary changed; reload before choosing a verdict',
          current: capture,
          summary,
        });
        return;
      }
      if (approving && (input.summaryVersion ?? 0) !== summary.version) {
        res.status(409).json({
          error: 'Review summary changed; read its latest version before approving',
          summary,
        });
        return;
      }
      const previous =
        conversation?.getApproval(selection) ?? approvals.get(getDiffSelectionKey(selection));
      const approval =
        conversation?.setVerdict(selection, verdict, diffDigest) ??
        (previous?.verdict === verdict
          ? previous
          : {
              verdict,
              ...(diffDigest !== undefined ? { diffDigest } : {}),
              updatedAt: new Date().toISOString(),
            });
      reportVerdict(selection, previous, approval);
      res.json(approval);
    });

    // Clearing needs no matching versions: the reviewer may clear a verdict on a stale view.
    app.delete('/api/approval', (req, res) => {
      const selection = getCommentSelectionFromQuery(req.query as Record<string, unknown>);
      const previous =
        conversation?.getApproval(selection) ?? approvals.get(getDiffSelectionKey(selection));
      const approval =
        conversation?.clearVerdict(selection, 'user') ??
        (previous?.verdict === undefined
          ? (previous ?? {})
          : { updatedAt: new Date().toISOString() });
      reportVerdict(selection, previous, approval);
      res.json(approval);
    });

    // Compatibility for older clients. The toggle UI never calls this route.
    app.post('/api/ship-it', (req, res) => {
      // JSON requires a CORS preflight, so unrelated pages cannot approve with a simple POST.
      if (!req.is('application/json')) {
        res.status(415).json({ error: 'Approval requires application/json' });
        return;
      }
      const selection = getCommentSelectionFromQuery(req.query as Record<string, unknown>);
      if (selection.reviewName) {
        res
          .status(409)
          .json({ error: 'Named reviews require capture-bound approval through /api/approval' });
        return;
      }
      if (isLiveWorkingTreeSelection(selection)) {
        res.status(409).json({
          error: 'Staged and worktree reviews require diff-bound approval through /api/approval',
        });
        return;
      }
      res.on('finish', async () => {
        conversation?.setVerdict(selection, 'as-is');
        await fileWatcher.stop();
        outputFinalComments(selection);
        humanLog(`✅ Commit approved: ${selection.targetCommitish}`);
        outputShutdown('approved');
        // The parent reads piped stdout; immediate exit can truncate comments and approval.
        process.stdout.write('', (error) => process.exit(error ? 1 : 0));
      });
      res.json({ success: true });
    });
  }

  // gavel pending, run from the owning session's prompt hooks, re-points that session's reviews
  // at its current inbox and collects the activity no message carried.
  app.post('/api/inbox/attach', (req, res) => {
    if (!isThisHost(req.socket.remoteAddress)) {
      res.status(403).json({ error: 'Only a process on this machine can name an inbox' });
      return;
    }
    const target = parseInboxTarget(req.body);
    if (!target) {
      res.status(400).json({ error: 'Expected sessionId, socket, and optional token' });
      return;
    }
    res.json({ pending: inbox?.attach(target) ?? null });
  });

  app.get('/api/inbox', (_req, res) => {
    res.json({
      reviews: (conversation?.snapshot().reviews ?? []).map((review) => ({
        id: review.id,
        selection: review.selection,
        delivery: inbox?.delivery(review.id) ?? { status: 'unavailable' },
      })),
    });
  });

  app.get('/api/presence', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(presence.snapshot());
  });
  // Always runs in production mode when distributed as a CLI tool
  const isProduction =
    process.env.NODE_ENV === 'production' || process.env.NODE_ENV !== 'development';

  if (isProduction) {
    // Find client files relative to the CLI executable location
    const distPath = join(__dirname, '..', 'client');
    app.use(express.static(distPath));
  } else {
    app.get('/', (_req, res) => {
      res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>gavel - Dev Mode</title>
          </head>
          <body>
            <div id="root"></div>
            <script>
              console.log('gavel development mode');
              console.log('Diff data available at /api/diff');
            </script>
          </body>
        </html>
      `);
    });
  }

  const { port, url, server } = await startServerWithFallback(
    app,
    options.preferredPort ?? 4966,
    options.host || 'localhost',
  );
  if (conversation) {
    const host = new URL(url).hostname.replace(/^\[(.*)\]$/, '$1');
    inbox = new SessionInbox({
      // The snapshot endpoint's fields, so the message reports unsaved reviews too. It skips the
      // endpoint's revocation of approvals whose diff changed; agents read a fresh snapshot to commit.
      snapshot: () => {
        const store = storeStatus();
        return {
          ...conversation.snapshot(),
          presence: presence.snapshot(),
          ...(store ? { store } : {}),
        };
      },
      server: { host, port, pid: process.pid },
      runtimeDir: inboxRuntimeDir(process.env),
      onDeliveryChange: () =>
        fileWatcher.broadcast({
          type: 'inboxDeliveryChanged',
          timestamp: new Date().toISOString(),
        }),
    });
    if (options.inbox) inbox.setDefaultOwner(options.inbox);
  }
  // Live connections are WebSocket upgrades, which Express routes never see.
  const liveServerId = randomUUID();
  const liveSockets = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    // Express handles errors only for its own routes; an unhandled socket error crashes Node.
    socket.on('error', () => socket.destroy());
    const refuse = (status: string) =>
      socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    let requestUrl: URL;
    try {
      requestUrl = new URL(request.url ?? '/', 'http://gavel.invalid');
    } catch {
      refuse('400 Bad Request');
      return;
    }
    const tab = requestUrl.searchParams.get('tab');
    const visible = requestUrl.searchParams.get('visible');
    if (
      requestUrl.pathname !== LIVE_PATH ||
      !tab ||
      !/^[\w-]{1,100}$/.test(tab) ||
      (visible !== 'true' && visible !== 'false')
    ) {
      refuse('400 Bad Request');
      return;
    }
    liveSockets.handleUpgrade(request, socket, head, (live) => {
      // ws reports a malformed frame as an error event, even on a socket being refused.
      live.on('error', () => live.terminate());
      const expectedServer = requestUrl.searchParams.get('server');
      // A reconnecting tab can reach another review's server on a reused port.
      if (expectedServer && expectedServer !== liveServerId) {
        live.close(LIVE_OTHER_SERVER, 'different server');
        return;
      }
      connectLiveTab(live, tab, visible === 'true');
    });
  });

  const isVisibilityMessage = (message: unknown): message is LiveVisibilityMessage =>
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === 'visibility' &&
    typeof (message as { visible?: unknown }).visible === 'boolean';

  function connectLiveTab(live: WebSocket, tab: string, visible: boolean) {
    clearTimeout(reviewerDisconnectTimer);
    const send = (message: LiveServerMessage) => {
      if (live.readyState === WebSocket.OPEN) live.send(JSON.stringify(message));
    };
    send({ channel: 'hello', serverId: liveServerId });
    const watchClient = { send: (event: WatchEvent) => send({ channel: 'watch', event }) };
    fileWatcher.addClient(watchClient);
    const unsubscribe = presence.subscribe((snapshot) =>
      send({ channel: 'presence', presence: snapshot }),
    );
    const disconnectReviewer = presence.connectReviewer(tab, visible);
    // Pings keep proxies and tunnels from closing an idle connection.
    const pings = setInterval(() => live.ping(), 5000);
    live.on('message', (data) => {
      let message: unknown;
      try {
        message = JSON.parse(String(data));
      } catch {
        message = undefined;
      }
      if (!isVisibilityMessage(message)) {
        live.close(1003, 'expected a visibility message');
        return;
      }
      presence.updateReviewer(tab, message.visible);
    });
    live.on('close', () => {
      clearInterval(pings);
      fileWatcher.removeClient(watchClient);
      unsubscribe();
      disconnectReviewer();
      if (closing) return;
      if (options.keepAlive) {
        console.error('Client disconnected, but server is staying alive (--keep-alive)');
        console.error('Press Ctrl+C to stop the server');
      } else if (presence.snapshot().reviewers.connected === 0) {
        // Give a reloading tab a moment to reconnect before shutting down.
        reviewerDisconnectTimer = setTimeout(async () => {
          if (presence.snapshot().reviewers.connected > 0) return;
          console.error('Client disconnected, shutting down server...');
          await inbox?.drain();
          await fileWatcher.stop();
          outputFinalComments();
          outputShutdown('client-disconnected');
          process.stdout.write('', () => process.exit(0));
        }, 100);
      }
    });
  }

  const launchUrl = `${url}${initialNamedReview ? `?review=${encodeURIComponent(initialNamedReview.metadata.name)}` : ''}#${EDITOR_SESSION_FRAGMENT_KEY}=${editorSessionToken}`;

  let shutdownEmitted = false;
  function outputShutdown(reason: ServerShutdownEvent['reason']) {
    if (shutdownEmitted) return;
    shutdownEmitted = true;
    emit({
      type: 'server.shutdown',
      reason,
      pid: process.pid,
      timestamp: new Date().toISOString(),
    });
  }
  let shutdownPromise: Promise<void> | undefined;
  function shutdown(reason: ServerShutdownEvent['reason']): Promise<void> {
    shutdownPromise ??= (async () => {
      closing = true;
      clearTimeout(reviewerDisconnectTimer);
      presence.dispose();
      await inbox?.drain();
      inbox?.dispose();
      await fileWatcher.stop();
      outputShutdown(reason);
      for (const live of liveSockets.clients) live.terminate();
      await new Promise<void>((resolveShutdown) => {
        server.close(() => resolveShutdown());
        server.closeAllConnections();
      });
    })();
    return shutdownPromise;
  }
  server.once('close', () => {
    flushSaves();
    storeReleased = true;
    storeServer?.release();
    closing = true;
    clearTimeout(reviewerDisconnectTimer);
    presence.dispose();
    inbox?.dispose();
    outputShutdown('closed');
    void fileWatcher.stop();
  });
  // Security warning for non-localhost binding
  if (options.host && options.host !== '127.0.0.1' && options.host !== 'localhost') {
    console.warn('\n⚠️  WARNING: Server is accessible from external network!');
    console.warn(`   Binding to: ${options.host}:${port}`);
    console.warn('   Make sure this is intended and your network is secure.\n');
  }

  // Start file watcher
  if (options.diffMode && !initialNamedReview) {
    try {
      await fileWatcher.start(options.diffMode, repositoryPath, 300, invalidateCache);
    } catch (error) {
      console.warn('⚠️  File watcher failed to start:', error);
      console.warn('   Continuing without file watching...');
    }
  }

  // Check if diff is empty and skip browser opening
  if (initialDiffData.isEmpty) {
    // Don't open browser if no differences found
  } else if (options.openBrowser) {
    try {
      await open(launchUrl);
    } catch {
      console.warn('Failed to open browser automatically');
    }
  }

  // Install caller-owned lifecycle handling only after slow startup, before readiness
  // becomes observable. The CLI retains default signal cancellation during startup.
  options.onReady?.({ shutdown, port });
  if (launchReview) {
    emit({
      type: 'server.ready',
      port,
      url,
      launchUrl,
      pid: process.pid,
      reviewContext,
      selection: { ...launchReview.selection },
      reviewId: launchReview.id,
      ...(launchReview.capture ? { capture: launchReview.capture } : {}),
      timestamp: new Date().toISOString(),
    });
  }
  ready = true;
  for (const event of pendingEvents) emit(event);
  pendingEvents.length = 0;

  return { port, url, launchUrl, isEmpty: initialDiffData.isEmpty || false, server, shutdown };
}

async function startServerWithFallback(
  app: Express,
  preferredPort: number,
  host: string,
): Promise<{ port: number; url: string; server: Server }> {
  return new Promise((resolve, reject) => {
    // express's listen() method uses listen() method in node:net Server instance internally
    // https://expressjs.com/en/5x/api.html#app.listen
    // so, an error will be an instance of NodeJS.ErrnoException
    const server = app.listen(preferredPort, host, (err: NodeJS.ErrnoException | undefined) => {
      const displayHost = host === '0.0.0.0' ? 'localhost' : host;
      if (!err) {
        const { port } = server.address() as AddressInfo;
        const url = `http://${displayHost.includes(':') ? `[${displayHost}]` : displayHost}:${port}`;
        resolve({ port, url, server });
        return;
      }

      // Handling errors when failed to launch a server
      switch (err.code) {
        // Try another port until it succeeds
        case 'EADDRINUSE': {
          console.error(`Port ${preferredPort} is busy, trying ${preferredPort + 1}...`);
          return startServerWithFallback(app, preferredPort + 1, host)
            .then(({ port, url, server }) => {
              resolve({ port, url, server });
            })
            .catch(reject);
        }
        // Unexpected error
        default: {
          reject(new Error(`Failed to launch a server: ${err.message}`));
        }
      }
    });
  });
}
