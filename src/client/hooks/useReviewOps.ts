import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { DiffCommentThread } from '../../types/diff';
import type { ReviewOp, ReviewOpResult, ReviewOpsResponse } from '../../types/reviewOps';
import { createId } from '../../utils/createId';
import { applyReviewOp } from '../../utils/reviewOps';

// queuedAt stamps the change on this page until the server's answer replaces it.
export type QueuedOp = ReviewOp & { id: string; queuedAt: string };

/** The server's answer, or that another tab got its answer. */
export type ReviewOpAnswer = ReviewOpResult | 'elsewhere';

// Each op has its own key, so a tab writes and removes only its own ops and never another
// tab's. queuedAt leads the key, so the keys in order list the ops in the order they were queued.
const queuePrefix = (scope: string) => `gavel:review-ops:${scope}:`;
const opKey = (scope: string, op: QueuedOp) => `${queuePrefix(scope)}${op.queuedAt}-${op.id}`;

function readQueue(scope: string): QueuedOp[] {
  return Object.keys(localStorage)
    .filter((key) => key.startsWith(queuePrefix(scope)))
    .sort()
    .flatMap((key) => {
      const value = localStorage.getItem(key);
      return value === null ? [] : [JSON.parse(value) as QueuedOp];
    });
}

interface Snapshot {
  cursor: string;
  version: number;
  threads: DiffCommentThread[];
}

/**
 * Whether a snapshot predates the shown one. Within one server run the cursor's sequence and the
 * comment version only grow, and some thread changes advance only the version, so the pair orders
 * the snapshots. Another instance means the server restarted.
 */
function isOlder(snapshot: Snapshot, shown: Snapshot): boolean {
  const [instance, sequence] = snapshot.cursor.split(':');
  const [shownInstance, shownSequence] = shown.cursor.split(':');
  if (instance !== shownInstance) return false;
  const bySequence = Number(sequence) - Number(shownSequence);
  return bySequence < 0 || (bySequence === 0 && snapshot.version < shown.version);
}

// Two ops queued in one millisecond still sort in the order they were queued.
let lastQueuedAt = 0;

// sent learns whether the first attempt to send the op got an answer; settle gets the answer.
type Waiters = Map<
  string,
  { key: string; sent: (answered: boolean) => void; settle: (answer: ReviewOpAnswer) => void }
>;

function settle(waiters: Waiters, id: string, answer: ReviewOpAnswer): void {
  waiters.get(id)?.sent(true);
  waiters.get(id)?.settle(answer);
  waiters.delete(id);
}

/**
 * A review's comments as the server holds them, with this browser's unconfirmed changes applied
 * on top. Each change waits in localStorage, in order, until the server answers it; nothing else
 * removes it. `scope` names the review as the server finds it; `query` selects it on the server,
 * as for /api/comments-json.
 */
export function useReviewOps(
  scope: string | null,
  query: string | null,
  repositoryId: string | undefined,
) {
  const [base, setBase] = useState<(Snapshot & { scope: string }) | null>(null);
  const [queue, setQueue] = useState<QueuedOp[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const activeScope = useRef(scope);
  activeScope.current = scope;
  // Flushes run one at a time, in the order they were asked for.
  const flushes = useRef(Promise.resolve());
  const waiting = useRef<Waiters>(new Map());

  const showSnapshot = useCallback((snapshotScope: string, snapshot: Snapshot) => {
    if (activeScope.current !== snapshotScope) return;
    setBase((current) =>
      current?.scope === snapshotScope && isOlder(snapshot, current)
        ? current
        : { ...snapshot, scope: snapshotScope },
    );
  }, []);

  // Another tab can confirm an op this tab waits on, whichever review this tab now shows.
  useEffect(() => {
    const onStorage = () => {
      for (const [id, { key }] of waiting.current)
        if (localStorage.getItem(key) === null) settle(waiting.current, id, 'elsewhere');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    setQueue(scope ? readQueue(scope) : []);
    setFailure(null);
    setRejection(null);
    setLoadError(null);
    if (!scope) return;
    // Another tab on this review queues and confirms changes through the same storage.
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith(queuePrefix(scope)))
        setQueue(readQueue(scope));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [scope]);

  const send = useCallback(async () => {
    if (!scope || query === null) return;
    const batch = readQueue(scope);
    if (batch.length === 0) return;
    let answer: ReviewOpsResponse;
    try {
      const response = await fetch(`/api/review-ops?${query}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repositoryId, ops: batch }),
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      answer = (await response.json()) as ReviewOpsResponse;
    } catch (error) {
      if (activeScope.current === scope) setFailure((error as Error).message);
      for (const { id } of batch) waiting.current.get(id)?.sent(false);
      return;
    }
    const answered = new Set(answer.results.map(({ id }) => id));
    for (const op of batch) if (answered.has(op.id)) localStorage.removeItem(opKey(scope, op));
    showSnapshot(scope, answer);
    if (activeScope.current === scope) {
      setQueue(readQueue(scope));
      setFailure(null);
      const errors = answer.results.flatMap(({ status, error }) =>
        status === 'rejected' ? [error] : [],
      );
      // A refusal stays shown until the reviewer's next change.
      if (errors.length > 0) setRejection(errors.join('; '));
    }
    for (const result of answer.results) settle(waiting.current, result.id, result);
  }, [scope, query, repositoryId, showSnapshot]);

  const flush = useCallback(() => (flushes.current = flushes.current.then(send)), [send]);

  /**
   * Queues a change and sends it. `sent` resolves once the first send ends, to whether it got an
   * answer; `answer` resolves to the answer, from a later retry when the first send fails.
   */
  const enqueue = useCallback(
    (op: ReviewOp): { sent: Promise<boolean>; answer: Promise<ReviewOpAnswer> } => {
      if (!scope) throw new Error('No review is open');
      lastQueuedAt = Math.max(Date.now(), lastQueuedAt + 1);
      const queued = {
        ...op,
        // Not crypto.randomUUID: browsers leave it undefined on plain-HTTP pages other than
        // localhost, such as a review opened at a LAN address.
        id: createId(),
        queuedAt: new Date(lastQueuedAt).toISOString(),
      };
      const key = opKey(scope, queued);
      let sent!: (answered: boolean) => void;
      let settleAnswer!: (answer: ReviewOpAnswer) => void;
      const result = {
        sent: new Promise<boolean>((resolve) => (sent = resolve)),
        answer: new Promise<ReviewOpAnswer>((resolve) => (settleAnswer = resolve)),
      };
      waiting.current.set(queued.id, { key, sent, settle: settleAnswer });
      localStorage.setItem(key, JSON.stringify(queued));
      setQueue(readQueue(scope));
      setRejection(null);
      void flush();
      return result;
    },
    [scope, flush],
  );

  const refresh = useCallback(async () => {
    if (!scope || query === null) return;
    try {
      const response = await fetch(`/api/comments-json?${query}`);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      showSnapshot(scope, (await response.json()) as Snapshot);
      if (activeScope.current === scope) setLoadError(null);
    } catch (error) {
      if (activeScope.current === scope) setLoadError((error as Error).message);
      throw error;
    }
  }, [scope, query, showSnapshot]);

  /**
   * Moves a review's waiting changes from `fromScope` to `toScope`, as when an agent renames it,
   * so they are sent to it under its new name. They keep their IDs, so the server answers one it
   * already applied as a duplicate.
   */
  const retarget = useCallback((fromScope: string, toScope: string) => {
    for (const op of readQueue(fromScope)) {
      const key = opKey(toScope, op);
      localStorage.setItem(key, JSON.stringify(op));
      localStorage.removeItem(opKey(fromScope, op));
      const waiter = waiting.current.get(op.id);
      if (waiter) waiter.key = key;
    }
    const shown = activeScope.current;
    if (shown === fromScope || shown === toScope) setQueue(readQueue(shown));
  }, []);

  /** Resends what waits and reads the review again, as when it loads or the connection reopens. */
  const retry = useCallback(async () => {
    void flush();
    await refresh();
  }, [flush, refresh]);

  useEffect(() => {
    retry().catch((error: unknown) => console.error('Failed to load comments:', error));
  }, [retry]);

  const threads = useMemo(() => {
    if (base?.scope !== scope) return [];
    return queue.reduce((current, op) => {
      const outcome = applyReviewOp(current, op, op.queuedAt);
      return 'error' in outcome ? current : outcome.threads;
    }, base.threads);
  }, [base, queue, scope]);

  const loaded = base?.scope === scope;
  // Shown in a toast of its own, since it can stay up for as long as the server is unreachable.
  const unsaved =
    failure && queue.length > 0
      ? `${queue.length === 1 ? '1 change is' : `${queue.length} changes are`} not saved to the server (${failure}). Gavel sends ${queue.length === 1 ? 'it' : 'them'} again with your next change, when you reload, or when the live connection reopens.`
      : null;
  const alert = rejection
    ? `The server refused a change: ${rejection}`
    : !loaded && loadError
      ? `Could not load comments: ${loadError}`
      : null;

  return {
    loaded,
    threads,
    waiting: queue.length > 0,
    enqueue,
    refresh,
    retry,
    retarget,
    alert,
    unsaved,
  };
}
