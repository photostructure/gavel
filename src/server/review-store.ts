import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';

import type { ReviewApproval, ReviewSummary } from '../types/conversation.js';
import type { CommentProgress, DiffCommentThread, DiffSelection } from '../types/diff.js';
import type { NamedReviewMetadata, ReviewCapture } from '../types/review.js';
import { getDiffSelectionKey } from '../utils/diffSelection.js';

import { getGitCommonDirectory } from './review-capture.js';

/** A saved review untouched this long, and a saved patch no review uses, is deleted at server start. */
export const REVIEW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** How often a server that saved a review marks itself alive in the store. */
export const SERVER_HEARTBEAT_MS = 60 * 1000;

// The names gavel writes in each store directory. Group 1 marks a leftover: a temporary file
// (`<name>.<pid or server id>.tmp`) or a reclaim guard (`<lock>.reclaim`, and its own temporary).
const HASHED_FILE = /^[0-9a-f]{64}\.json((?:\.reclaim)?(?:\.[0-9a-f-]+\.tmp)?|\.reclaim)?$/;
// A saved review record, as list() reads them.
const SAVED_RECORD = /^[0-9a-f]{64}\.json$/;
const SERVER_FILE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json(\.[0-9]+\.tmp)?$/;

// Reclaiming a stale lock takes milliseconds; a guard this old was left by a crashed server.
const RECLAIM_GUARD_MS = 10 * 1000;

/** The part of a review a restarted server restores. */
export interface SavedReviewState {
  capture?: NamedReviewMetadata;
  threads: DiffCommentThread[];
  progress: [string, CommentProgress][];
  approval: ReviewApproval;
  summary: ReviewSummary;
}

/** One capture version of a named review, enough to find its saved patch. */
export interface SavedCaptureVersion {
  version: number;
  patchDigest: string;
  baseCommit: string;
}

export interface SavedReview extends SavedReviewState {
  format: 1;
  repositoryId: string;
  selection: DiffSelection;
  /** Each capture version of a named review, oldest first; the last is the current capture. */
  captures?: SavedCaptureVersion[];
  updatedAt: string;
}

/** Why a review was not saved: another running server owns it, or its lock is briefly contended. */
export type SaveRefusal = 'owned' | 'busy';

/** A running server, as the lock files of the reviews it saves name it. */
export interface ReviewOwner {
  serverId: string;
  pid: number;
  hostname: string;
}

/**
 * The identity a review keeps across server restarts, or undefined for one that has none. A
 * named review is its name and current patch, so two tasks with the same patch stay apart; any
 * other review is its resolved selection. An unnamed stdin patch is not saved.
 */
export function savedReviewKey(
  repositoryId: string,
  selection: DiffSelection,
  capture: Pick<NamedReviewMetadata, 'patchDigest'> | undefined,
): string | undefined {
  if (selection.reviewName) {
    if (!capture) throw new Error(`Named review "${selection.reviewName}" has no capture`);
    return JSON.stringify(['named', repositoryId, selection.reviewName, capture.patchDigest]);
  }
  if (selection.baseCommitish === 'stdin') return undefined;
  return JSON.stringify(['selection', repositoryId, getDiffSelectionKey(selection)]);
}

function hashName(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// A capture records its worktree's root and base commit, so each keeps its own copy of a patch.
function captureFileName(
  repositoryId: string,
  version: Pick<SavedCaptureVersion, 'patchDigest' | 'baseCommit'>,
): string {
  return `${hashName(JSON.stringify([repositoryId, version.baseCommit, version.patchDigest]))}.json`;
}

/** Writes through a temporary file, so a crash never leaves half a file. */
function writeAtomically(path: string, value: unknown): void {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value));
  renameSync(temporary, path);
}

/** Another server may delete a file between listing and reading it. */
function unlessDeleted<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

// Servers running in this process, which share its pid.
const liveServerIds = new Set<string>();

/** The saved-review store of the repository that contains cwd. */
export async function openReviewStore(cwd: string): Promise<ReviewStore> {
  return new ReviewStore(join(await getGitCommonDirectory(cwd), 'gavel'));
}

// Older versions held an approval after comments at approved: false until each comment was certified.
function parseSavedReview(text: string): SavedReview {
  const review = JSON.parse(text) as SavedReview;
  if (!review.approval.requested || review.approval.mode !== 'after-comments') return review;
  const approval: ReviewApproval & { conditions?: unknown; baselineCapture?: unknown } = {
    ...review.approval,
    approved: true,
  };
  delete approval.conditions;
  delete approval.baselineCapture;
  return { ...review, approval };
}

/**
 * Review state saved under the repository's Git directory (`<git-common-dir>/gavel`), shared by
 * its worktrees and never committed, cloned or pushed. Each saved review has a lock naming the
 * running server that saves it, so two servers never overwrite each other's copy.
 */
export class ReviewStore {
  private readonly reviews: string;
  private readonly captures: string;
  private readonly locks: string;
  private readonly servers: string;
  private readonly heartbeats = new Map<string, NodeJS.Timeout>();
  /** Why the latest heartbeat failed, until one succeeds. */
  heartbeatError: string | undefined;

  constructor(
    readonly directory: string,
    private readonly now: () => number = Date.now,
  ) {
    this.reviews = join(directory, 'reviews');
    this.captures = join(directory, 'captures');
    this.locks = join(directory, 'locks');
    this.servers = join(directory, 'servers');
  }

  /** Identifies a server; it writes nothing until the server first saves a review. */
  registerServer(): { owner: ReviewOwner; release: () => void } {
    const owner = { serverId: randomUUID(), pid: process.pid, hostname: hostname() };
    liveServerIds.add(owner.serverId);
    return {
      owner,
      // Locks go first: while they remain, this server still looks running to everyone else.
      // Release runs as a server closes, where a throw would end the process, so a file it cannot
      // delete is reported; its lock then looks stale once the heartbeat stops.
      release: () => {
        try {
          for (const name of this.entries(this.locks)) {
            const path = join(this.locks, name);
            if (name.endsWith('.json') && this.readLock(path)?.serverId === owner.serverId)
              rmSync(path, { force: true });
          }
          rmSync(this.heartbeatPath(owner), { force: true });
        } catch (error) {
          console.error(
            `gavel could not release its saved-review locks in ${this.directory}: ${error instanceof Error ? error.message : String(error)}`,
          );
        } finally {
          clearInterval(this.heartbeats.get(owner.serverId));
          this.heartbeats.delete(owner.serverId);
          liveServerIds.delete(owner.serverId);
        }
      },
    };
  }

  private heartbeatPath(owner: ReviewOwner): string {
    return join(this.servers, `${owner.serverId}.json`);
  }

  // Rewriting the file each beat also recreates it if someone deleted the store.
  private beat(owner: ReviewOwner): void {
    mkdirSync(this.servers, { recursive: true });
    writeAtomically(this.heartbeatPath(owner), owner);
    this.heartbeatError = undefined;
  }

  /** Beats now, and every SERVER_HEARTBEAT_MS from the first beat until release. */
  private heartbeat(owner: ReviewOwner): void {
    this.beat(owner);
    if (this.heartbeats.has(owner.serverId)) return;
    const timer = setInterval(() => {
      try {
        this.beat(owner);
      } catch (error) {
        // A timer has no caller to fail; until a beat succeeds, other servers may take over.
        this.heartbeatError = `could not refresh the saved-review heartbeat in ${this.servers}: ${error instanceof Error ? error.message : String(error)}`;
        console.error(`gavel ${this.heartbeatError}`);
      }
    }, SERVER_HEARTBEAT_MS);
    timer.unref();
    this.heartbeats.set(owner.serverId, timer);
  }

  /**
   * Whether this owner is a server still running: one in this process that has not released, or
   * another process on this host with a live pid and a heartbeat no older than three beats. A
   * crashed server has a dead pid; a reused pid has a stale heartbeat.
   */
  private running(other: ReviewOwner, owner: ReviewOwner): boolean {
    // A server on another host sharing this Git directory cannot be checked; it holds nothing.
    if (other.hostname !== owner.hostname) return false;
    if (other.pid === owner.pid) return liveServerIds.has(other.serverId);
    const heartbeat = unlessDeleted(() => statSync(this.heartbeatPath(other)).mtimeMs);
    return (
      heartbeat !== undefined &&
      heartbeat > this.now() - 3 * SERVER_HEARTBEAT_MS &&
      processAlive(other.pid)
    );
  }

  private lockPath(key: string): string {
    return join(this.locks, `${hashName(key)}.json`);
  }

  private readLock(path: string): ReviewOwner | undefined {
    const text = unlessDeleted(() => readFileSync(path, 'utf8'));
    return text === undefined ? undefined : (JSON.parse(text) as ReviewOwner);
  }

  /**
   * Creates `path` holding `owner` unless it exists. A hard link creates the file with its content
   * in one step and fails if another server created it first.
   */
  private createExclusively(path: string, owner: ReviewOwner): boolean {
    const temporary = `${path}.${owner.serverId}.tmp`;
    writeFileSync(temporary, JSON.stringify(owner));
    try {
      linkSync(temporary, path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    } finally {
      rmSync(temporary, { force: true });
    }
  }

  /**
   * Deletes the lock at `path` if it still names `stale`. Servers reclaim a lock one at a time
   * under a guard file, so none can delete a lock another server took after the stale one; a
   * guard older than RECLAIM_GUARD_MS belonged to a server that crashed while reclaiming.
   */
  private reclaim(path: string, stale: ReviewOwner, owner: ReviewOwner): boolean {
    const guard = `${path}.reclaim`;
    if (!this.createExclusively(guard, owner)) {
      const since = unlessDeleted(() => statSync(guard).mtimeMs);
      if (since !== undefined && since < this.now() - RECLAIM_GUARD_MS)
        rmSync(guard, { force: true });
      return false;
    }
    try {
      const holder = this.readLock(path);
      // No lock: another server already removed the stale one; claim races it for a new one.
      if (!holder) return true;
      if (holder.serverId !== stale.serverId) return false;
      rmSync(path, { force: true });
      return true;
    } finally {
      rmSync(guard, { force: true });
    }
  }

  /** Whether another running server holds this review's lock, so this one must leave it alone. */
  ownedByAnotherServer(key: string, owner: ReviewOwner): boolean {
    const holder = this.readLock(this.lockPath(key));
    return (
      holder !== undefined && holder.serverId !== owner.serverId && this.running(holder, owner)
    );
  }

  /**
   * Takes this review's lock for `owner`. `owned`: another running server holds it. `busy`:
   * nobody running holds it, but another server is reclaiming it or created it an instant ago;
   * try again shortly.
   */
  private claim(key: string, owner: ReviewOwner): 'claimed' | SaveRefusal {
    const path = this.lockPath(key);
    mkdirSync(this.locks, { recursive: true });
    // Beat first, so no server sees this lock while its holder does not look running.
    this.heartbeat(owner);
    const holder = this.readLock(path);
    if (holder?.serverId === owner.serverId) return 'claimed';
    if (holder && this.running(holder, owner)) return 'owned';
    if ((!holder || this.reclaim(path, holder, owner)) && this.createExclusively(path, owner))
      return 'claimed';
    return this.ownedByAnotherServer(key, owner) ? 'owned' : 'busy';
  }

  load(key: string): SavedReview | undefined {
    const text = unlessDeleted(() =>
      readFileSync(join(this.reviews, `${hashName(key)}.json`), 'utf8'),
    );
    return text === undefined ? undefined : parseSavedReview(text);
  }

  has(key: string): boolean {
    return existsSync(join(this.reviews, `${hashName(key)}.json`));
  }

  /** Saves a review once this owner holds its lock; see `claim` for why it may not. */
  save(key: string, review: SavedReview, owner: ReviewOwner): 'saved' | SaveRefusal {
    const claimed = this.claim(key, owner);
    if (claimed !== 'claimed') return claimed;
    mkdirSync(this.reviews, { recursive: true });
    writeAtomically(join(this.reviews, `${hashName(key)}.json`), review);
    return 'saved';
  }

  /** Deletes a review this owner saved, and its lock. */
  remove(key: string, owner: ReviewOwner): void {
    if (this.ownedByAnotherServer(key, owner)) return;
    rmSync(join(this.reviews, `${hashName(key)}.json`), { force: true });
    rmSync(this.lockPath(key), { force: true });
  }

  /** Saves a patch once; its worktree, base commit and digest name exactly one capture. */
  saveCapture(capture: ReviewCapture): void {
    const path = join(this.captures, captureFileName(capture.repositoryId, capture));
    if (existsSync(path)) return;
    mkdirSync(this.captures, { recursive: true });
    writeAtomically(path, capture);
  }

  loadCapture(repositoryId: string, version: SavedCaptureVersion): ReviewCapture {
    const text = unlessDeleted(() =>
      readFileSync(join(this.captures, captureFileName(repositoryId, version)), 'utf8'),
    );
    if (text === undefined)
      throw new Error(`Saved review patch ${version.patchDigest} is missing from ${this.captures}`);
    return JSON.parse(text) as ReviewCapture;
  }

  /** Every saved review; a file that is not one of gavel's records is skipped. */
  list(): SavedReview[] {
    return this.entries(this.reviews)
      .filter((name) => SAVED_RECORD.test(name))
      .flatMap((name) => {
        const path = join(this.reviews, name);
        const text = unlessDeleted(() => readFileSync(path, 'utf8'));
        if (text === undefined) return [];
        try {
          return [parseSavedReview(text)];
        } catch (error) {
          throw new Error(
            `Saved review ${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      });
  }

  private entries(directory: string): string[] {
    return existsSync(directory) ? readdirSync(directory) : [];
  }

  /**
   * Deletes reviews and heartbeats nobody has touched for REVIEW_RETENTION_MS, patches that no
   * remaining review uses once they are that old too (so a patch saved just before its review
   * survives), and locks whose server stopped. Returns what it could not clean up.
   */
  vacuum(owner: ReviewOwner): string[] {
    const cutoff = this.now() - REVIEW_RETENTION_MS;
    const stale = (path: string) => (unlessDeleted(() => statSync(path).mtimeMs) ?? 0) < cutoff;
    // One file cleanup cannot handle is reported and left; the rest of the cleanup still runs.
    const problems: string[] = [];
    const attempt = (path: string, clean: () => void) => {
      try {
        clean();
      } catch (error) {
        problems.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    // Cleanup deletes only names gavel writes; anything else in these directories stays.
    const ours = (directory: string) =>
      this.entries(directory).flatMap((name) => {
        const match = (directory === this.servers ? SERVER_FILE : HASHED_FILE).exec(name);
        return match ? [{ name, path: join(directory, name), leftover: Boolean(match[1]) }] : [];
      });
    const used = new Set<string>();
    // A retained review that cannot be read may use any patch, so none is deleted this run.
    let usesUnknown = false;
    for (const { path, leftover } of ours(this.reviews)) {
      const before = problems.length;
      attempt(path, () => {
        if (stale(path)) {
          rmSync(path, { force: true });
          return;
        }
        if (leftover) return;
        const text = unlessDeleted(() => readFileSync(path, 'utf8'));
        if (text === undefined) return;
        const review = JSON.parse(text) as SavedReview;
        for (const version of review.captures ?? [])
          used.add(captureFileName(review.repositoryId, version));
      });
      if (!leftover && problems.length > before && existsSync(path)) usesUnknown = true;
    }
    for (const { name, path } of usesUnknown ? [] : ours(this.captures)) {
      attempt(path, () => {
        if (!used.has(name) && stale(path)) rmSync(path, { force: true });
      });
    }
    for (const { path, leftover } of ours(this.servers)) {
      attempt(path, () => {
        // A crashed server's heartbeat on this host goes as soon as its process has exited; one
        // from another host sharing this Git directory waits for the retention period.
        const heartbeat = leftover ? undefined : this.readLock(path);
        if (
          stale(path) ||
          (heartbeat &&
            heartbeat.hostname === owner.hostname &&
            heartbeat.serverId !== owner.serverId &&
            !this.running(heartbeat, owner))
        )
          rmSync(path, { force: true });
      });
    }
    for (const { path, leftover } of ours(this.locks)) {
      attempt(path, () => {
        // A temporary file or reclaim guard a crashed server left behind.
        if (leftover) {
          if (stale(path)) rmSync(path, { force: true });
          return;
        }
        const holder = this.readLock(path);
        if (holder && !this.running(holder, owner)) this.reclaim(path, holder, owner);
      });
    }
    return problems;
  }
}
