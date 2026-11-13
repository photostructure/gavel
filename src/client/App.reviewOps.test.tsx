import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HotkeysProvider } from 'react-hotkeys-hook';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DiffCommentThread, DiffResponse } from '../types/diff';
import type { ReviewOp, ReviewOpResult } from '../types/reviewOps';
import { applyReviewOp } from '../utils/reviewOps';

import App from './App';
import { storageService } from './services/StorageService';
import { MockWebSocket } from './utils/liveConnection.testing';

const watch = vi.hoisted(() => ({
  reload: undefined as (() => Promise<void>) | undefined,
  commentsChanged: undefined as (() => Promise<void>) | undefined,
  approvalChanged: undefined as (() => Promise<void>) | undefined,
  setConnected: undefined as ((connected: boolean) => void) | undefined,
  // useFileWatch starts disconnected and connects once the page loads.
  initiallyConnected: true,
}));
vi.mock('./hooks/useFileWatch', async () => {
  const { useState } = await vi.importActual<typeof import('react')>('react');
  return {
    useFileWatch: (
      onReload: () => Promise<void>,
      onCommentsChanged: () => Promise<void>,
      onApprovalChanged: () => Promise<void>,
    ) => {
      const [isConnected, setConnected] = useState(watch.initiallyConnected);
      watch.reload = onReload;
      watch.commentsChanged = onCommentsChanged;
      watch.approvalChanged = onApprovalChanged;
      watch.setConnected = setConnected;
      return {
        shouldReload: false,
        isConnected,
        error: null,
        reload: vi.fn(),
        watchState: { isWatchEnabled: false, isReloading: false, lastChangeType: null },
      };
    },
  };
});

// The browser's storage record for this review: repository `repo`, main vs feature.
const STORAGE_KEY = 'gavel-storage-v1/repo/main-feature';
const QUEUE_PREFIX = 'gavel:review-ops:';
const time = '2026-11-11T00:00:00.000Z';

type QueuedOp = ReviewOp & { id: string };

function generalThread(id: string, body: string): DiffCommentThread {
  return {
    id,
    scope: 'review',
    createdAt: time,
    updatedAt: time,
    messages: [{ id, body, author: 'User', createdAt: time, updatedAt: time }],
  };
}

// false answers; 'status' answers 503 without applying; 'network' fails before the server sees
// the batch; 'lost' applies the batch and then loses the answer.
type Outcome = false | 'status' | 'network' | 'lost';

/** A fake gavel server that applies review ops once each, as POST /api/review-ops does. */
function server(initialThreads: DiffCommentThread[] = []) {
  const state = {
    threads: structuredClone(initialThreads),
    version: 1,
    commit: 'abc123',
    clean: false,
    shipIt: true,
    ledger: new Set<string>(),
    applied: [] as QueuedOp[],
    verdict: undefined as string | undefined,
    staleVerdict: undefined as string | undefined,
    snapshotGate: undefined as Promise<void> | undefined,
    summaryGate: undefined as Promise<void> | undefined,
    holdApprovalReads: false,
    heldApprovalReads: [] as Array<() => void>,
    fail: false as Outcome,
    batches: [] as QueuedOp[][],
    // While set, the next batch waits for a settle call that picks its outcome.
    deferNextBatch: false,
    deferred: [] as Array<(outcome: Outcome) => void>,
    // While set, the next comments read waits for a release call, then reads the threads.
    deferNextRead: false,
    deferredReads: [] as Array<() => void>,
  };
  const apply = (ops: QueuedOp[]) =>
    ops.map((op): ReviewOpResult => {
      if (state.ledger.has(op.id)) return { id: op.id, status: 'duplicate' };
      if (op.type === 'verdict.set') {
        if (state.staleVerdict) return { id: op.id, status: 'rejected', error: state.staleVerdict };
        state.verdict = op.verdict === 'clear' ? undefined : op.verdict;
      } else {
        const outcome = applyReviewOp(state.threads, op, time);
        if ('error' in outcome) return { id: op.id, status: 'rejected', error: outcome.error };
        state.threads = outcome.threads;
        state.version += 1;
      }
      state.ledger.add(op.id);
      state.applied.push(op);
      return { id: op.id, status: 'applied' };
    });
  const answer = (ops: QueuedOp[], outcome: Outcome) => {
    if (outcome === 'network') throw new TypeError('Failed to fetch');
    if (outcome === 'status')
      return new Response('{}', { status: 503, statusText: 'Service Unavailable' });
    const results = apply(ops);
    if (outcome === 'lost') throw new TypeError('Failed to fetch');
    return Response.json({
      version: state.version,
      cursor: `test:${state.version}`,
      results,
      threads: state.threads,
    });
  };
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = new URL(String(input), window.location.origin);
    if (url.pathname === '/api/diff')
      return Response.json({
        commit: state.commit,
        repositoryId: 'repo',
        baseCommitish: 'main',
        targetCommitish: 'feature',
        requestedBaseCommitish: 'main',
        requestedTargetCommitish: 'feature',
        files: [{ path: 'a.ts', status: 'modified', additions: 1, deletions: 0, chunks: [] }],
        shipIt: state.shipIt,
        clearComments: state.clean,
      } satisfies DiffResponse);
    if (url.pathname === '/api/comments-json') {
      if (state.deferNextRead) {
        state.deferNextRead = false;
        // The server reads its threads and version together once the read is released.
        await new Promise<void>((release) => state.deferredReads.push(release));
      }
      return Response.json({
        version: state.version,
        cursor: `test:${state.version}`,
        threads: state.threads,
      });
    }
    if (url.pathname === '/api/review-ops') {
      const { ops } = JSON.parse(String(init?.body)) as { ops: QueuedOp[] };
      state.batches.push(ops);
      if (state.deferNextBatch) {
        state.deferNextBatch = false;
        const outcome = await new Promise<Outcome>((settle) => state.deferred.push(settle));
        return answer(ops, outcome);
      }
      return answer(ops, state.fail);
    }
    if (url.pathname === '/api/approval') {
      // While set, each approval read waits for its own release.
      if (state.holdApprovalReads)
        await new Promise<void>((release) => state.heldApprovalReads.push(release));
      return Response.json(state.verdict ? { verdict: state.verdict } : {});
    }
    if (url.pathname === '/api/revisions')
      return Response.json({ specialOptions: [], branches: [], commits: [] });
    if (url.pathname === '/api/review-summary') {
      // While set, the proposed commit message waits, as a slow read of it would.
      await state.summaryGate;
      return Response.json({ commitMessage: '', rationale: '', version: 0 });
    }
    if (url.pathname === '/api/conversation/snapshot') {
      // While set, the list of reviews waits, as a slow read of it would.
      await state.snapshotGate;
      return Response.json({ cursor: 'stream:0', reviews: [] });
    }
    return Response.json({});
  });
  return state;
}

const mount = () =>
  render(
    <HotkeysProvider initiallyActiveScopes={['navigation']}>
      <App />
    </HotkeysProvider>,
  );

// The verdict buttons stay disabled until the page has the server's threads.
const approveButton = () => screen.getByRole('button', { name: /^(Approve|Approved)$/ });
const waitForServerThreads = () => waitFor(() => expect(approveButton()).toBeEnabled());

/** Every op this browser holds for the server, in order. */
const queued = (): QueuedOp[] =>
  Object.keys(localStorage)
    .filter((key) => key.startsWith(QUEUE_PREFIX))
    .sort()
    .map((key) => JSON.parse(localStorage.getItem(key) ?? 'null') as QueuedOp);

const savedRecord = () =>
  JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as {
    threads?: DiffCommentThread[];
    deletedComments?: unknown[];
  };

const notSavedAlert = () =>
  screen
    .queryAllByRole('alert')
    .find((alert) => alert.textContent.includes('not saved to the server')) ?? null;

async function findNotSavedAlert() {
  await waitFor(() => expect(notSavedAlert()).not.toBeNull());
  return notSavedAlert()!;
}

async function openConversation() {
  await userEvent.click(await screen.findByRole('button', { name: 'Conversation' }));
  return within(screen.getByRole('dialog', { name: 'Conversation' }));
}

async function sendGeneralComment(body: string) {
  const conversation = await openConversation();
  const composer = within(
    conversation.getByPlaceholderText('Comment or ask about this review…').closest('form')!,
  );
  await userEvent.type(composer.getByRole('textbox'), body);
  await userEvent.click(composer.getByRole('button', { name: 'Send' }));
  await userEvent.click(screen.getByRole('button', { name: 'Close conversation' }));
}

async function expectShown(body: string) {
  const conversation = await openConversation();
  expect(await conversation.findByText(body)).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Close conversation' }));
}

const bodiesOf = (threads: DiffCommentThread[]) =>
  threads.map((thread) => thread.messages[0]?.body);

const queuedBodies = () =>
  queued().map((op) => (op.type === 'thread.add' ? op.thread.messages[0]?.body : op.type));

const legacyRecord = (threads: DiffCommentThread[]) =>
  JSON.stringify({
    version: 2,
    baseCommitish: 'main',
    targetCommitish: 'feature',
    createdAt: time,
    lastModifiedAt: time,
    threads,
    viewedFiles: [],
    appliedCommentImportIds: [],
  });

function reconnect() {
  act(() => watch.setConnected?.(false));
  act(() => watch.setConnected?.(true));
}

async function settleDeferredBatch(outcome: Outcome, state: ReturnType<typeof server>) {
  await waitFor(() => expect(state.deferred).toHaveLength(1));
  await act(async () => state.deferred.shift()!(outcome));
}

function openFreshPage() {
  localStorage.clear();
  window.history.replaceState(null, '', '/?base=main&target=feature');
  vi.mocked(fetch).mockReset();
  vi.stubGlobal('WebSocket', MockWebSocket);
  watch.initiallyConnected = true;
}

function restoreGlobals() {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
}

describe('comment and verdict changes the server has not confirmed', () => {
  beforeEach(openFreshPage);
  afterEach(restoreGlobals);

  it('removes an op from the queue once the server confirms it', async () => {
    const state = server();
    mount();
    await waitForServerThreads();

    await sendGeneralComment('Saved');

    await waitFor(() => expect(bodiesOf(state.threads)).toEqual(['Saved']));
    expect(queued()).toEqual([]);
    expect(notSavedAlert()).toBeNull();
    await expectShown('Saved');
  });

  it('keeps a failed op queued, shows it, and says so in the header', async () => {
    const state = server();
    mount();
    await waitForServerThreads();
    state.fail = 'status';

    await sendGeneralComment('Not saved yet');

    const alert = await findNotSavedAlert();
    expect(alert).toHaveTextContent('503 Service Unavailable');
    expect(alert.closest('header')).not.toBeNull();
    expect(queuedBodies()).toEqual(['Not saved yet']);
    expect(state.threads).toEqual([]);
    await expectShown('Not saved yet');
  });

  it('sends a queued op again when the live connection reopens', async () => {
    const state = server();
    mount();
    await waitForServerThreads();
    state.fail = 'network';
    await sendGeneralComment('Written offline');
    expect(await findNotSavedAlert()).toHaveTextContent('Failed to fetch');
    state.fail = false;

    reconnect();

    await waitFor(() => expect(notSavedAlert()).toBeNull());
    expect(bodiesOf(state.threads)).toEqual(['Written offline']);
    expect(queued()).toEqual([]);
  });

  it('sends a queued op again when the review loads', async () => {
    const state = server([generalThread('server', 'On the server')]);
    const op = {
      id: 'queued-before-reload',
      type: 'thread.add',
      thread: generalThread('pending', 'Unsaved before reload'),
      queuedAt: time,
    } as const;
    localStorage.setItem(
      `${QUEUE_PREFIX}${JSON.stringify(['repo', 'main:feature:direct'])}:${time}-${op.id}`,
      JSON.stringify(op),
    );

    mount();

    await waitFor(() => expect(state.batches).toEqual([[op]]));
    await waitFor(() => expect(queued()).toEqual([]));
    expect(bodiesOf(state.threads)).toEqual(['On the server', 'Unsaved before reload']);
    await expectShown('Unsaved before reload');
  });

  it('follows another tab on this review that sends the waiting changes', async () => {
    const state = server();
    mount();
    await waitForServerThreads();
    state.fail = 'status';
    await sendGeneralComment('Sent by the other tab');
    await findNotSavedAlert();
    const [key] = Object.keys(localStorage).filter((item) => item.startsWith(QUEUE_PREFIX));

    act(() => {
      localStorage.removeItem(key!);
      window.dispatchEvent(new StorageEvent('storage', { key }));
    });

    expect(notSavedAlert()).toBeNull();
  });

  it('sends a queued op after the commit range moves', async () => {
    const state = server();
    mount();
    await waitForServerThreads();
    state.fail = 'status';
    await sendGeneralComment('Before HEAD moved');
    await findNotSavedAlert();

    state.commit = 'def456';
    await act(async () => watch.reload?.());
    state.fail = false;
    reconnect();

    await waitFor(() => expect(bodiesOf(state.threads)).toEqual(['Before HEAD moved']));
    expect(queued()).toEqual([]);
    await expectShown('Before HEAD moved');
  });

  it('applies a retry after a lost answer once', async () => {
    const state = server();
    mount();
    await waitForServerThreads();
    state.fail = 'lost';
    await sendGeneralComment('Answer lost');
    await findNotSavedAlert();
    expect(bodiesOf(state.threads)).toEqual(['Answer lost']);
    state.fail = false;

    reconnect();

    await waitFor(() => expect(notSavedAlert()).toBeNull());
    expect(state.batches).toHaveLength(2);
    expect(state.batches[1]?.map(({ id }) => id)).toEqual(state.batches[0]?.map(({ id }) => id));
    expect(bodiesOf(state.threads)).toEqual(['Answer lost']);
    expect(queued()).toEqual([]);
  });

  it('does not bring back a thread deleted on the server when the review loads again', async () => {
    const state = server([generalThread('deleted', 'Deleted in another browser')]);
    const first = mount();
    await expectShown('Deleted in another browser');
    first.unmount();

    state.threads = [generalThread('kept', 'Still on the server')];
    state.version += 1;
    mount();

    const conversation = await openConversation();
    expect(await conversation.findByText('Still on the server')).toBeVisible();
    expect(conversation.queryByText('Deleted in another browser')).not.toBeInTheDocument();
    expect(state.batches).toEqual([]);
    expect(savedRecord().threads).toBeUndefined();
  });

  it('sends a verdict given after a queued comment after that comment', async () => {
    const state = server();
    mount();
    await waitForServerThreads();
    state.fail = 'status';
    await sendGeneralComment('Before the verdict');
    await findNotSavedAlert();

    await userEvent.click(approveButton());
    await waitFor(() => expect(queuedBodies()).toEqual(['Before the verdict', 'verdict.set']));
    state.fail = false;
    reconnect();

    await waitFor(() => expect(notSavedAlert()).toBeNull());
    expect(state.applied.map(({ type }) => type)).toEqual(['thread.add', 'verdict.set']);
    expect(state.verdict).toBe('approve');
    // The server announces the verdict it applied.
    await act(async () => watch.approvalChanged?.());
    await waitFor(() => expect(approveButton()).toHaveTextContent(/^Approved$/));
  });

  it('shows the next step for a verdict that a retry gets confirmed', async () => {
    const state = server();
    mount();
    await waitForServerThreads();
    state.fail = 'status';
    await userEvent.click(approveButton());
    await findNotSavedAlert();
    expect(approveButton()).toBeEnabled();
    state.fail = false;

    reconnect();
    expect(await screen.findByRole('dialog', { name: 'Next step' })).toBeVisible();
  });

  it('celebrates once for two approvals clicked while the first waits', async () => {
    let bursts = 0;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      bursts++;
      return null;
    });
    const state = server();
    mount();
    await waitForServerThreads();
    state.fail = 'status';
    await userEvent.click(approveButton());
    await findNotSavedAlert();
    await userEvent.click(approveButton());
    await waitFor(() => expect(queued()).toHaveLength(2));
    state.fail = false;

    reconnect();

    expect(await screen.findByRole('dialog', { name: 'Next step' })).toBeVisible();
    expect(state.applied.map(({ type }) => type)).toEqual(['verdict.set', 'verdict.set']);
    expect(bursts).toBe(1);
  });

  it('does not start the next step for a waiting Reject that a later clear replaced', async () => {
    const state = server();
    state.verdict = 'approve';
    mount();
    await waitFor(() => expect(approveButton()).toHaveTextContent(/^Approved$/));
    state.fail = 'status';
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await findNotSavedAlert();
    await userEvent.click(approveButton());
    await waitFor(() =>
      expect(queued().map(({ type }) => type)).toEqual(['verdict.set', 'verdict.set']),
    );
    state.fail = false;
    let releaseReviews = () => {};
    state.snapshotGate = new Promise((resolve) => {
      releaseReviews = resolve;
    });

    // The Reject's next step waits on the list of reviews until the clear has shown.
    reconnect();
    await waitFor(() => expect(queued()).toEqual([]));
    await waitFor(() => expect(approveButton()).toHaveTextContent(/^Approve$/));
    await act(async () => releaseReviews());

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('dialog', { name: 'Next step' })).toBeNull();
  });

  it('celebrates and moves on when the read an approval event starts answers after its own', async () => {
    let bursts = 0;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      bursts++;
      return null;
    });
    const state = server();
    mount();
    await waitForServerThreads();
    state.holdApprovalReads = true;
    await userEvent.click(approveButton());
    await waitFor(() => expect(state.heldApprovalReads).toHaveLength(1));
    // The server announces the verdict it applied, and that starts a second read.
    act(() => void watch.approvalChanged?.());
    await waitFor(() => expect(state.heldApprovalReads).toHaveLength(2));
    state.holdApprovalReads = false;

    await act(async () => state.heldApprovalReads.shift()!());
    await act(async () => state.heldApprovalReads.shift()!());

    expect(await screen.findByRole('dialog', { name: 'Next step' })).toBeVisible();
    expect(bursts).toBe(1);
  });

  it('does not celebrate or move on for an approval another tab cleared before it was read back', async () => {
    let bursts = 0;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      bursts++;
      return null;
    });
    const state = server();
    mount();
    await waitForServerThreads();
    state.holdApprovalReads = true;
    await userEvent.click(approveButton());
    await waitFor(() => expect(state.heldApprovalReads).toHaveLength(1));
    expect(state.verdict).toBe('approve');
    // Another tab clears the verdict before this tab reads its own approval back.
    state.verdict = undefined;
    state.holdApprovalReads = false;

    await act(async () => state.heldApprovalReads.shift()!());

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('dialog', { name: 'Next step' })).toBeNull();
    expect(bursts).toBe(0);
  });

  it('does not celebrate an approval that a later Reject replaced', async () => {
    let bursts = 0;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      bursts++;
      return null;
    });
    const state = server();
    mount();
    await waitForServerThreads();
    state.fail = 'status';
    await userEvent.click(approveButton());
    await findNotSavedAlert();
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(queued()).toHaveLength(2));
    state.fail = false;

    reconnect();

    await waitFor(() => expect(queued()).toEqual([]));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(state.verdict).toBe('reject');
    expect(bursts).toBe(0);
  });

  it('sends a waiting op when the live connection first opens after the page loaded', async () => {
    watch.initiallyConnected = false;
    const state = server();
    mount();
    await waitForServerThreads();
    state.fail = 'status';
    await sendGeneralComment('Before the connection opened');
    await findNotSavedAlert();
    state.fail = false;

    act(() => watch.setConnected?.(true));

    await waitFor(() => expect(bodiesOf(state.threads)).toEqual(['Before the connection opened']));
    expect(queued()).toEqual([]);
  });

  // The review tabs show every review's verdict. A page whose live connection is gone gets no
  // approvalChanged event, which this harness never sends, so the answer itself must reload them.
  const reviewListReads = () =>
    vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).startsWith('/api/conversation/snapshot')).length;

  it('reloads the review tabs for a verdict another tab sends', async () => {
    const state = server();
    mount();
    await waitForServerThreads();
    state.fail = 'status';
    await userEvent.click(approveButton());
    await findNotSavedAlert();
    const before = reviewListReads();
    const [key] = Object.keys(localStorage).filter((item) => item.startsWith(QUEUE_PREFIX));

    // The other tab's send reached the server and removed the shared queue entry.
    state.verdict = 'approve';
    act(() => {
      localStorage.removeItem(key!);
      window.dispatchEvent(new StorageEvent('storage', { key }));
    });

    await waitFor(() => expect(reviewListReads()).toBeGreaterThan(before));
  });

  it('reloads the review tabs for a verdict that a retry gets rejected', async () => {
    const state = server();
    mount();
    await waitForServerThreads();
    state.fail = 'status';
    await userEvent.click(approveButton());
    await findNotSavedAlert();
    const before = reviewListReads();
    state.fail = false;
    state.staleVerdict = 'Diff changed; reload it before choosing a verdict';

    reconnect();

    await waitFor(() => expect(reviewListReads()).toBeGreaterThan(before));
  });

  it('reloads the diff for a verdict that a retry gets rejected because the diff changed', async () => {
    const state = server();
    mount();
    await waitForServerThreads();
    state.fail = 'status';
    await userEvent.click(approveButton());
    await findNotSavedAlert();
    const diffReads = () =>
      vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith('/api/diff')).length;
    const before = diffReads();
    state.fail = false;
    state.staleVerdict = 'Diff changed; reload it before choosing a verdict';

    reconnect();

    await waitFor(() => expect(diffReads()).toBeGreaterThan(before));
  });

  it('does not resend or read again when the live connection first opens', async () => {
    watch.initiallyConnected = false;
    server();
    mount();
    await waitForServerThreads();
    const requests = () => vi.mocked(fetch).mock.calls.length;
    const before = requests();

    act(() => watch.setConnected?.(true));

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(requests()).toBe(before);
  });

  it('reads the old browser copy of a review once, not after each comment', async () => {
    server();
    const read = vi.spyOn(storageService, 'getCommentThreads');
    mount();
    await waitForServerThreads();

    await sendGeneralComment('One');
    await sendGeneralComment('Two');

    expect(read).toHaveBeenCalledTimes(1);
  });

  it('drops a stale verdict the server rejects and shows its error', async () => {
    const state = server();
    state.staleVerdict = 'Review capture or summary changed; reload before choosing a verdict';
    mount();
    await waitForServerThreads();

    await userEvent.click(approveButton());

    expect(
      await screen.findByText(
        /Review capture or summary changed; reload before choosing a verdict/,
      ),
    ).toBeVisible();
    expect(queued()).toEqual([]);
    expect(state.verdict).toBeUndefined();
    expect(approveButton()).toHaveTextContent(/^Approve$/);
  });

  it('keeps an op queued after an earlier answer arrives without confirming it', async () => {
    const state = server();
    mount();
    await waitForServerThreads();
    state.deferNextBatch = true;
    await sendGeneralComment('One');
    await waitFor(() => expect(state.deferred).toHaveLength(1));
    await sendGeneralComment('Two');
    state.fail = 'status';

    // The answer for One confirms only One; its threads do not have Two yet.
    await settleDeferredBatch(false, state);

    await findNotSavedAlert();
    expect(bodiesOf(state.threads)).toEqual(['One']);
    expect(queuedBodies()).toEqual(['Two']);
    await expectShown('Two');
    state.fail = false;
    reconnect();
    await waitFor(() => expect(bodiesOf(state.threads)).toEqual(['One', 'Two']));
    expect(queued()).toEqual([]);
  });

  it('keeps a queued op when a comments read that started before it answers', async () => {
    const state = server();
    mount();
    await waitForServerThreads();
    state.deferNextRead = true;
    let refresh: Promise<void> | undefined;
    act(() => {
      refresh = watch.commentsChanged?.();
    });
    await waitFor(() => expect(state.deferredReads).toHaveLength(1));
    state.fail = 'status';
    await sendGeneralComment('Do not lose this');
    await findNotSavedAlert();

    await act(async () => {
      state.deferredReads.shift()!();
      await refresh;
    });

    expect(queuedBodies()).toEqual(['Do not lose this']);
    await expectShown('Do not lose this');
    state.fail = false;
    reconnect();
    await waitFor(() => expect(bodiesOf(state.threads)).toEqual(['Do not lose this']));
    expect(queued()).toEqual([]);
  });

  it('keeps a queued op when a comments read answers while its batch is in flight', async () => {
    const state = server();
    mount();
    await waitForServerThreads();
    state.deferNextBatch = true;
    await sendGeneralComment('In flight');
    await waitFor(() => expect(state.deferred).toHaveLength(1));
    state.threads = [generalThread('agent', 'Agent comment')];
    state.version += 1;

    await act(async () => watch.commentsChanged?.());

    expect(queuedBodies()).toEqual(['In flight']);
    await expectShown('In flight');
    await expectShown('Agent comment');
    await settleDeferredBatch('status', state);
    await findNotSavedAlert();
    expect(queuedBodies()).toEqual(['In flight']);
    state.fail = false;
    reconnect();
    await waitFor(() => expect(bodiesOf(state.threads)).toEqual(['Agent comment', 'In flight']));
    expect(queued()).toEqual([]);
  });

  it('shows a change the agent made after a batch was answered', async () => {
    const state = server();
    mount();
    await waitForServerThreads();
    state.deferNextBatch = true;
    await sendGeneralComment('Mine');
    await waitFor(() => expect(state.deferred).toHaveLength(1));
    // A read that starts before the batch's answer arrives and reads the agent's later change.
    state.deferNextRead = true;
    let refresh: Promise<void> | undefined;
    act(() => {
      refresh = watch.commentsChanged?.();
    });
    await waitFor(() => expect(state.deferredReads).toHaveLength(1));
    await settleDeferredBatch(false, state);
    state.threads = [...state.threads, generalThread('agent', 'Agent change')];
    state.version += 1;

    await act(async () => {
      state.deferredReads.shift()!();
      await refresh;
    });

    await expectShown('Agent change');
    await expectShown('Mine');
  });

  it('sends the threads an earlier version kept in the browser once, then removes them', async () => {
    const state = server([generalThread('server', 'On the server')]);
    localStorage.setItem(
      STORAGE_KEY,
      legacyRecord([
        generalThread('server', 'On the server'),
        generalThread('browser-only', 'Only ever reached this browser'),
      ]),
    );
    const first = mount();

    await waitFor(() =>
      expect(bodiesOf(state.threads)).toEqual(['On the server', 'Only ever reached this browser']),
    );
    expect(state.applied.map((op) => op.type === 'thread.add' && op.thread.id)).toEqual([
      'browser-only',
    ]);
    expect(savedRecord().threads).toBeUndefined();
    expect(queued()).toEqual([]);
    first.unmount();

    mount();
    await expectShown('Only ever reached this browser');
    expect(state.batches).toHaveLength(1);
  });

  it.each([false, true])(
    'removes undo copies an earlier version kept with no threads (--clean: %s)',
    async (clean) => {
      const state = server();
      state.clean = clean;
      const deleted = generalThread('deleted', 'Deleted before the upgrade');
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          ...(JSON.parse(legacyRecord([])) as object),
          deletedComments: [{ thread: deleted, followingIds: [], precedingIds: [] }],
        }),
      );

      mount();
      await waitForServerThreads();

      await waitFor(() => expect(savedRecord().deletedComments).toBeUndefined());
      expect(state.batches).toEqual([]);
    },
  );

  it('does not send the threads an earlier version kept when started with --clean', async () => {
    const state = server([generalThread('server', 'On the server')]);
    state.clean = true;
    localStorage.setItem(
      STORAGE_KEY,
      legacyRecord([generalThread('browser-only', 'Cleared by --clean')]),
    );
    mount();

    await expectShown('On the server');
    expect(state.batches).toEqual([]);
    expect(savedRecord().threads).toBeUndefined();
  });
});

describe('verdict shortcuts', () => {
  beforeEach(openFreshPage);
  afterEach(restoreGlobals);

  const verdictsSent = (state: ReturnType<typeof server>) =>
    state.applied.flatMap((op) => (op.type === 'verdict.set' ? [op.verdict] : []));

  it('approves with Shift+A, as the Approve button does', async () => {
    const state = server();
    mount();
    await waitForServerThreads();

    await userEvent.keyboard('{Shift>}A{/Shift}');

    await waitFor(() => expect(approveButton()).toHaveTextContent(/^Approved$/));
    expect(verdictsSent(state)).toEqual(['approve']);
  });

  it('rejects with Shift+X, as the Reject button does', async () => {
    const state = server();
    mount();
    await waitForServerThreads();

    await userEvent.keyboard('{Shift>}X{/Shift}');

    await waitFor(() => expect(state.verdict).toBe('reject'));
    expect(verdictsSent(state)).toEqual(['reject']);
  });

  it('sends nothing for the verdict the review already has, so the shortcut never clears it', async () => {
    const state = server();
    state.verdict = 'approve';
    mount();
    await waitFor(() => expect(approveButton()).toHaveTextContent(/^Approved$/));
    await waitForServerThreads();

    await userEvent.keyboard('{Shift>}A{/Shift}');
    // Ops go out in order, so a verdict from the first press would come before this one.
    await userEvent.keyboard('{Shift>}X{/Shift}');

    await waitFor(() => expect(state.verdict).toBe('reject'));
    expect(verdictsSent(state)).toEqual(['reject']);
  });

  it('sends no approval while the Approve button waits for the proposed commit message', async () => {
    const state = server();
    let releaseSummary = () => {};
    state.summaryGate = new Promise((release) => (releaseSummary = release));
    mount();
    // Reject needs only the comments; Approve also waits for the summary.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled());
    expect(approveButton()).toBeDisabled();

    await userEvent.keyboard('{Shift>}A{/Shift}');
    releaseSummary();
    await waitForServerThreads();
    // Ops go out in order, so an approval from the first press would come before this one.
    await userEvent.keyboard('{Shift>}X{/Shift}');

    await waitFor(() => expect(state.verdict).toBe('reject'));
    expect(verdictsSent(state)).toEqual(['reject']);
  });

  it('sends no verdict for a diff opened without the verdict buttons', async () => {
    const state = server();
    state.shipIt = false;
    mount();
    await screen.findByRole('button', { name: 'Conversation' });

    await userEvent.keyboard('{Shift>}A{/Shift}');
    // Ops go out in order, so a verdict from the shortcut would come before this comment.
    await sendGeneralComment('After the shortcut');

    await waitFor(() => expect(state.applied).toHaveLength(1));
    expect(state.applied.map(({ type }) => type)).toEqual(['thread.add']);
    expect(screen.queryByRole('group', { name: 'Verdict' })).toBeNull();
  });
});
