import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HotkeysProvider } from 'react-hotkeys-hook';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DiffCommentThread, DiffResponse } from '../types/diff';
import type { NamedReviewMetadata } from '../types/review';

import App from './App';
import { MockWebSocket } from './utils/liveConnection.testing';

// Records each element the app scrolls into view and how, then scrolls as usual.
const scrolled = vi.hoisted(() => [] as string[]);
const behaviors = vi.hoisted(() => [] as (ScrollBehavior | undefined)[]);
vi.mock('./hooks/keyboardNavigation/scrollUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./hooks/keyboardNavigation/scrollUtils')>();
  return {
    ...actual,
    createScrollToElement: () => {
      const scroll = actual.createScrollToElement();
      return (elementId: string, behavior?: ScrollBehavior) => {
        scrolled.push(elementId);
        behaviors.push(behavior);
        scroll(elementId, behavior);
      };
    },
  };
});

vi.mock('./hooks/useFileWatch', () => ({
  useFileWatch: (onReload?: () => Promise<void>) => ({
    shouldReload: false,
    isConnected: true,
    error: null,
    reload: onReload,
    watchState: { isWatchEnabled: false, isReloading: false, lastChangeType: null },
  }),
}));

const capture = (name: string): NamedReviewMetadata => ({
  name,
  version: 1,
  patchDigest: 'a'.repeat(64),
  baseCommit: 'base-one',
  repositoryId: 'repository-one',
});

const thread = (
  id: string,
  side: 'old' | 'new',
  body: string,
  reviewName = 'task-a',
): DiffCommentThread => ({
  id,
  filePath: 'file.md',
  position: { side, line: 2 },
  capture: { version: 1, patchDigest: capture(reviewName).patchDigest },
  createdAt: '2026-11-10T00:00:00Z',
  updatedAt: '2026-11-10T00:00:00Z',
  messages: [
    {
      id,
      body,
      author: 'Agent',
      origin: 'agent',
      createdAt: '2026-11-10T00:00:00Z',
      updatedAt: '2026-11-10T00:00:00Z',
    },
  ],
});

const tourStart = thread(
  'tour-1',
  'new',
  [
    'Start here.',
    '[next](#thread=tour-2)',
    '[gone](#thread=nope)',
    '[far](#file=file.md&line=40)',
    '[other review](?review=task-b#file=file.md&line=2)',
  ].join(' '),
);
const tourNext = thread('tour-2', 'old', 'The old line. [back to start](#thread=tour-1)');

// A Git comparison (`?base=HEAD&target=.`) when `git` is set, else named reviews.
function fixture({ git = false } = {}) {
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = new URL(String(input), window.location.origin);
    const reviewName = url.searchParams.get('review') ?? 'task-a';
    let payload: unknown = {};
    if (url.pathname === '/api/diff') {
      payload = {
        ...(git ? {} : { capture: capture(reviewName) }),
        repositoryId: 'repository-one',
        commit: `Review: ${reviewName}`,
        baseCommitish: git ? 'abc123' : 'base-one',
        targetCommitish: '.',
        requestedBaseCommitish: git ? (url.searchParams.get('base') ?? 'HEAD') : 'base-one',
        requestedTargetCommitish: '.',
        files: [
          {
            path: 'file.md',
            status: 'modified',
            additions: 1,
            deletions: 1,
            chunks: [
              {
                header: '@@ -2 +2 @@',
                oldStart: 2,
                oldLines: 1,
                newStart: 2,
                newLines: 1,
                lines: [
                  { type: 'delete', content: `old ${reviewName}`, oldLineNumber: 2 },
                  { type: 'add', content: `new ${reviewName}`, newLineNumber: 2 },
                ],
              },
            ],
          },
        ],
      } satisfies DiffResponse;
    } else if (url.pathname === '/api/revisions') {
      payload = { specialOptions: [], branches: [], commits: [] };
    } else if (url.pathname === '/api/comments-json') {
      const tour = git
        ? [tourStart, tourNext].map(({ capture: _capture, ...rest }) => rest)
        : [tourStart, tourNext];
      payload = { version: 1, cursor: 'test:1', threads: reviewName === 'task-a' ? tour : [] };
    } else if (url.pathname === '/api/review-summary') {
      payload = {
        version: 1,
        commitMessage: '',
        rationale: 'Start the tour at [tour 2](#thread=tour-2).',
      };
    } else if (url.pathname === '/api/approval') {
      payload = { captureVersion: 1, patchDigest: capture(reviewName).patchDigest };
    } else if (url.pathname === '/api/conversation/snapshot') {
      payload = {
        cursor: 'stream:1',
        reviews: ['task-a', 'task-b'].map((name) => ({
          id: `review-${name}`,
          selection: { baseCommitish: 'base-one', targetCommitish: '.', reviewName: name },
          threads: [],
          summary: { commitMessage: '', rationale: '', version: 1 },
          approval: {},
          capture: capture(name),
        })),
      };
    }
    return new Response(JSON.stringify(payload));
  });
}

const renderApp = () =>
  render(
    <HotkeysProvider initiallyActiveScopes={['navigation']}>
      <App />
    </HotkeysProvider>,
  );

const diffRequests = () =>
  vi
    .mocked(fetch)
    .mock.calls.map(([input]) => String(input))
    .filter((url) => url.startsWith('/api/diff?'));
const back = () =>
  act(async () => {
    const popped = new Promise((resolve) =>
      window.addEventListener('popstate', resolve, { once: true }),
    );
    window.history.back();
    await popped;
  });

// Side by side, the cursor marks the line-number and code cells of one side.
const cursorText = () =>
  Array.from(document.querySelectorAll('.keyboard-cursor'), (cell) => cell.textContent).join(' ');
const notice = () => screen.getByRole('status', { name: 'Link not followed' });

describe('links in comments', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', '/?review=task-a#gavel-editor-token=token');
    vi.mocked(fetch).mockReset();
    vi.stubGlobal('WebSocket', MockWebSocket);
    fixture();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('jumps to another comment, and Back returns to the one the link was in', async () => {
    renderApp();
    scrolled.length = 0;
    behaviors.length = 0;
    fireEvent.click(await screen.findByRole('link', { name: 'next' }));
    await waitFor(() => expect(cursorText()).toContain('old task-a'));
    expect(window.location.hash).toBe('#gavel-editor-token=token&thread=tour-2');
    // One animated scroll, to the comment card: a scroll to its line first would still be
    // moving when the card's position was measured.
    await waitFor(() => expect(scrolled).toEqual(['comment-thread-tour-2']));
    expect(behaviors).toEqual(['smooth']);
    // A brief glow shows which comment the link led to.
    expect(document.getElementById('comment-thread-tour-2')).toHaveClass('comment-link-glow');
    const requests = diffRequests();

    await back();
    expect(window.location.hash).toBe('#gavel-editor-token=token&thread=tour-1');
    await waitFor(() => expect(cursorText()).toContain('new task-a'));
    // Only the place changed, so the review does not reload.
    expect(diffRequests()).toEqual(requests);
  });

  it('keeps a Git comparison following its refs when Back returns within it', async () => {
    window.history.replaceState(null, '', '/?base=HEAD&target=.#gavel-editor-token=token');
    fixture({ git: true });
    renderApp();
    fireEvent.click(await screen.findByRole('link', { name: 'next' }));
    await waitFor(() => expect(cursorText()).toContain('old task-a'));
    const requests = diffRequests();
    await back();
    await waitFor(() => expect(cursorText()).toContain('new task-a'));
    // A reload would pin base to abc123, the commit HEAD named at launch.
    expect(diffRequests()).toEqual(requests);
    expect(window.location.search).toBe('?base=HEAD&target=.');
  });

  it('says why it cannot follow a link', async () => {
    renderApp();
    fireEvent.click(await screen.findByRole('link', { name: 'gone' }));
    expect(notice()).toHaveTextContent('No comment "nope" in this review.');
    fireEvent.click(screen.getByRole('link', { name: 'far' }));
    // A named review's capture holds only its hunks, so it cannot show other lines.
    await waitFor(() =>
      expect(notice()).toHaveTextContent('Line 40 of "file.md" is not in this diff.'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(notice()).toBeEmptyDOMElement();
  });

  it('opens another named review at the linked line', async () => {
    renderApp();
    fireEvent.click(await screen.findByRole('link', { name: 'other review' }));
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Named review capture' })).toHaveTextContent(
        'task-b',
      ),
    );
    await waitFor(() => expect(cursorText()).toContain('new task-b'));
    expect(new URLSearchParams(window.location.search).get('review')).toBe('task-b');
    expect(window.location.hash).toBe('#gavel-editor-token=token&file=file.md&line=2');

    await back();
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Named review capture' })).toHaveTextContent(
        'task-a',
      ),
    );
    expect(window.location.hash).toBe('#gavel-editor-token=token&thread=tour-1');
    await waitFor(() => expect(cursorText()).toContain('new task-a'));
  });

  it('follows a link in the change summary', async () => {
    renderApp();
    fireEvent.click(await screen.findByRole('link', { name: 'tour 2' }));
    await waitFor(() => expect(cursorText()).toContain('old task-a'));
  });

  it('opens the place a pasted URL names', async () => {
    window.history.replaceState(null, '', '/?review=task-a#thread=tour-2');
    renderApp();
    await waitFor(() => expect(cursorText()).toContain('old task-a'));
  });
});
