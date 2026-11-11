import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useInboxDelivery } from './useInboxDelivery';

const selection = { baseCommitish: 'HEAD', targetCommitish: 'capture', reviewName: 'one' };
const other = { baseCommitish: 'HEAD', targetCommitish: 'capture', reviewName: 'two' };

afterEach(() => vi.unstubAllGlobals());

describe('inbox delivery', () => {
  it("reports the open review's delivery and refreshes it on demand", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          reviews: [
            { id: 'r2', selection: other, delivery: { status: 'failed', at: 'x', error: 'e' } },
            { id: 'r1', selection, delivery: { status: 'pending' } },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          reviews: [{ id: 'r1', selection, delivery: { status: 'sent', at: 'y', via: 'inbox' } }],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useInboxDelivery(selection));
    await waitFor(() => expect(result.current.delivery).toEqual({ status: 'pending' }));
    await act(() => result.current.refresh());
    expect(result.current.delivery).toEqual({ status: 'sent', at: 'y', via: 'inbox' });
    expect(fetchMock).toHaveBeenCalledWith('/api/inbox', { cache: 'no-store' });
  });

  it('ignores a response from a server that predates the inbox', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('<!doctype html>', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useInboxDelivery(selection));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current.delivery).toBeUndefined();
  });

  it('reports nothing when the server has no inbox endpoint', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useInboxDelivery(selection));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current.delivery).toBeUndefined();
  });
});
