import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HotkeysProvider } from 'react-hotkeys-hook';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DiffCommentThread, DiffResponse } from '../types/diff';
import App from './App';
import { MockWebSocket } from './utils/liveConnection.testing';

vi.mock('./hooks/useFileWatch', () => ({
  useFileWatch: () => ({
    shouldReload: false,
    isConnected: true,
    error: null,
    reload: vi.fn(),
    watchState: { isWatchEnabled: false },
  }),
}));

const thread = (id: string, body: string): DiffCommentThread => ({
  id,
  scope: 'review',
  createdAt: '2026-10-29T00:00:00Z',
  updatedAt: '2026-10-29T00:00:00Z',
  messages: [
    {
      id,
      body,
      author: 'Agent',
      createdAt: '2026-10-29T00:00:00Z',
      updatedAt: '2026-10-29T00:00:00Z',
    },
  ],
});

describe('review conversation navigation with browser storage', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', '/');
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  it('retains an agent reply when returning before the next review finishes loading', async () => {
    let serverThreads = [thread('original', 'Original review comment')];
    let version = 1;
    let loadingOtherReview = false;
    vi.mocked(fetch).mockImplementation((input, init) => {
      const url = new URL(String(input), window.location.origin);
      const target = url.searchParams.get('target');
      let payload: unknown = {};
      if (url.pathname === '/api/diff') {
        const other = target === 'HEAD' || target === 'other-tip';
        payload = {
          commit: other ? 'other' : 'working',
          baseCommitish: other ? 'other-base' : 'base',
          targetCommitish: other ? 'other-tip' : '.',
          requestedBaseCommitish: other ? 'HEAD^' : 'HEAD',
          requestedTargetCommitish: other ? 'HEAD' : '.',
          files: [],
          ignoreWhitespace: false,
          isEmpty: true,
        } satisfies DiffResponse;
      } else if (url.pathname === '/api/revisions') {
        payload = { specialOptions: [], branches: [], commits: [] };
      } else if (url.pathname === '/api/comments-json') {
        if (target === 'other-tip') {
          loadingOtherReview = true;
          return new Promise<Response>(() => {});
        }
        payload = { version, threads: structuredClone(serverThreads) };
      } else if (url.pathname === '/api/comments' && init?.method === 'POST' && target === '.') {
        const body = JSON.parse(String(init.body)) as {
          threads: DiffCommentThread[];
          baseVersion?: number;
        };
        // Match /api/comments: an omitted baseVersion allows replacement;
        // a stale version requires merging with newer server comments.
        const stale = body.baseVersion !== undefined && body.baseVersion !== version;
        if (!stale) serverThreads = structuredClone(body.threads);
        payload = { version: ++version, merged: stale, threads: structuredClone(serverThreads) };
      }
      return Promise.resolve({ ok: true, json: async () => payload } as Response);
    });
    render(
      <HotkeysProvider initiallyActiveScopes={['navigation']}>
        <App />
      </HotkeysProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Conversation' }));
    await screen.findByText('Original review comment');
    fireEvent.click(screen.getByRole('button', { name: 'Close conversation' }));
    fireEvent.click(screen.getByRole('button', { name: /Revision menu:/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'HEAD' }));
    await waitFor(() => expect(loadingOtherReview).toBe(true));
    serverThreads.push(thread('concurrent', 'Agent replied while this review was away'));
    version += 1;
    await act(async () => window.history.back());
    fireEvent.click(await screen.findByRole('button', { name: 'Conversation' }));
    expect(await screen.findByText('Agent replied while this review was away')).toBeVisible();
    expect(serverThreads.map((entry) => entry.id)).toContain('concurrent');
  });
});
