import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useReviewPresence } from './useReviewPresence';

class Stream {
  static instances: Stream[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  close = vi.fn();
  constructor(readonly url: string) {
    Stream.instances.push(this);
  }
}

describe('browser presence connection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    Stream.instances = [];
  });

  it('receives listener state and reports visibility without opening another stream', async () => {
    vi.stubEnv('VITE_GAVEL_API_URL', 'http://localhost:4966');
    vi.stubGlobal('EventSource', Stream);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    const { result, unmount } = renderHook(() => useReviewPresence());
    const stream = Stream.instances[0]!;
    const presence = { reviewers: { connected: 1, visible: 1 }, listeners: 1 };
    act(() =>
      stream.onmessage?.(
        new MessageEvent('message', { data: JSON.stringify({ type: 'presence', presence }) }),
      ),
    );
    expect(result.current).toEqual(presence);
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(Stream.instances).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/presence',
      expect.objectContaining({ method: 'POST', keepalive: true }),
    );
    act(() => stream.onerror?.());
    expect(result.current).toBeNull();
    expect(stream.close).toHaveBeenCalledOnce();
    fetchMock.mockClear();
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(fetchMock).not.toHaveBeenCalled();
    unmount();
    expect(stream.close).toHaveBeenCalled();
  });
});
