import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LIVE_OTHER_SERVER } from '../../types/live';
import { DiffMode } from '../../types/watch';

import { subscribeLive, type LiveListener } from './liveConnection';
import { MockWebSocket } from './liveConnection.testing';

describe('live connection', () => {
  const stops: Array<() => void> = [];
  const subscribe = (listener: LiveListener = {}) => {
    const stop = subscribeLive(listener);
    stops.push(stop);
    return stop;
  };
  const presence = { reviewers: { connected: 1, visible: 1 }, listeners: 0 };

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
      expect(onLost).toHaveBeenLastCalledWith(true);
      vi.advanceTimersByTime(3000);
      expect(MockWebSocket.instances).toHaveLength(attempt + 1);
      expect(new URL(MockWebSocket.latest().url).searchParams.get('server')).toBe('server-1');
    }
    MockWebSocket.latest().drop();
    expect(onLost).toHaveBeenLastCalledWith(false);
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
    expect(listener.onLost).toHaveBeenCalledExactlyOnceWith(false);
    expect(listener.onOpen).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    expect(MockWebSocket.instances).toHaveLength(1);
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
