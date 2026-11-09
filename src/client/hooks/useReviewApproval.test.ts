import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useReviewApproval } from './useReviewApproval';

const response = (approved: boolean) => new Response(JSON.stringify({ approved }));

afterEach(() => vi.unstubAllGlobals());

describe('review approval', () => {
  it('uses the distinct conditional endpoint so an old server cannot silently approve as-is', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, init) =>
        init?.method === 'POST' ? new Response('{}', { status: 404 }) : response(false),
      );
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() =>
      useReviewApproval('http://10.1.1.24:4966/api/approval?review=task'),
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await expect(result.current.setApproved(true, 0, 'after-comments')).rejects.toThrow(
        'Could not update approval',
      );
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://10.1.1.24:4966/api/approval/conditional?review=task',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result.current.requested).toBe(false);
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).endsWith('/api/approval?review=task') && init?.method === 'POST',
      ),
    ).toHaveLength(0);
  });
  it('sends the digest of the displayed index or worktree diff with an approval', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response(false));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() =>
      useReviewApproval('/api/approval?target=staged', undefined, 1, 'digest-shown'),
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.setApproved(true, 1);
    });
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      approved: true,
      summaryVersion: 1,
      diffDigest: 'digest-shown',
    });
  });

  it('restores server approval and preserves it when revocation fails', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response(true));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useReviewApproval('/api/approval?target=a'));
    await waitFor(() => expect(result.current.requested).toBe(true));
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));
    await act(async () => {
      await expect(result.current.setApproved(false)).rejects.toThrow('Could not update approval');
    });
    expect(result.current.requested).toBe(true);
  });

  it('does not apply a late approval response to a different selection', async () => {
    let finishApproval: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (init?.method === 'POST')
        return new Promise((resolve) => {
          finishApproval = resolve;
        });
      return response(String(url).endsWith('b'));
    });
    vi.stubGlobal('fetch', fetchMock);
    const { result, rerender } = renderHook(({ url }) => useReviewApproval(url), {
      initialProps: { url: '/api/approval?target=a' },
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    let pending: Promise<void>;
    act(() => {
      pending = result.current.setApproved(true);
    });
    rerender({ url: '/api/approval?target=b' });
    await waitFor(() => expect(result.current.requested).toBe(true));
    await act(async () => {
      finishApproval?.(response(true));
      await pending;
    });
    expect(result.current.ready).toBe(true);
    expect(result.current.requested).toBe(true);
    expect(
      fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith('a') && !init?.method),
    ).toHaveLength(1);
  });

  it('disables approval when an older server lacks the reversible endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 404 })),
    );
    const { result } = renderHook(() => useReviewApproval('/api/approval'));
    await waitFor(() => expect(result.current.error).toContain('Could not load approval'));
    expect(result.current.ready).toBe(false);
    expect(result.current.requested).toBe(false);
  });
});

describe('named capture approval', () => {
  const first = { version: 1, patchDigest: 'first-digest' };
  const second = { version: 2, patchDigest: 'second-digest' };
  const namedResponse = (capture = first, summaryVersion = 3) =>
    new Response(
      JSON.stringify({
        approved: true,
        captureVersion: capture.version,
        patchDigest: capture.patchDigest,
        summaryVersion,
      }),
    );

  it('sends the displayed capture and summary identities for approval and revocation', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => namedResponse());
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useReviewApproval('/api/approval?review=task', first, 3));
    await waitFor(() => expect(result.current.requested).toBe(true));
    await act(async () => result.current.setApproved(false, 3));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/approval?review=task',
      expect.objectContaining({
        body: JSON.stringify({
          approved: false,
          summaryVersion: 3,
          captureVersion: 1,
          patchDigest: 'first-digest',
        }),
      }),
    );
    await act(async () => result.current.setApproved(true, 3));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/approval?review=task',
      expect.objectContaining({
        body: JSON.stringify({
          approved: true,
          summaryVersion: 3,
          captureVersion: 1,
          patchDigest: 'first-digest',
        }),
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
    await waitFor(() => expect(result.current.requested).toBe(true));
    const staleApprove = result.current.setApproved;
    rerender({ capture: second });
    expect(result.current.requested).toBe(false);
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.requested).toBe(false);
    await expect(staleApprove(true, 3)).rejects.toThrow('Approval is unavailable for this capture');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
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
      .mockImplementation(async () => new Response(JSON.stringify({ approved: false })));
    vi.stubGlobal('fetch', fetchMock);
    const { result, rerender } = renderHook(
      ({ capture }) => useReviewApproval('/api/approval?review=task', capture, 3),
      { initialProps: { capture: first } },
    );
    rerender({ capture: second });
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => finish?.(namedResponse()));
    expect(result.current.requested).toBe(false);
    expect(result.current.ready).toBe(true);
  });

  it('requires the approval to match the displayed proposal version', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(async () => namedResponse(first, 2)),
    );
    const { result } = renderHook(() => useReviewApproval('/api/approval?review=task', first, 3));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.requested).toBe(false);
  });
});

describe('not yet', () => {
  const capture = { version: 1, patchDigest: 'first-digest' };
  const verdict = (captureVersion: number) =>
    new Response(
      JSON.stringify({
        approved: false,
        notYet: true,
        captureVersion,
        patchDigest: 'first-digest',
        summaryVersion: 3,
      }),
    );

  it('posts to its own endpoint with the displayed capture, so an old server cannot revoke instead', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => verdict(1));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useReviewApproval('/api/approval?review=task', capture, 3));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => result.current.setNotYet());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/approval/not-yet?review=task',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ approved: false, captureVersion: 1, patchDigest: 'first-digest' }),
      }),
    );
    expect(result.current.notYet).toBe(true);
    expect(result.current.requested).toBe(false);
  });

  it('sends the digest of the displayed index or worktree diff', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response(false));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() =>
      useReviewApproval('http://10.1.1.24:4966/api/approval?target=staged', undefined, 1, 'shown'),
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => result.current.setNotYet());
    expect(fetchMock).toHaveBeenCalledWith(
      'http://10.1.1.24:4966/api/approval/not-yet?target=staged',
      expect.objectContaining({
        body: JSON.stringify({ approved: false, diffDigest: 'shown' }),
      }),
    );
  });

  it('ignores a not yet recorded for another capture', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(async () => verdict(2)),
    );
    const { result } = renderHook(() => useReviewApproval('/api/approval?review=task', capture, 3));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.notYet).toBe(false);
  });
});
