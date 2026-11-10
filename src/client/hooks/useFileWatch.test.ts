import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LIVE_OTHER_SERVER } from '../../types/live.js';
import { DiffMode, type WatchEvent } from '../../types/watch.js';
import { MockWebSocket } from '../utils/liveConnection.testing.js';

import { useFileWatch } from './useFileWatch.js';

// The page's live connection, fed watch events the way the server sends them.
class WatchSocket extends MockWebSocket {
  dispatchMessage(data: string) {
    this.receive({ channel: 'watch', event: JSON.parse(data) as WatchEvent });
  }

  dispatchError() {
    this.drop();
  }
}
const sockets = () => MockWebSocket.instances as WatchSocket[];
MockWebSocket.autoOpen = true;
vi.stubGlobal('WebSocket', WatchSocket);

// Mock console methods
vi.stubGlobal('console', {
  log: vi.fn(),
  error: vi.fn(),
});

describe('useFileWatch', () => {
  it('keeps one connection across callback changes and dispatches to the latest callbacks', async () => {
    const first = Array.from({ length: 4 }, () => vi.fn(async () => {}));
    const latest = Array.from({ length: 4 }, () => vi.fn(async () => {}));
    const { rerender } = renderHook(({ callbacks }) => useFileWatch(undefined, ...callbacks), {
      initialProps: { callbacks: first },
    });
    await waitFor(() => expect(first[3]).toHaveBeenCalledTimes(1));
    const stream = sockets()[0];
    expect(stream).toBeDefined();
    rerender({ callbacks: latest });
    expect(sockets()).toHaveLength(1);
    expect(stream?.close).not.toHaveBeenCalled();
    act(() => {
      for (const type of [
        'commentsChanged',
        'approvalChanged',
        'reviewSummaryChanged',
        'reviewCaptureChanged',
      ]) {
        stream?.dispatchMessage(JSON.stringify({ type, reviewName: 'task-b' }));
      }
    });
    for (const callback of latest) expect(callback).toHaveBeenCalledTimes(1);
    expect(latest[3]).toHaveBeenCalledWith('task-b');
  });

  it('reloads named captures on reconnect and forwards the changed review name', async () => {
    const onCaptureChanged = vi.fn(async (_reviewName?: string) => {});
    renderHook(() => useFileWatch(undefined, undefined, undefined, undefined, onCaptureChanged));
    await waitFor(() => expect(onCaptureChanged).toHaveBeenCalledExactlyOnceWith());
    act(() =>
      sockets()
        .at(-1)
        ?.dispatchMessage(JSON.stringify({ type: 'reviewCaptureChanged', reviewName: 'task-a' })),
    );
    expect(onCaptureChanged).toHaveBeenLastCalledWith('task-a');
  });

  it('refreshes the summary on reconnect and remote summary edits', async () => {
    const onSummaryChanged = vi.fn(async () => {});
    renderHook(() => useFileWatch(undefined, undefined, undefined, onSummaryChanged));
    await waitFor(() => expect(onSummaryChanged).toHaveBeenCalledTimes(1));
    act(() => {
      sockets()
        .at(-1)
        ?.dispatchMessage(JSON.stringify({ type: 'reviewSummaryChanged' }));
    });
    expect(onSummaryChanged).toHaveBeenCalledTimes(2);
  });
  it('refreshes approval after reconnecting and when another tab changes it', async () => {
    const onApprovalChanged = vi.fn(async () => {});
    renderHook(() => useFileWatch(undefined, undefined, onApprovalChanged));
    await waitFor(() => expect(onApprovalChanged).toHaveBeenCalledTimes(1));
    act(() => {
      sockets()
        .at(-1)
        ?.dispatchMessage(JSON.stringify({ type: 'approvalChanged' }));
    });
    expect(onApprovalChanged).toHaveBeenCalledTimes(2);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
    vi.unstubAllEnvs();
    MockWebSocket.instances = [];
  });

  describe('initial state', () => {
    it('should initialize with default state', () => {
      const { result } = renderHook(() => useFileWatch());

      expect(result.current.shouldReload).toBe(false);
      expect(result.current.isConnected).toBe(false);
      expect(result.current.error).toBe(null);
      expect(result.current.watchState).toEqual({
        isWatchEnabled: false,
        diffMode: DiffMode.DEFAULT,
        shouldReload: false,
        isReloading: false,
        lastChangeTime: null,
        lastChangeType: null,
        connectionStatus: 'disconnected',
      });
    });
  });

  describe('live connection', () => {
    it('opens the live connection on mount', () => {
      renderHook(() => useFileWatch());

      expect(new URL(sockets()[0]!.url).pathname).toBe('/api/live');
    });

    it('should establish connection on mount', async () => {
      const { result } = renderHook(() => useFileWatch());

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      });

      expect(result.current.watchState.connectionStatus).toBe('connected');
    });

    it('should handle connection events', async () => {
      const { result } = renderHook(() => useFileWatch());

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      });

      // Dispatch a connected event on the live connection
      const eventSource = sockets()[0]!;

      act(() => {
        eventSource.dispatchMessage(
          JSON.stringify({
            type: 'connected',
            diffMode: DiffMode.WORKING,
            changeType: 'file',
            timestamp: new Date().toISOString(),
            message: 'Connected to file watcher',
          }),
        );
      });

      await waitFor(() => {
        expect(result.current.watchState.isWatchEnabled).toBe(true);
        expect(result.current.watchState.diffMode).toBe(DiffMode.WORKING);
      });
    });

    it('should handle reload events', async () => {
      const { result } = renderHook(() => useFileWatch());

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      });

      const eventSource = sockets()[0]!;

      act(() => {
        eventSource.dispatchMessage(
          JSON.stringify({
            type: 'reload',
            diffMode: DiffMode.DOT,
            changeType: 'commit',
            timestamp: new Date().toISOString(),
          }),
        );
      });

      await waitFor(() => {
        expect(result.current.shouldReload).toBe(true);
        expect(result.current.watchState.shouldReload).toBe(true);
        expect(result.current.watchState.lastChangeType).toBe('commit');
      });
    });

    it('should handle error events', async () => {
      const { result } = renderHook(() => useFileWatch());

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      });

      const eventSource = sockets()[0]!;

      act(() => {
        eventSource.dispatchMessage(
          JSON.stringify({
            type: 'error',
            diffMode: DiffMode.DEFAULT,
            changeType: 'file',
            timestamp: new Date().toISOString(),
            message: 'Watch error occurred',
          }),
        );
      });

      await waitFor(() => {
        expect(result.current.error).toBe('Watch error occurred');
      });
    });
  });

  describe('reload functionality', () => {
    it('should call onReload callback when reload is triggered', async () => {
      const mockOnReload = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useFileWatch(mockOnReload));

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      });

      // Set shouldReload state first
      const eventSource = sockets()[0]!;
      act(() => {
        eventSource.dispatchMessage(
          JSON.stringify({
            type: 'reload',
            diffMode: DiffMode.DEFAULT,
            changeType: 'file',
            timestamp: new Date().toISOString(),
          }),
        );
      });

      await waitFor(() => {
        expect(result.current.shouldReload).toBe(true);
      });

      // Trigger reload
      act(() => {
        result.current.reload();
      });

      await waitFor(() => {
        expect(mockOnReload).toHaveBeenCalled();
        expect(result.current.watchState.isReloading).toBe(true);
      });

      // Wait for reload to complete
      await waitFor(() => {
        expect(result.current.watchState.isReloading).toBe(false);
        expect(result.current.shouldReload).toBe(false);
      });
    });

    it('should handle reload errors', async () => {
      const mockOnReload = vi.fn().mockRejectedValue(new Error('Reload failed'));
      const { result } = renderHook(() => useFileWatch(mockOnReload));

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      });

      // Set shouldReload state first
      const eventSource = sockets()[0]!;
      act(() => {
        eventSource.dispatchMessage(
          JSON.stringify({
            type: 'reload',
            diffMode: DiffMode.DEFAULT,
            changeType: 'file',
            timestamp: new Date().toISOString(),
          }),
        );
      });

      await waitFor(() => {
        expect(result.current.shouldReload).toBe(true);
      });

      // Trigger reload
      act(() => {
        result.current.reload();
      });

      await waitFor(() => {
        expect(result.current.error).toBe('Failed to reload diff data');
        expect(result.current.watchState.isReloading).toBe(false);
      });
    });

    it('should not reload if already reloading', async () => {
      const mockOnReload = vi
        .fn()
        .mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 100)));
      const { result } = renderHook(() => useFileWatch(mockOnReload));

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      });

      // Set shouldReload state first
      const eventSource = sockets()[0]!;
      act(() => {
        eventSource.dispatchMessage(
          JSON.stringify({
            type: 'reload',
            diffMode: DiffMode.DEFAULT,
            changeType: 'file',
            timestamp: new Date().toISOString(),
          }),
        );
      });

      await waitFor(() => {
        expect(result.current.shouldReload).toBe(true);
      });

      // Trigger first reload
      act(() => {
        result.current.reload();
      });

      await waitFor(() => {
        expect(result.current.watchState.isReloading).toBe(true);
      });

      // Try to trigger second reload while first is in progress
      act(() => {
        result.current.reload();
      });

      // Should only call onReload once
      expect(mockOnReload).toHaveBeenCalledTimes(1);
    });
  });

  describe('reconnection logic', () => {
    it('should set reconnecting status on connection error', async () => {
      const { result } = renderHook(() => useFileWatch());

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      });

      const eventSource = sockets()[0]!;

      // Simulate connection error
      act(() => {
        eventSource.dispatchError();
      });

      // Should show reconnecting status
      expect(result.current.watchState.connectionStatus).toBe('reconnecting');
    });

    it('reports a lost connection once reconnecting cannot help', async () => {
      const { result } = renderHook(() => useFileWatch());

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      });

      act(() => {
        sockets()[0]!.drop(LIVE_OTHER_SERVER);
      });

      expect(result.current.watchState.connectionStatus).toBe('disconnected');
      expect(result.current.error).toBe('Lost connection to file watch service');
    });
  });

  describe('cleanup', () => {
    it('should close connection on unmount', async () => {
      const { result, unmount } = renderHook(() => useFileWatch());

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      });

      const eventSource = sockets()[0]!;

      unmount();

      expect(eventSource.close).toHaveBeenCalled();
    });

    it('should clear timeouts on unmount', async () => {
      const { result, unmount } = renderHook(() => useFileWatch());

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      });

      const eventSource = sockets()[0]!;

      unmount();

      // Should close the connection
      expect(eventSource.close).toHaveBeenCalled();
    });
  });
});
