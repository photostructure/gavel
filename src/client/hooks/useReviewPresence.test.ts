import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MockWebSocket } from '../utils/liveConnection.testing';

import { useReviewPresence } from './useReviewPresence';

describe('browser presence connection', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows presence from the live connection and clears it when the connection drops', () => {
    const { result, unmount } = renderHook(() => useReviewPresence());
    const live = MockWebSocket.latest();
    act(() => live.open());
    const presence = { reviewers: { connected: 1, visible: 1 }, listeners: 1 };
    act(() => live.receive({ channel: 'presence', presence }));
    expect(result.current).toEqual(presence);
    act(() => live.drop());
    expect(result.current).toBeNull();
    unmount();
    expect(MockWebSocket.instances).toHaveLength(1);
  });
});
