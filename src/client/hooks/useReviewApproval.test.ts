import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ReviewApproval } from '../../types/conversation';

import { useReviewApproval } from './useReviewApproval';

const response = (approval: ReviewApproval = {}) => new Response(JSON.stringify(approval));

afterEach(() => vi.unstubAllGlobals());

describe('review approval', () => {
  // The agent revises the review under Approve, and only the reviewer ends a Reject, so neither
  // depends on the capture or summary the page shows.
  it.each(['approve', 'reject'] as const)(
    'shows %s whatever capture or summary it names',
    async (verdict) => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(
            response({ verdict, captureVersion: 2, patchDigest: 'new', summaryVersion: 2 }),
          ),
      );
      const { result } = renderHook(() => useReviewApproval('/api/approval?review=a'));
      await waitFor(() => expect(result.current.verdict).toBe(verdict));
    },
  );

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

describe('approval of another review', () => {
  const approved = () => response({ verdict: 'approve' });

  it("hides the verdict until the other review's approval loads", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(async () => approved()),
    );
    const { result, rerender } = renderHook(({ url }) => useReviewApproval(url), {
      initialProps: { url: '/api/approval?review=task' },
    });
    await waitFor(() => expect(result.current.verdict).toBe('approve'));
    rerender({ url: '/api/approval?review=other' });
    expect(result.current.verdict).toBeUndefined();
    expect(result.current.ready).toBe(false);
    await waitFor(() => expect(result.current.verdict).toBe('approve'));
  });

  it("does not show an earlier review's answer after its in-flight request finishes", async () => {
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
    const { result, rerender } = renderHook(({ url }) => useReviewApproval(url), {
      initialProps: { url: '/api/approval?review=task' },
    });
    rerender({ url: '/api/approval?review=other' });
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => finish?.(approved()));
    expect(result.current.verdict).toBeUndefined();
    expect(result.current.ready).toBe(true);
  });
});
