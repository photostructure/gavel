import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HotkeysProvider } from 'react-hotkeys-hook';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DiffFile } from '../types/diff';

import App from './App';
import { MockWebSocket } from './utils/liveConnection.testing';

const watch = vi.hoisted(() => ({ reload: undefined as (() => Promise<void>) | undefined }));
vi.mock('./hooks/useFileWatch', () => ({
  useFileWatch: (reload: () => Promise<void>) => {
    watch.reload = reload;
    return {
      shouldReload: false,
      isConnected: true,
      error: null,
      reload: vi.fn(),
      watchState: { isWatchEnabled: false },
    };
  },
}));

const addedFile = (path: string, word: string, count: number): DiffFile => ({
  path,
  status: 'added',
  additions: count,
  deletions: 0,
  chunks: [
    {
      header: `@@ -0,0 +1,${count} @@`,
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: count,
      lines: Array.from({ length: count }, (_, index) => ({
        type: 'add' as const,
        content: word,
        newLineNumber: index + 1,
      })),
    },
  ],
});

const mount = () =>
  render(
    <HotkeysProvider initiallyActiveScopes={['navigation']}>
      <App />
    </HotkeysProvider>,
  );

describe('large files', () => {
  let observer: MutationObserver | undefined;
  let files: DiffFile[];
  afterEach(() => {
    observer?.disconnect();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', '/?base=HEAD&target=.');
    vi.stubGlobal('WebSocket', MockWebSocket);
    // Every file is on screen, so lazy rendering draws each one, including files a reload adds.
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(readonly callback: IntersectionObserverCallback) {}
        observe(target: Element) {
          queueMicrotask(() =>
            this.callback(
              [{ isIntersecting: true, target } as IntersectionObserverEntry],
              this as unknown as IntersectionObserver,
            ),
          );
        }
        unobserve() {}
        disconnect() {}
      },
    );
    files = [
      addedFile('generated.ts', 'zzbigmarker', 1025),
      addedFile('small.ts', 'zzsmallmarker', 1),
    ];
    vi.mocked(fetch).mockImplementation((input) => {
      const url = new URL(String(input), window.location.origin);
      if (url.pathname === '/api/diff')
        return Promise.resolve(
          Response.json({
            commit: 'fixture',
            repositoryId: 'repo',
            baseCommitish: 'HEAD',
            targetCommitish: '.',
            requestedBaseCommitish: 'HEAD',
            requestedTargetCommitish: '.',
            files,
          }),
        );
      if (url.pathname === '/api/comments-json')
        return Promise.resolve(Response.json({ version: 1, cursor: 'test:1', threads: [] }));
      if (url.pathname === '/api/conversation/snapshot')
        return Promise.resolve(Response.json({ cursor: 'stream:0', reviews: [] }));
      if (url.pathname === '/api/review-summary')
        return Promise.resolve(Response.json({ commitMessage: '', rationale: '', version: 0 }));
      return Promise.resolve(new Response(null, { status: 404 }));
    });
  });

  // A file with tens of thousands of changed lines took seconds to render and made every later
  // update slow, so it waits for the reviewer to ask for it.
  it('starts a file over 1024 changed lines collapsed, without ever rendering its rows', async () => {
    let bigRowsRendered = false;
    observer = new MutationObserver(() => {
      if (document.body.textContent?.includes('zzbigmarker')) bigRowsRendered = true;
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    mount();

    await screen.findByText('zzsmallmarker');
    const loadDiff = await screen.findByRole('button', { name: 'Load diff' });
    expect(screen.getByText(/1,025 changed lines/)).toBeInTheDocument();
    expect(bigRowsRendered).toBe(false);

    fireEvent.click(loadDiff);

    await waitFor(() => expect(screen.getAllByText('zzbigmarker')).toHaveLength(1025));
    expect(screen.queryByRole('button', { name: 'Load diff' })).toBeNull();
  });

  // A generator can write a large file, or grow a small one, while a working-tree review is open.
  it('collapses files that become large on reload and keeps a loaded one open', async () => {
    files.push(addedFile('grows.ts', 'zzgrowmarker', 1));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Load diff' }));
    await waitFor(() => expect(screen.getAllByText('zzbigmarker')).toHaveLength(1025));
    await screen.findByText('zzgrowmarker');

    files = [
      addedFile('generated.ts', 'zzbigmarker', 1025),
      addedFile('grows.ts', 'zzgrowmarker', 1025),
      addedFile('new.ts', 'zznewmarker', 1025),
      addedFile('small.ts', 'zzsmallmarker', 1),
    ];
    await act(async () => {
      await watch.reload?.();
    });

    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Load diff' })).toHaveLength(2),
    );
    expect(screen.queryByText('zzgrowmarker')).toBeNull();
    expect(screen.queryByText('zznewmarker')).toBeNull();
    expect(screen.getAllByText('zzbigmarker')).toHaveLength(1025);
  });

  it('keeps a Load diff click made before viewed files finish loading', async () => {
    // Viewed files load only after every file's diff is hashed; hold the hashes back.
    const pending: Array<() => void> = [];
    vi.spyOn(crypto.subtle, 'digest').mockImplementation(
      () => new Promise((resolve) => pending.push(() => resolve(new ArrayBuffer(32)))),
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Load diff' }));
    await waitFor(() => expect(screen.getAllByText('zzbigmarker')).toHaveLength(1025));
    expect(pending.length).toBeGreaterThan(0);

    // Two macrotask turns let the released hashes settle and the viewed files load.
    await act(async () => {
      for (const release of pending.splice(0)) release();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.queryByRole('button', { name: 'Load diff' })).toBeNull();
    expect(screen.getAllByText('zzbigmarker')).toHaveLength(1025);
  });
});
