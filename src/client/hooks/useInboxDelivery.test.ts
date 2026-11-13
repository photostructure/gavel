import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { InboxDelivery } from '../../types/presence';

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
    expect(result.current.delivery).toEqual({
      status: 'sent',
      at: 'y',
      via: 'inbox',
      receivedAt: expect.any(Number),
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/inbox', { cache: 'no-store' });
  });

  it.each([
    [
      { status: 'sent', at: 'x', via: 'queue' },
      { status: 'queued', at: 'x', transport: 'queue' },
    ],
    [
      { status: 'sent', at: 'x', via: 'queue-unknown' },
      {
        status: 'uncertain',
        at: 'x',
        transport: 'queue',
        error: 'Codex did not confirm queueing the feedback',
      },
    ],
  ])('normalizes an earlier running server queue receipt: %j', async (delivery, expected) => {
    // Pinned from a live detached source-build server still returning the earlier queue shape.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ reviews: [{ id: 'r1', selection, delivery }] })),
    );
    const { result } = renderHook(() => useInboxDelivery(selection));
    await waitFor(() => expect(result.current.delivery).toEqual(expected));
  });

  // R276-C/R725-D: server timestamps cannot measure a phone's receipt age.
  // The live API is sent/queued + server at; fake offsets prove only the local
  // observation time can drive a confirmation without replay on review switches.
  it.each(['sent', 'queued'] as const)(
    'timestamps new %s receipts locally and retains them across review switches',
    async (status) => {
      const receipt = (at: string): InboxDelivery =>
        status === 'sent' ? { status, at, via: 'inbox' } : { status, at, transport: 'queue' };
      let delivery: InboxDelivery = receipt('2099-01-01T00:00:00Z');
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(() =>
          Promise.resolve(
            Response.json({
              reviews: [
                { id: 'r1', selection, delivery },
                { id: 'r2', selection: other, delivery: { status: 'ready' } },
              ],
            }),
          ),
        ),
      );
      const { result, rerender, unmount } = renderHook(({ active }) => useInboxDelivery(active), {
        initialProps: { active: selection },
      });
      await waitFor(() => expect(result.current.delivery).toEqual(delivery));
      // Initial snapshots, even with future timestamps, are history rather than new receipts.
      expect(result.current.delivery).not.toHaveProperty('receivedAt');
      delivery = receipt('2000-01-01T00:00:00Z');
      const before = Date.now();
      await act(() => result.current.refresh());
      expect(result.current.delivery).toMatchObject({ receivedAt: expect.any(Number) });
      const receivedAt = result.current.delivery?.receivedAt;
      expect(receivedAt).toBeGreaterThanOrEqual(before);
      expect(receivedAt).toBeLessThanOrEqual(Date.now());
      rerender({ active: other });
      await act(() => result.current.refresh());
      rerender({ active: selection });
      expect(result.current.delivery?.receivedAt).toBe(receivedAt);
      delivery = { status: 'pending' };
      await act(() => result.current.refresh());
      expect(result.current.delivery).not.toHaveProperty('receivedAt');
      delivery = receipt('2000-01-01T00:00:01Z');
      await act(() => result.current.refresh());
      expect(result.current.delivery).toHaveProperty('receivedAt');
      unmount();
      const reloaded = renderHook(() => useInboxDelivery(selection));
      await waitFor(() => expect(reloaded.result.current.delivery).toEqual(delivery));
      expect(reloaded.result.current.delivery).not.toHaveProperty('receivedAt');
    },
  );

  // R276-D/R725-E: SessionInbox.withdraw restores review.delivered unchanged
  // when a comment is deleted before sending (session-inbox.ts delivery/withdraw).
  it.each(['sent', 'queued'] as const)(
    'does not reconfirm an old %s receipt after withdrawing a comment',
    async (status) => {
      const receipt = (at: string): InboxDelivery =>
        status === 'sent' ? { status, at, via: 'inbox' } : { status, at, transport: 'queue' };
      let delivery: InboxDelivery = receipt('2000-01-01T00:00:00Z');
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockImplementation(() =>
            Promise.resolve(Response.json({ reviews: [{ id: 'r1', selection, delivery }] })),
          ),
      );
      const { result } = renderHook(() => useInboxDelivery(selection));
      await waitFor(() => expect(result.current.delivery).toEqual(delivery));
      delivery = { status: 'pending' };
      await act(() => result.current.refresh());
      delivery = receipt('2000-01-01T00:00:00Z');
      await act(() => result.current.refresh());
      expect(result.current.delivery).not.toHaveProperty('receivedAt');
      delivery = receipt('2000-01-01T00:00:01Z');
      await act(() => result.current.refresh());
      const receivedAt = result.current.delivery?.receivedAt;
      expect(receivedAt).toEqual(expect.any(Number));
      for (const intermediate of [
        { status: 'pending' },
        { status: 'failed', at: 'x', error: 'offline' },
      ] satisfies InboxDelivery[]) {
        delivery = intermediate;
        await act(() => result.current.refresh());
        delivery = receipt('2000-01-01T00:00:01Z');
        await act(() => result.current.refresh());
        expect(result.current.delivery?.receivedAt).toBe(receivedAt);
      }
    },
  );

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
