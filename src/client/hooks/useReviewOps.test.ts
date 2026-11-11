import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DiffCommentThread } from '../../types/diff';
import type { ReviewOp, ReviewOpResult } from '../../types/reviewOps';
import { type QueuedOp, useReviewOps } from './useReviewOps';

const PREFIX = 'gavel:review-ops:';
const time = '2026-11-11T00:00:00.000Z';

const thread = (id: string): DiffCommentThread => ({
  id,
  scope: 'review',
  createdAt: time,
  updatedAt: time,
  messages: [{ id, body: id, createdAt: time, updatedAt: time }],
});
const add = (id: string): ReviewOp => ({ type: 'thread.add', thread: thread(id) });

const queueKeys = () => Object.keys(localStorage).filter((key) => key.startsWith(PREFIX));

/** Every op this browser holds, in queue order. */
const stored = () =>
  queueKeys()
    .sort()
    .map((key) => JSON.parse(localStorage.getItem(key)!) as QueuedOp);

/** Removes ops from storage as another tab does once the server confirmed them. */
function confirmInOtherTab(ids: string[]) {
  for (const key of queueKeys()) {
    if (!ids.includes((JSON.parse(localStorage.getItem(key)!) as QueuedOp).id)) continue;
    localStorage.removeItem(key);
    window.dispatchEvent(new StorageEvent('storage', { key }));
  }
}

const bodies = (threads: DiffCommentThread[]) => threads.map(({ id }) => id);

// sequence stands for the server's event sequence, which progress advances without a new version.
interface Answer {
  status: number;
  version: number;
  sequence?: number;
  threads: DiffCommentThread[];
  results?: (ops: QueuedOp[]) => ReviewOpResult[];
}

/** Answers each request with the next answer queued for its path, or waits for one. */
function server() {
  const answers: Record<string, Array<Answer | Promise<Answer>>> = {
    '/api/comments-json': [],
    '/api/review-ops': [],
  };
  const sent: QueuedOp[][] = [];
  // What the server holds now, which a request without a queued answer reads.
  let current: Answer = { status: 200, version: 1, threads: [] };
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const path = String(input).split('?')[0]!;
    const ops = init?.body ? (JSON.parse(String(init.body)) as { ops: QueuedOp[] }).ops : [];
    if (path === '/api/review-ops') sent.push(ops);
    const answer = await (answers[path]!.shift() ?? current);
    if (answer.status !== 200) return new Response('{}', { status: answer.status });
    const sequence = answer.sequence ?? answer.version;
    if (sequence >= (current.sequence ?? current.version))
      current = { status: 200, version: answer.version, sequence, threads: answer.threads };
    return Response.json({
      version: answer.version,
      cursor: `server:${sequence}`,
      threads: answer.threads,
      results: (answer.results ?? ((all) => all.map(({ id }) => ({ id, status: 'applied' }))))(ops),
    });
  });
  return { answers, sent };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const mount = () => renderHook(() => useReviewOps('review', 'base=a&target=b', 'repo'));

const withProgress = (status: 'thinking' | 'noted'): DiffCommentThread => {
  const item = thread('mine');
  item.messages[0]!.progress = { status, cursor: 'server:2', updatedAt: time };
  return item;
};

describe('useReviewOps', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(fetch).mockReset();
  });

  it('keeps an op another tab queues while this tab is queueing one', async () => {
    const { answers } = server();
    answers['/api/review-ops']!.push(
      { status: 503, version: 1, threads: [] },
      { status: 503, version: 1, threads: [] },
    );
    const tab = mount();
    const otherTab = mount();
    await waitFor(() => expect(tab.result.current.loaded).toBe(true));
    // The other tab writes between this tab's read of the queue and its write.
    const getItem = Storage.prototype.getItem;
    let interleaved = false;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
      const value = getItem.call(this, key);
      if (!interleaved && key.startsWith(PREFIX)) {
        interleaved = true;
        void otherTab.result.current.enqueue(add('theirs'));
      }
      return value;
    });

    await act(async () => void tab.result.current.enqueue(add('mine')));
    vi.restoreAllMocks();
    server();

    const ids = stored().map((op) => (op.type === 'thread.add' ? op.thread.id : op.type));
    expect(ids.sort((a, b) => a.localeCompare(b))).toEqual(['mine', 'theirs']);
  });

  it('keeps newer threads when an older op answer arrives after a comments read', async () => {
    const { answers } = server();
    const lateAnswer = deferred<Answer>();
    answers['/api/review-ops']!.push(lateAnswer.promise);
    const { result } = mount();
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(async () => void result.current.enqueue(add('mine')));
    answers['/api/comments-json']!.push({
      status: 200,
      version: 3,
      threads: [thread('mine'), thread('agent')],
    });

    await act(() => result.current.refresh());
    await act(async () =>
      lateAnswer.resolve({ status: 200, version: 2, threads: [thread('mine')] }),
    );

    expect(bodies(result.current.threads)).toEqual(['mine', 'agent']);
  });

  it('keeps newer threads when an older comments read arrives after an op answer', async () => {
    const { answers } = server();
    const lateRead = deferred<Answer>();
    const { result } = mount();
    await waitFor(() => expect(result.current.loaded).toBe(true));
    answers['/api/comments-json']!.push(lateRead.promise);
    answers['/api/review-ops']!.push({
      status: 200,
      version: 3,
      threads: [thread('agent'), thread('mine')],
    });
    let reading: Promise<void> | undefined;
    act(() => {
      reading = result.current.refresh();
    });

    await act(async () => void (await result.current.enqueue(add('mine')).sent));
    await act(async () => {
      lateRead.resolve({ status: 200, version: 2, threads: [thread('agent')] });
      await reading;
    });

    expect(bodies(result.current.threads)).toEqual(['agent', 'mine']);
  });

  it('keeps a confirmed change when a read that started before it answers after a reconnect', async () => {
    const { answers } = server();
    const lateRead = deferred<Answer>();
    const { result } = mount();
    await waitFor(() => expect(result.current.loaded).toBe(true));
    answers['/api/comments-json']!.push(lateRead.promise);
    answers['/api/review-ops']!.push({ status: 200, version: 2, threads: [thread('mine')] });
    let retrying: Promise<void> | undefined;
    act(() => {
      retrying = result.current.retry();
    });
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(1));

    await act(async () => void (await result.current.enqueue(add('mine')).sent));
    expect(stored()).toEqual([]);
    await act(async () => {
      lateRead.resolve({ status: 200, version: 1, threads: [] });
      await retrying;
    });

    expect(bodies(result.current.threads)).toEqual(['mine']);
  });

  it('keeps newer agent progress when an older answer of the same comment version lands', async () => {
    const { answers } = server();
    const lateAnswer = deferred<Answer>();
    answers['/api/review-ops']!.push(lateAnswer.promise);
    const { result } = mount();
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => void result.current.enqueue(add('mine')));
    answers['/api/comments-json']!.push({
      status: 200,
      version: 2,
      sequence: 4,
      threads: [withProgress('noted')],
    });

    await act(() => result.current.refresh());
    await act(async () =>
      lateAnswer.resolve({
        status: 200,
        version: 2,
        sequence: 3,
        threads: [withProgress('thinking')],
      }),
    );

    expect(result.current.threads[0]?.messages[0]?.progress?.status).toBe('noted');
  });

  it('keeps a re-anchored comment when a late read with the same cursor and a lower version lands', async () => {
    const { answers } = server();
    const moved = (line: number): DiffCommentThread => ({
      ...thread('anchored'),
      scope: undefined,
      filePath: 'a.ts',
      position: { side: 'new', line },
    });
    const lateRead = deferred<Answer>();
    answers['/api/comments-json']!.push({
      status: 200,
      version: 1,
      sequence: 5,
      threads: [moved(1)],
    });
    const { result } = mount();
    await waitFor(() => expect(result.current.loaded).toBe(true));
    answers['/api/comments-json']!.push(lateRead.promise, {
      status: 200,
      version: 2,
      sequence: 5,
      threads: [moved(2)],
    });
    let late: Promise<void> | undefined;
    act(() => {
      late = result.current.refresh();
    });

    // The agent's correction moves the comment without a conversation event.
    await act(() => result.current.refresh());
    await act(async () => {
      lateRead.resolve({ status: 200, version: 1, sequence: 5, threads: [moved(1)] });
      await late;
    });

    const [shown] = result.current.threads;
    expect(shown?.scope === 'review' ? undefined : shown?.position.line).toBe(2);
  });

  it('takes a read from a restarted server even when its comment version is lower', async () => {
    const { answers } = server();
    answers['/api/comments-json']!.push({ status: 200, version: 9, threads: [thread('before')] });
    const { result } = mount();
    await waitFor(() => expect(bodies(result.current.threads)).toEqual(['before']));
    vi.mocked(fetch).mockImplementationOnce(async () =>
      Response.json({ version: 1, cursor: 'restarted:1', threads: [thread('after')] }),
    );

    await act(() => result.current.refresh());

    expect(bodies(result.current.threads)).toEqual(['after']);
  });

  it('settles a waiting verdict that another tab confirmed after the reviewer switched reviews', async () => {
    const { answers } = server();
    const first = deferred<Answer>();
    answers['/api/review-ops']!.push(first.promise);
    const { result, rerender } = renderHook(
      ({ scope }) => useReviewOps(scope, `review=${scope}`, 'repo'),
      { initialProps: { scope: 'a' } },
    );
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => void result.current.enqueue(add('first')));
    let answer: Promise<unknown> | undefined;
    act(() => {
      answer = result.current.enqueue({ type: 'verdict.set', verdict: 'as-is' }).answer;
    });
    const verdictId = stored().find(({ type }) => type === 'verdict.set')!.id;

    rerender({ scope: 'b' });
    act(() => confirmInOtherTab([verdictId]));

    const unsettled = new Promise((resolve) => setTimeout(() => resolve('unsettled'), 200));
    await expect(Promise.race([answer, unsettled])).resolves.toBe('elsewhere');
  });

  it('settles a change that another tab got confirmed', async () => {
    const { answers } = server();
    const first = deferred<Answer>();
    answers['/api/review-ops']!.push(first.promise);
    const { result } = mount();
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => void result.current.enqueue(add('first')));
    let answer: Promise<unknown> | undefined;
    act(() => {
      answer = result.current.enqueue({ type: 'verdict.set', verdict: 'as-is' }).answer;
    });
    const verdictId = stored().find(({ type }) => type === 'verdict.set')!.id;

    act(() => confirmInOtherTab([verdictId]));
    await act(async () => first.resolve({ status: 200, version: 2, threads: [thread('first')] }));

    const unsettled = new Promise((resolve) => setTimeout(() => resolve('unsettled'), 200));
    await expect(Promise.race([answer, unsettled])).resolves.toBe('elsewhere');
  });

  it('keeps a refused change in the alert until the next change', async () => {
    const { answers } = server();
    answers['/api/review-ops']!.push({
      status: 200,
      version: 1,
      threads: [],
      results: (ops) => ops.map(({ id }) => ({ id, status: 'rejected', error: 'Stale capture' })),
    });
    const { result } = mount();
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(async () => void (await result.current.enqueue(add('refused')).sent));
    expect(result.current.alert).toContain('Stale capture');

    // Another tab's change waits in storage after a failed send, and an automatic retry sends it.
    const otherTab = mount();
    await waitFor(() => expect(otherTab.result.current.loaded).toBe(true));
    answers['/api/review-ops']!.push({ status: 503, version: 1, threads: [] });
    await act(async () => void (await otherTab.result.current.enqueue(add('other')).sent));
    await act(() => result.current.retry());
    expect(stored()).toEqual([]);
    expect(result.current.alert).toContain('Stale capture');

    await act(async () => void (await result.current.enqueue(add('next')).sent));
    expect(result.current.alert).toBeNull();
  });

  it('names what sends waiting changes again', async () => {
    const { answers } = server();
    answers['/api/review-ops']!.push({ status: 503, version: 1, threads: [] });
    const { result } = mount();
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => void (await result.current.enqueue(add('waiting')).sent));

    expect(result.current.alert).toContain(
      'Gavel sends it again with your next change, when you reload, or when the live connection reopens.',
    );
  });

  it('shows a failed first comments read in the alert', async () => {
    const { answers } = server();
    answers['/api/comments-json']!.push({ status: 500, version: 0, threads: [] });

    const { result } = mount();

    await waitFor(() => expect(result.current.alert).toContain('Could not load comments'));
    expect(result.current.loaded).toBe(false);
  });
});
