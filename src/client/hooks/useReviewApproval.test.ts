import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ReviewApproval } from '../../types/conversation';

import { useReviewApproval } from './useReviewApproval';

const response = (approval: ReviewApproval = {}) => new Response(JSON.stringify(approval));

afterEach(() => vi.unstubAllGlobals());

describe('review approval', () => {
  it('sets a verdict with PUT and clears it with DELETE on the approval URL', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => response());
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() =>
      useReviewApproval('http://10.1.1.24:4966/api/approval?review=task'),
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => result.current.setVerdict('after-comments', 0));
    expect(fetchMock).toHaveBeenCalledWith(
      'http://10.1.1.24:4966/api/approval?review=task',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ verdict: 'after-comments', summaryVersion: 0 }),
      }),
    );
    await act(async () => result.current.clearVerdict());
    expect(fetchMock).toHaveBeenCalledWith('http://10.1.1.24:4966/api/approval?review=task', {
      method: 'DELETE',
    });
  });

  it('sends the digest of the displayed index or worktree diff with a verdict', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() =>
      useReviewApproval('/api/approval?target=staged', undefined, 1, 'digest-shown'),
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => result.current.setVerdict('as-is', 1));
    await act(async () => result.current.setVerdict('reject', 1));
    const puts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT');
    expect(puts.map(([, init]) => JSON.parse(String(init?.body)) as unknown)).toEqual([
      { verdict: 'as-is', summaryVersion: 1, diffDigest: 'digest-shown' },
      // Reject does not endorse the proposed message.
      { verdict: 'reject', diffDigest: 'digest-shown' },
    ]);
  });

  // A reviewer's unsaved draft keeps showing the older capture and summary; only they end these
  // verdicts.
  it.each(['after-comments', 'reject'] as const)(
    'keeps showing %s on an older capture or summary',
    async (verdict) => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(
            response({ verdict, captureVersion: 2, patchDigest: 'new', summaryVersion: 2 }),
          ),
      );
      const { result } = renderHook(() =>
        useReviewApproval('/api/approval?review=a', { version: 1, patchDigest: 'old' }, 1),
      );
      await waitFor(() => expect(result.current.verdict).toBe(verdict));
    },
  );

  it('restores server approval and preserves it when clearing fails', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({ verdict: 'as-is' }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useReviewApproval('/api/approval?target=a'));
    await waitFor(() => expect(result.current.verdict).toBe('as-is'));
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));
    await act(async () => {
      await expect(result.current.clearVerdict()).rejects.toThrow('Could not update approval');
    });
    expect(result.current.verdict).toBe('as-is');
  });

  it('does not apply a late approval response to a different selection', async () => {
    let finishApproval: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (init?.method === 'PUT')
        return new Promise((resolve) => {
          finishApproval = resolve;
        });
      return response(String(url).endsWith('b') ? { verdict: 'as-is' } : {});
    });
    vi.stubGlobal('fetch', fetchMock);
    const { result, rerender } = renderHook(({ url }) => useReviewApproval(url), {
      initialProps: { url: '/api/approval?target=a' },
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    let pending: Promise<void>;
    act(() => {
      pending = result.current.setVerdict('as-is');
    });
    rerender({ url: '/api/approval?target=b' });
    await waitFor(() => expect(result.current.verdict).toBe('as-is'));
    await act(async () => {
      finishApproval?.(response({ verdict: 'as-is' }));
      await pending;
    });
    expect(result.current.ready).toBe(true);
    expect(result.current.verdict).toBe('as-is');
    expect(
      fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith('a') && !init?.method),
    ).toHaveLength(1);
  });

  it('disables verdicts when the server has no approval endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 404 })),
    );
    const { result } = renderHook(() => useReviewApproval('/api/approval'));
    await waitFor(() => expect(result.current.error).toContain('Could not load approval'));
    expect(result.current.ready).toBe(false);
    expect(result.current.verdict).toBeUndefined();
  });
});

describe('named capture approval', () => {
  const first = { version: 1, patchDigest: 'first-digest' };
  const second = { version: 2, patchDigest: 'second-digest' };
  const namedResponse = (capture = first, summaryVersion = 3) =>
    response({
      verdict: 'as-is',
      captureVersion: capture.version,
      patchDigest: capture.patchDigest,
      summaryVersion,
    });

  it('sends the displayed capture and summary identities with a verdict', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => namedResponse());
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useReviewApproval('/api/approval?review=task', first, 3));
    await waitFor(() => expect(result.current.verdict).toBe('as-is'));
    await act(async () => result.current.setVerdict('as-is', 3));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/approval?review=task',
      expect.objectContaining({
        body: JSON.stringify({
          verdict: 'as-is',
          summaryVersion: 3,
          captureVersion: 1,
          patchDigest: 'first-digest',
        }),
      }),
    );
    await act(async () => result.current.setVerdict('reject', 3));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/approval?review=task',
      expect.objectContaining({
        body: JSON.stringify({ verdict: 'reject', captureVersion: 1, patchDigest: 'first-digest' }),
      }),
    );
  });

  it('clears approval immediately when the same named URL displays another capture', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => namedResponse());
    vi.stubGlobal('fetch', fetchMock);
    const { result, rerender } = renderHook(
      ({ capture }) => useReviewApproval('/api/approval?review=task', capture, 3),
      { initialProps: { capture: first } },
    );
    await waitFor(() => expect(result.current.verdict).toBe('as-is'));
    const staleApprove = result.current.setVerdict;
    rerender({ capture: second });
    expect(result.current.verdict).toBeUndefined();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.verdict).toBeUndefined();
    await expect(staleApprove('as-is', 3)).rejects.toThrow(
      'Approval is unavailable for this capture',
    );
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  });

  it('does not restore an earlier capture after its in-flight request finishes', async () => {
    let finish: ((response: Response) => void) | undefined;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        async () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      )
      .mockImplementation(async () => response());
    vi.stubGlobal('fetch', fetchMock);
    const { result, rerender } = renderHook(
      ({ capture }) => useReviewApproval('/api/approval?review=task', capture, 3),
      { initialProps: { capture: first } },
    );
    rerender({ capture: second });
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => finish?.(namedResponse()));
    expect(result.current.verdict).toBeUndefined();
    expect(result.current.ready).toBe(true);
  });

  it('requires an as-is approval to match the displayed proposal version', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(async () => namedResponse(first, 2)),
    );
    const { result } = renderHook(() => useReviewApproval('/api/approval?review=task', first, 3));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.verdict).toBeUndefined();
  });
});
