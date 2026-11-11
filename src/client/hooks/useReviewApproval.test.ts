import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ReviewApproval } from '../../types/conversation';

import { useReviewApproval } from './useReviewApproval';

const response = (approval: ReviewApproval = {}) => new Response(JSON.stringify(approval));

afterEach(() => vi.unstubAllGlobals());

describe('review approval', () => {
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

  it('clears approval immediately when the same named URL displays another capture', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => namedResponse());
    vi.stubGlobal('fetch', fetchMock);
    const { result, rerender } = renderHook(
      ({ capture }) => useReviewApproval('/api/approval?review=task', capture, 3),
      { initialProps: { capture: first } },
    );
    await waitFor(() => expect(result.current.verdict).toBe('as-is'));
    rerender({ capture: second });
    expect(result.current.verdict).toBeUndefined();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.verdict).toBeUndefined();
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
