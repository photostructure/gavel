import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LIVE_OTHER_SERVER, LIVE_RESTARTED } from '../../types/live';
import { DiffMode } from '../../types/watch';

import { reconnectLive, subscribeLive, type LiveListener } from './liveConnection';
import { MockWebSocket } from './liveConnection.testing';

describe('live connection', () => {
  const stops: Array<() => void> = [];
  const subscribe = (listener: LiveListener = {}) => {
    const stop = subscribeLive(listener);
    stops.push(stop);
    return stop;
  };
  const presence = { reviewers: { connected: 1, visible: 1 }, listeners: 0 };
  // The review this page shows, as App passes it when the reviewer asks to reconnect.
  const review = { repositoryId: 'repo-1', agentSessionId: 'session-1' };

  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
  });
  afterEach(() => {
    // Leaves no subscriber, which resets the page's connection for the next test.
    for (const stop of stops.splice(0)) stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('shares one socket among subscribers and closes it with the last one', () => {
    const first = subscribe();
    const second = subscribe();
    expect(MockWebSocket.instances).toHaveLength(1);
    const url = new URL(MockWebSocket.latest().url);
    expect(url.protocol).toBe('ws:');
    expect(url.host).toBe(window.location.host);
    expect(url.pathname).toBe('/api/live');
    expect(url.searchParams.get('tab')).toMatch(/^[\w-]+$/);
    expect(url.searchParams.get('visible')).toBe(String(document.visibilityState === 'visible'));
    expect(url.searchParams.has('server')).toBe(false);
    first();
    expect(MockWebSocket.latest().close).not.toHaveBeenCalled();
    second();
    expect(MockWebSocket.latest().close).toHaveBeenCalledOnce();
  });

  it('names the access token in the socket URL, since a WebSocket cannot set a header', () => {
    window.history.replaceState(null, '', '/#gavel-token=live-token');
    try {
      const unsubscribe = subscribe();
      expect(new URL(MockWebSocket.latest().url).searchParams.get('gavel-token')).toBe(
        'live-token',
      );
      unsubscribe();
    } finally {
      window.history.replaceState(null, '', '/');
      localStorage.clear();
    }
  });

  it('connects straight to the API server in development', () => {
    vi.stubEnv('VITE_GAVEL_API_URL', 'http://localhost:4969');
    subscribe();
    expect(MockWebSocket.latest().url).toMatch(/^ws:\/\/localhost:4969\/api\/live\?/);
  });

  it('gives a subscriber that joins an open connection the latest presence and watch state', () => {
    subscribe();
    const live = MockWebSocket.latest();
    live.open();
    const connected = {
      type: 'connected' as const,
      diffMode: DiffMode.WORKING,
      changeType: 'file' as const,
      timestamp: '2026-11-09T00:00:00Z',
    };
    live.receive({ channel: 'watch', event: connected });
    live.receive({ channel: 'presence', presence });
    const late = { onOpen: vi.fn(), onMessage: vi.fn() };
    subscribe(late);
    expect(late.onOpen).toHaveBeenCalledOnce();
    expect(late.onMessage.mock.calls.map(([message]) => message)).toEqual([
      { channel: 'watch', event: connected },
      { channel: 'presence', presence },
    ]);
  });

  it('reports visibility changes once the socket is open', () => {
    subscribe();
    const live = MockWebSocket.latest();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(live.send).not.toHaveBeenCalled();
    live.open();
    live.send.mockClear();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(live.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'visibility', visible: document.visibilityState === 'visible' }),
    );
  });

  it('reconnects to the same server five times, then tells every subscriber to reload', () => {
    vi.useFakeTimers();
    const onLost = vi.fn();
    subscribe({ onLost });
    MockWebSocket.latest().open('server-1');
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      MockWebSocket.latest().drop();
      expect(onLost).toHaveBeenLastCalledWith(true, false);
      vi.advanceTimersByTime(3000);
      expect(MockWebSocket.instances).toHaveLength(attempt + 1);
      expect(new URL(MockWebSocket.latest().url).searchParams.get('server')).toBe('server-1');
    }
    MockWebSocket.latest().drop();
    expect(onLost).toHaveBeenLastCalledWith(false, false);
    vi.advanceTimersByTime(3000);
    expect(MockWebSocket.instances).toHaveLength(6);
    const late = { onLost: vi.fn() };
    subscribe(late);
    expect(late.onLost).toHaveBeenCalledExactlyOnceWith(false);
  });

  // A WebSocket opens before the server's refusal arrives; opening alone must not refetch.
  it('waits for the greeting and stops at once when a reconnect reaches another server', () => {
    vi.useFakeTimers();
    const listener = { onOpen: vi.fn(), onLost: vi.fn() };
    subscribe(listener);
    MockWebSocket.latest().open(null);
    expect(listener.onOpen).not.toHaveBeenCalled();
    MockWebSocket.latest().drop(LIVE_OTHER_SERVER);
    expect(listener.onLost).toHaveBeenCalledExactlyOnceWith(false, false);
    expect(listener.onOpen).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  // A reviewer who clicks the header robot after the page gave up gets a fresh round of retries.
  it('reconnects at once when asked after giving up, then retries five more times', () => {
    vi.useFakeTimers();
    const listener = { onOpen: vi.fn(), onLost: vi.fn() };
    subscribe(listener);
    MockWebSocket.latest().open('server-1');
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      MockWebSocket.latest().drop();
      vi.advanceTimersByTime(3000);
    }
    MockWebSocket.latest().drop();
    expect(listener.onLost).toHaveBeenLastCalledWith(false, false);
    expect(MockWebSocket.instances).toHaveLength(6);

    reconnectLive(review);

    expect(MockWebSocket.instances).toHaveLength(7);
    expect(listener.onLost).toHaveBeenLastCalledWith(true);
    expect(new URL(MockWebSocket.latest().url).searchParams.get('server')).toBe('server-1');
    MockWebSocket.latest().drop();
    vi.advanceTimersByTime(3000);
    expect(MockWebSocket.instances).toHaveLength(8);
    MockWebSocket.latest().open('server-1');
    expect(listener.onOpen).toHaveBeenCalledTimes(2);
  });

  it('skips the wait between automatic retries when asked to reconnect', () => {
    vi.useFakeTimers();
    subscribe();
    MockWebSocket.latest().open('server-1');
    MockWebSocket.latest().drop();
    expect(MockWebSocket.instances).toHaveLength(1);

    reconnectLive(review);

    expect(MockWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(3000);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('does not open another socket while one is open or opening', () => {
    subscribe();
    reconnectLive(review);
    expect(MockWebSocket.instances).toHaveLength(1);
    MockWebSocket.latest().open('server-1');
    reconnectLive(review);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  // A restarted server refuses a page that expects its predecessor, and only a reload loads the
  // new server's state; the page's queued changes and drafts are kept in localStorage.
  it('reloads the page when a reconnect the reviewer asked for reaches this review restarted', () => {
    vi.useFakeTimers();
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
    subscribe();
    MockWebSocket.latest().open('server-1');
    MockWebSocket.latest().drop();
    vi.advanceTimersByTime(3000);
    MockWebSocket.latest().drop(LIVE_OTHER_SERVER, LIVE_RESTARTED);
    expect(reload).not.toHaveBeenCalled();

    reconnectLive(review);
    MockWebSocket.latest().drop(LIVE_OTHER_SERVER, LIVE_RESTARTED);

    expect(reload).toHaveBeenCalledOnce();
  });

  // The server may come back only on one of the retries after the reviewer's click.
  it('still reloads when this review restarted answers a later retry after the click', () => {
    vi.useFakeTimers();
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
    subscribe();
    MockWebSocket.latest().open('server-1');
    MockWebSocket.latest().drop(LIVE_OTHER_SERVER);

    reconnectLive(review);
    MockWebSocket.latest().drop();
    vi.advanceTimersByTime(3000);
    MockWebSocket.latest().drop(LIVE_OTHER_SERVER, LIVE_RESTARTED);

    expect(reload).toHaveBeenCalledOnce();
  });

  // The refusing server answers for the review the reconnect names.
  it("names this review's repository and agent session when the reviewer asks to reconnect", () => {
    subscribe();
    MockWebSocket.latest().open('server-1');
    MockWebSocket.latest().drop(LIVE_OTHER_SERVER);

    reconnectLive(review);

    const query = new URL(MockWebSocket.latest().url).searchParams;
    expect(query.get('server')).toBe('server-1');
    expect(query.get('repository')).toBe('repo-1');
    expect(query.get('session')).toBe('session-1');
  });

  // Another review at this address, even another session's in this repository, does not have
  // this review's waiting changes; reloading into it would hide them, since localStorage keeps
  // them under this review.
  it('keeps the page and reports another review when the refusing server is not this review restarted', () => {
    vi.useFakeTimers();
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
    const onLost = vi.fn();
    subscribe({ onLost });
    MockWebSocket.latest().open('server-1');
    MockWebSocket.latest().drop(LIVE_OTHER_SERVER);

    reconnectLive(review);
    MockWebSocket.latest().drop(LIVE_OTHER_SERVER);

    expect(reload).not.toHaveBeenCalled();
    expect(onLost).toHaveBeenLastCalledWith(false, true);
    vi.advanceTimersByTime(3000);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('reports current visibility once the server greets the tab', () => {
    subscribe();
    const live = MockWebSocket.latest();
    live.open(null);
    expect(live.send).not.toHaveBeenCalled();
    live.receive({ channel: 'hello', serverId: 'server-1' });
    expect(live.send).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({ type: 'visibility', visible: document.visibilityState === 'visible' }),
    );
  });
});
