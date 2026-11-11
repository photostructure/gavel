import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ReviewSummary } from '../../types/conversation';

import { useReviewSummary } from './useReviewSummary';

const initial: ReviewSummary = {
  commitMessage: 'feat: show review context',
  rationale: 'Reviewers need to know what this change solves.',
  version: 1,
};
const response = (summary: ReviewSummary) => new Response(JSON.stringify(summary));
afterEach(() => vi.unstubAllGlobals());

describe('useReviewSummary', () => {
  it('loads the summary and only ever reads it', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response(initial));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useReviewSummary('/api/review-summary?target=a'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current).toMatchObject({
      commitMessage: initial.commitMessage,
      rationale: initial.rationale,
      version: 1,
      error: null,
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/review-summary?target=a', { cache: 'no-store' });
    expect(result.current).not.toHaveProperty('save');
  });

  it('shows an agent update on refresh', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response(initial));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useReviewSummary('/api/review-summary?target=a'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    fetchMock.mockResolvedValue(
      response({ ...initial, commitMessage: 'feat: updated by agent', version: 2 }),
    );
    await act(async () => result.current.refresh());
    expect(result.current.commitMessage).toBe('feat: updated by agent');
    expect(result.current.version).toBe(2);
  });

  it('ignores a refresh that returns a lower version', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ ...initial, commitMessage: 'feat: newer', version: 2 }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useReviewSummary('/api/review-summary?target=a'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    fetchMock.mockResolvedValue(response(initial));
    await act(async () => result.current.refresh());
    expect(result.current.commitMessage).toBe('feat: newer');
    expect(result.current.version).toBe(2);
  });

  it('does not show one selection’s summary under another', async () => {
    const other = { ...initial, commitMessage: 'fix: another review', version: 0 };
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockImplementation(async (url) => response(String(url).endsWith('b') ? other : initial)),
    );
    const { result, rerender } = renderHook(({ url }) => useReviewSummary(url), {
      initialProps: { url: '/api/review-summary?target=a' },
    });
    await waitFor(() => expect(result.current.commitMessage).toBe(initial.commitMessage));
    rerender({ url: '/api/review-summary?target=b' });
    expect(result.current.ready).toBe(false);
    await waitFor(() => expect(result.current.commitMessage).toBe(other.commitMessage));
    expect(result.current.version).toBe(0);
  });

  it('reports a failed load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 500 })),
    );
    const { result } = renderHook(() => useReviewSummary('/api/review-summary?target=a'));
    await waitFor(() =>
      expect(result.current.error).toBe('Could not load the change summary. Try again.'),
    );
    expect(result.current.ready).toBe(false);
  });
});
