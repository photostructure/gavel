import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { HotkeysProvider } from 'react-hotkeys-hook';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import type { ConversationSnapshot, ReviewVerdict } from '../types/conversation';
import type { DiffCommentThread, DiffResponse, ReviewContext } from '../types/diff';
import type { InboxDelivery } from '../types/presence';
import type { NamedReviewMetadata } from '../types/review';
import type { ReviewOp } from '../types/reviewOps';
import { applyReviewOp } from '../utils/reviewOps';

import App from './App';
import { MockWebSocket } from './utils/liveConnection.testing';
import { storageService } from './services/StorageService';
import { copyTextToClipboard } from './utils/clipboard';

vi.mock('./utils/clipboard', () => ({
  copyTextToClipboard: vi.fn().mockResolvedValue(undefined),
}));

const watch = vi.hoisted(() => ({
  approvalChanged: undefined as (() => Promise<void>) | undefined,
  captureChanged: undefined as ((reviewName?: string) => Promise<void>) | undefined,
  reviewsChanged: undefined as (() => Promise<void>) | undefined,
  commentsChanged: undefined as (() => Promise<void>) | undefined,
  inboxChanged: undefined as (() => Promise<void>) | undefined,
  reload: undefined as (() => Promise<void>) | undefined,
}));
vi.mock('./hooks/useFileWatch', () => ({
  useFileWatch: (
    onReload?: () => Promise<void>,
    onCommentsChanged?: () => Promise<void>,
    onApprovalChanged?: () => Promise<void>,
    _onSummaryChanged?: () => Promise<void>,
    onCaptureChanged?: (reviewName?: string) => Promise<void>,
    onInboxChanged?: () => Promise<void>,
    onReviewsChanged?: () => Promise<void>,
  ) => {
    watch.reviewsChanged = onReviewsChanged;
    watch.approvalChanged = onApprovalChanged;
    watch.inboxChanged = onInboxChanged;
    watch.captureChanged = onCaptureChanged;
    watch.commentsChanged = onCommentsChanged;
    watch.reload = onReload;
    return {
      shouldReload: false,
      isConnected: true,
      error: null,
      reload: onReload,
      watchState: { isWatchEnabled: false, isReloading: false, lastChangeType: null },
    };
  },
}));

const initialCapture: NamedReviewMetadata = {
  name: 'task-a',
  version: 1,
  patchDigest: 'a'.repeat(64),
  baseCommit: 'base-one',
  repositoryId: 'repository-one',
};
const originalThread: DiffCommentThread = {
  id: 'original',
  filePath: 'file.md',
  position: { side: 'new', line: 2 },
  capture: { version: 1, patchDigest: initialCapture.patchDigest },
  codeSnapshot: { content: 'const stable = true;' },
  createdAt: '2026-10-30T00:00:00Z',
  updatedAt: '2026-10-30T00:00:00Z',
  messages: [
    {
      id: 'original',
      body: 'Original capture discussion',
      author: 'Agent',
      createdAt: '2026-10-30T00:00:00Z',
      updatedAt: '2026-10-30T00:00:00Z',
    },
  ],
};

function fixture(initialThreads: DiffCommentThread[] = []) {
  const state = {
    capture: { ...initialCapture },
    threads: structuredClone(initialThreads),
    commentVersion: 1,
    verdict: undefined as ReviewVerdict | undefined,
    // task-b's verdict; verdict belongs to task-a.
    verdictB: undefined as ReviewVerdict | undefined,
    showReviewB: true,
    // An agent renamed task-a to this name, keeping its ID, or deleted it.
    renamedA: undefined as string | undefined,
    renamedB: undefined as string | undefined,
    deletedA: false,
    showNamedReviews: true,
    addedLine: 'const stable = true;',
    hideFiles: false,
    otherReviews: [] as ConversationSnapshot['reviews'],
    reviewContext: undefined as ReviewContext | undefined,
    // task-a's delivery to the agent session that owns it; undefined is a server without an inbox.
    inbox: undefined as InboxDelivery | undefined,
  };
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = new URL(String(input), window.location.origin);
    const reviewName = url.searchParams.get('review');
    let payload: unknown = {};
    if (url.pathname === '/api/diff') {
      const capture =
        reviewName && reviewName !== state.capture.name
          ? { ...state.capture, name: reviewName }
          : state.capture;
      const diff = {
        capture,
        repositoryId: capture.repositoryId,
        commit: `Review: ${capture.name}`,
        baseCommitish: capture.baseCommit,
        targetCommitish: '.',
        requestedBaseCommitish: capture.baseCommit,
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
                  { type: 'delete', content: 'const stable = false;', oldLineNumber: 2 },
                  { type: 'add', content: state.addedLine, newLineNumber: 2 },
                ],
              },
            ],
          },
        ],
        shipIt: true,
        reviewContext: state.reviewContext,
      } satisfies DiffResponse;
      payload = state.hideFiles ? { ...diff, files: [] } : diff;
    } else if (url.pathname === '/api/revisions') {
      payload = { specialOptions: [], branches: [], commits: [] };
    } else if (url.pathname === '/api/comments-json') {
      payload = {
        version: state.commentVersion,
        cursor: `test:${state.commentVersion}`,
        threads: reviewName === 'task-b' ? [] : structuredClone(state.threads),
      };
    } else if (url.pathname === '/api/review-ops') {
      const { ops } = JSON.parse(String(init?.body)) as { ops: Array<ReviewOp & { id: string }> };
      const key = reviewName === 'task-b' ? 'verdictB' : 'verdict';
      for (const op of ops) {
        if (op.type === 'verdict.set') state[key] = op.verdict === 'clear' ? undefined : op.verdict;
        else if (reviewName === state.capture.name) {
          const outcome = applyReviewOp(state.threads, op, '2026-11-11T00:00:00Z');
          if ('threads' in outcome) state.threads = outcome.threads;
        }
      }
      payload = {
        version: ++state.commentVersion,
        cursor: `test:${state.commentVersion}`,
        results: ops.map(({ id }) => ({ id, status: 'applied' })),
        threads: reviewName === 'task-b' ? [] : structuredClone(state.threads),
      };
    } else if (url.pathname === '/api/review-summary') {
      payload = {
        version: 2,
        commitMessage: 'fix: preserve review context',
        rationale: 'Keep the same discussion after requested changes.',
      };
    } else if (url.pathname === '/api/approval') {
      const key = reviewName === 'task-b' ? 'verdictB' : 'verdict';
      if (init?.method === 'PUT')
        state[key] = (JSON.parse(String(init.body)) as { verdict: ReviewVerdict }).verdict;
      if (init?.method === 'DELETE') state[key] = undefined;
      payload = {
        ...(state[key] ? { verdict: state[key] } : {}),
        captureVersion: state.capture.version,
        patchDigest: state.capture.patchDigest,
        summaryVersion: 2,
      };
    } else if (url.pathname === '/api/inbox' && state.inbox) {
      payload = {
        reviews: [
          {
            id: 'review-a',
            selection: {
              baseCommitish: 'base-one',
              targetCommitish: '.',
              reviewName: state.renamedA ?? 'task-a',
            },
            delivery: state.inbox,
          },
        ],
      };
    } else if (url.pathname === '/api/conversation/snapshot') {
      const named = state.showNamedReviews ? namedReviews() : [];
      payload = {
        cursor: 'stream:1',
        reviews: [
          ...named.filter((review) => !state.deletedA || review.id !== 'review-a'),
          ...state.otherReviews,
        ],
        ...(state.deletedA
          ? {
              deletedReviews: named
                .filter((review) => review.id === 'review-a')
                .map((review) => ({ ...review, deletedAt: '2026-11-10T00:00:00Z' })),
            }
          : {}),
      } satisfies ConversationSnapshot;
    }
    return new Response(JSON.stringify(payload));
  });
  function namedReviews(): ConversationSnapshot['reviews'] {
    return [
      {
        id: 'review-a',
        selection: {
          baseCommitish: 'base-one',
          targetCommitish: '.',
          reviewName: state.renamedA ?? 'task-a',
        },
        threads: [],
        summary: { commitMessage: 'fix: preserve review context', rationale: '', version: 2 },
        approval: state.verdict ? { verdict: state.verdict } : {},
        capture: { ...state.capture, name: state.renamedA ?? state.capture.name },
      },
      ...(state.showReviewB
        ? [
            {
              id: 'review-b',
              selection: {
                baseCommitish: 'base-one',
                targetCommitish: '.',
                reviewName: state.renamedB ?? 'task-b',
              },
              threads: [],
              summary: { commitMessage: '', rationale: '', version: 0 },
              approval: state.verdictB ? { verdict: state.verdictB } : {},
              capture: { ...state.capture, name: state.renamedB ?? 'task-b' },
            },
          ]
        : []),
    ];
  }
  return state;
}

const renderApp = () =>
  render(
    <HotkeysProvider initiallyActiveScopes={['navigation']}>
      <App />
    </HotkeysProvider>,
  );
// Earlier versions kept sent threads in the storage record of a review.
function keepLegacyThreads(ref: string, threads: DiffCommentThread[]) {
  storageService.saveViewedFiles(ref, ref, [], ref, undefined, initialCapture.repositoryId);
  const key = Object.keys(localStorage).find((item) => item.startsWith('gavel-storage-v1/'))!;
  const record = JSON.parse(localStorage.getItem(key)!) as object;
  localStorage.setItem(key, JSON.stringify({ ...record, threads }));
}
const opPosts = (reviewName: string) =>
  vi
    .mocked(fetch)
    .mock.calls.filter(([url]) => String(url) === `/api/review-ops?review=${reviewName}`);
const diffRequests = () =>
  vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith('/api/diff?'));

describe('named captures in the browser', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', '/?review=task-a');
    vi.mocked(fetch).mockReset();
    watch.approvalChanged = undefined;
    watch.captureChanged = undefined;
    watch.reviewsChanged = undefined;
    watch.commentsChanged = undefined;
    watch.reload = undefined;
    vi.stubGlobal('WebSocket', MockWebSocket);
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['entry', false],
    ['entry', true],
    ['frame', false],
    ['frame', true],
    ['retry', false],
    ['retry', true],
    ['correction', false],
    ['correction', true],
  ] as const)('fences deferred named scroll: phase=%s switch=%s', async (phase, switchTask) => {
    fixture();
    renderApp();
    const viewed = await screen.findByRole('button', { name: 'Viewed' });
    await waitFor(() => expect(viewed).toBeEnabled());
    const container = screen.getByRole('main');
    const section = container.querySelector<HTMLElement>('[data-file-path="file.md"][id]');
    if (!section) throw new Error('Missing file section');
    container.scrollTop = 200;
    const containerRect = vi
      .spyOn(container, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(0, 0, 100, 500));
    const sectionRect = vi
      .spyOn(section, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(0, -50, 100, 10));
    const scroll = vi.spyOn(container, 'scrollTo').mockImplementation(() => {});
    let activeScroll = scroll;
    const delayed: Array<() => void> = [];
    const corrections: Array<() => void> = [];
    const realTimer = globalThis.setTimeout.bind(globalThis);
    const timer = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation((callback, delay, ...args) => {
        if (delay === 100 || delay === 180) {
          (delay === 100 ? delayed : corrections).push(() => callback(...args));
          return realTimer(() => {}, 0);
        }
        return realTimer(callback, delay, ...args);
      });
    const frames: FrameRequestCallback[] = [];
    let restoreFrame = () => {};
    const runFrames = () => {
      for (let attempt = 0; frames.length && attempt < 70; attempt += 1) {
        const frame = frames.shift()!;
        act(() => frame(performance.now()));
      }
      expect(frames).toHaveLength(0);
    };
    try {
      fireEvent.click(viewed);
      await waitFor(() => expect(delayed).toHaveLength(1));
      const actionTimer = delayed.shift()!;
      const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });
      restoreFrame = () => {
        raf.mockRestore();
      };
      let continuation = actionTimer;
      if (phase !== 'entry') {
        act(() => actionTimer());
        expect(frames).toHaveLength(1);
        const firstFrame = frames.shift()!;
        if (phase === 'frame') {
          continuation = () => firstFrame(performance.now());
        } else if (phase === 'retry') {
          // Hold a required section so the actual scroll chain requests a retry.
          section.dataset.rendered = 'false';
          act(() => firstFrame(performance.now()));
          expect(scroll).not.toHaveBeenCalled();
          expect(frames).toHaveLength(1);
          const retry = frames.shift()!;
          section.dataset.rendered = 'true';
          continuation = () => retry(performance.now());
        } else {
          act(() => firstFrame(performance.now()));
          runFrames();
          expect(scroll).toHaveBeenCalledWith({ top: 150 });
          expect(corrections).toHaveLength(1);
          continuation = corrections.shift()!;
        }
      }
      if (switchTask) {
        await act(async () => {
          window.history.pushState(null, '', '/?review=task-b');
          window.dispatchEvent(new PopStateEvent('popstate'));
        });
        await waitFor(() =>
          expect(screen.getByRole('status', { name: 'Named review capture' })).toHaveTextContent(
            'task-b',
          ),
        );
        await waitFor(() => expect(screen.getByRole('button', { name: 'Viewed' })).toBeEnabled());
      }
      const currentContainer = screen.getByRole('main');
      if (currentContainer !== container)
        activeScroll = vi.spyOn(currentContainer, 'scrollTo').mockImplementation(() => {});
      activeScroll.mockClear();
      // Isolate the captured action continuation from unrelated new-page layout work.
      frames.length = 0;
      act(() => continuation());
      runFrames();
      if (switchTask) expect(activeScroll).not.toHaveBeenCalled();
      else expect(activeScroll).toHaveBeenCalledWith({ top: 150 });
    } finally {
      section.dataset.rendered = 'true';
      timer.mockRestore();
      restoreFrame();
      if (activeScroll !== scroll) activeScroll.mockRestore();
      scroll.mockRestore();
      containerRect.mockRestore();
      sectionRect.mockRestore();
    }
  });

  it.each(['v', '{Shift>}v{/Shift}'])(
    'keeps the diff stable when $0 is pressed during named preparation',
    async (keys) => {
      const user = userEvent.setup();
      const digest = crypto.subtle.digest.bind(crypto.subtle);
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const spy = vi
        .spyOn(crypto.subtle, 'digest')
        .mockImplementationOnce(async (algorithm, data) => {
          await gate;
          return digest(algorithm, data);
        });
      try {
        fixture();
        renderApp();
        const viewed = await screen.findByRole('button', { name: 'Viewed' });
        expect(viewed).toBeDisabled();
        const container = viewed.closest('[data-file-path]')!;
        const sourceLine = within(container as HTMLElement).getByText(
          (_, element) =>
            element?.textContent === 'const stable = true;' &&
            !Array.from(element.children).some(
              (child) => child.textContent === 'const stable = true;',
            ),
        );
        await user.hover(container);
        await user.keyboard(keys);
        expect(sourceLine).toBeVisible();
        expect(viewed).toHaveAttribute('title', 'Preparing review');
        await act(async () => release?.());
        await waitFor(() => expect(viewed).toBeEnabled());
        expect(sourceLine).toBeVisible();
        await user.keyboard(keys);
        await waitFor(() => expect(viewed).toHaveAttribute('title', 'Mark as not reviewed'));
      } finally {
        await act(async () => release?.());
        spy.mockRestore();
      }
    },
  );

  it('does not collapse another task when its delayed viewed action was canceled', async () => {
    const user = userEvent.setup();
    fixture();
    renderApp();
    const viewed = await screen.findByRole('button', { name: 'Viewed' });
    await waitFor(() => expect(viewed).toBeEnabled());
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = vi
      .spyOn(crypto.subtle, 'digest')
      .mockImplementationOnce(async (algorithm, data) => {
        await gate;
        return digest(algorithm, data);
      });
    try {
      await user.hover(viewed.closest('[data-file-path]')!);
      await user.keyboard('v');
      await act(async () => {
        window.history.pushState(null, '', '/?review=task-b');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      await waitFor(() =>
        expect(screen.getByRole('status', { name: 'Named review capture' })).toHaveTextContent(
          'task-b',
        ),
      );
      const nextViewed = screen.getByRole('button', { name: 'Viewed' });
      await waitFor(() => expect(nextViewed).toBeEnabled());
      const line = screen.getByText(
        (_, element) =>
          element?.textContent === 'const stable = true;' &&
          !Array.from(element.children).some(
            (child) => child.textContent === 'const stable = true;',
          ),
      );
      expect(line).toBeVisible();
      await act(async () => release?.());
      await waitFor(() => expect(nextViewed).toHaveAttribute('title', 'Mark as reviewed'));
      expect(line).toBeVisible();
    } finally {
      await act(async () => release?.());
      spy.mockRestore();
    }
  });

  it('disables viewed controls until a named review is ready without remounting the diff', async () => {
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = vi
      .spyOn(crypto.subtle, 'digest')
      .mockImplementationOnce(async (algorithm, data) => {
        await gate;
        return digest(algorithm, data);
      });
    try {
      fixture();
      renderApp();
      const viewed = await screen.findByRole('button', { name: 'Viewed' });
      expect(viewed).toBeDisabled();
      expect(viewed).toHaveAttribute('title', 'Preparing review');
      const pendingTreeControls = screen.getAllByRole('button', { name: 'Preparing review' });
      expect(pendingTreeControls.length).toBeGreaterThan(0);
      for (const control of pendingTreeControls) expect(control).toBeDisabled();
      await act(async () => release?.());
      await waitFor(() => expect(viewed).toBeEnabled());
      expect(screen.getByRole('button', { name: 'Viewed' })).toBe(viewed);
      expect(screen.queryByRole('button', { name: 'Preparing review' })).not.toBeInTheDocument();
      fireEvent.click(viewed);
      await waitFor(() => expect(viewed).toHaveAttribute('title', 'Mark as not reviewed'));
    } finally {
      await act(async () => release?.());
      spy.mockRestore();
    }
  });

  it('reopens changed viewed content after a capture update and remembers the new content hash', async () => {
    const state = fixture();
    renderApp();
    const viewed = await screen.findByRole('button', { name: 'Viewed' });
    await waitFor(() => expect(viewed).toBeEnabled());
    fireEvent.click(viewed);
    await waitFor(() => expect(viewed).toHaveAttribute('title', 'Mark as not reviewed'));
    state.addedLine = 'const updated = true;';
    state.capture = { ...state.capture, version: 2, patchDigest: 'b'.repeat(64) };
    await act(async () => watch.captureChanged?.('task-a'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Viewed' })).toHaveAttribute(
        'title',
        'Mark as reviewed',
      ),
    );
    expect(screen.getByLabelText('Updated since you last viewed this file')).toBeVisible();
    expect(
      screen.getByText(
        (_, element) =>
          element?.textContent === 'const updated = true;' &&
          !Array.from(element.children).some(
            (child) => child.textContent === 'const updated = true;',
          ),
      ),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Viewed' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Viewed' })).toHaveAttribute(
        'title',
        'Mark as not reviewed',
      ),
    );
    state.capture = { ...state.capture, version: 3, patchDigest: 'c'.repeat(64) };
    await act(async () => watch.captureChanged?.('task-a'));
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Named review capture' })).toHaveTextContent(
        'capture v3',
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Viewed' })).toHaveAttribute(
        'title',
        'Mark as not reviewed',
      ),
    );
    state.hideFiles = true;
    state.capture = { ...state.capture, version: 4, patchDigest: 'd'.repeat(64) };
    await act(async () => watch.captureChanged?.('task-a'));
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Named review capture' })).toHaveTextContent(
        'capture v4',
      ),
    );
    expect(screen.queryByText('1 / 0 files viewed')).not.toBeInTheDocument();
    expect(screen.getByText('0 / 0 files viewed')).toBeVisible();
    state.hideFiles = false;
    state.capture = { ...state.capture, version: 5, patchDigest: 'e'.repeat(64) };
    await act(async () => watch.captureChanged?.('task-a'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Viewed' })).toHaveAttribute(
        'title',
        'Mark as not reviewed',
      ),
    );
  });

  it.each(['task.a', 'task_2e_a'])(
    'does not restore ambiguous legacy discussion into %s',
    async (reviewName) => {
      keepLegacyThreads('review:task.a', [originalThread]);
      const legacyKey = Object.keys(localStorage)[0]!;
      const legacyValue = localStorage.getItem(legacyKey);
      const state = fixture();
      state.capture.name = reviewName;
      window.history.replaceState(null, '', `/?review=${reviewName}`);
      renderApp();
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /^(Approve|Approved)$/ })).toBeEnabled(),
      );
      expect(
        opPosts(reviewName).some(([, init]) =>
          String(init?.body).includes('Original capture discussion'),
        ),
      ).toBe(false);
      expect(localStorage.getItem(legacyKey)).toBe(legacyValue);
    },
  );

  it.each(['parser-manual-test', 'commit-01-parser'])(
    'recovers the existing unambiguous legacy discussion for %s',
    async (reviewName) => {
      const ref = `review:${reviewName}`;
      keepLegacyThreads(ref, [originalThread]);
      const state = fixture();
      state.capture.name = reviewName;
      window.history.replaceState(null, '', `/?review=${reviewName}`);
      renderApp();
      await waitFor(() =>
        expect(
          opPosts(reviewName).some(([, init]) =>
            String(init?.body).includes('Original capture discussion'),
          ),
        ).toBe(true),
      );
    },
  );

  it.each([
    { name: '', status: 400 },
    { name: 'bad name', status: 400 },
    { name: 'missing-task', status: 404 },
  ])('keeps an explicit invalid or missing name $name as an error', async ({ name, status }) => {
    fixture();
    const baseFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = new URL(String(input), window.location.origin);
      if (url.pathname === '/api/diff' && url.searchParams.has('review')) {
        return new Response(JSON.stringify({ error: 'Named review unavailable' }), { status });
      }
      return baseFetch(input, init);
    });
    const search = `?review=${encodeURIComponent(name)}`;
    window.history.replaceState(null, '', `/${search}`);
    renderApp();
    expect(await screen.findByText('Named review unavailable')).toBeVisible();
    expect(diffRequests().length).toBeGreaterThan(0);
    for (const [input] of diffRequests()) {
      const url = new URL(String(input), window.location.origin);
      expect(url.searchParams.has('review')).toBe(true);
      expect(url.searchParams.get('review')).toBe(name);
    }
    expect(screen.queryByRole('status', { name: 'Named review capture' })).not.toBeInTheDocument();
    expect(window.location.search).toBe(search);
  });

  it('toggles captured whitespace without changing capture identity, approval or viewed records', async () => {
    // The alignment budgets are wall-clock milliseconds, so a busy machine would change the result.
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    onTestFinished(() => clock.mockRestore());
    const state = fixture();
    const content = '  const stable = false;  ';
    state.addedLine = content;
    state.verdict = 'approve';
    renderApp();
    const capture = await screen.findByRole('status', { name: 'Named review capture' });
    const identity = capture.textContent;
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    const toggle = screen.getByRole('checkbox', { name: 'Ignore Whitespace' });
    expect(toggle).toBeChecked();
    await screen.findByText('Whitespace-only changes hidden');
    expect(document.querySelectorAll('[data-diff-line-row="true"]')).toHaveLength(0);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Viewed' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Viewed' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Viewed' })).toHaveAttribute(
        'title',
        'Mark as not reviewed',
      ),
    );
    const saved = JSON.stringify(localStorage);
    const requestCount = diffRequests().length;
    // Expand the reviewed file, then reveal its original captured rows.
    fireEvent.click(screen.getByRole('button', { name: 'Expand file (Alt+Click to expand all)' }));
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(document.querySelectorAll('[data-diff-line-row="true"]')).toHaveLength(1),
    );
    expect(document.querySelector('[data-diff-line-row="true"]')?.textContent).toContain(
      'const stable = false;',
    );
    expect(screen.getByRole('status', { name: 'Named review capture' }).textContent).toBe(identity);
    expect(screen.getByRole('button', { name: 'Viewed' })).toHaveAttribute(
      'title',
      'Mark as not reviewed',
    );
    expect(JSON.stringify(localStorage)).toBe(saved);
    expect(state.verdict).toBe('approve');
    expect(diffRequests()).toHaveLength(requestCount);
    fireEvent.click(toggle);
    await screen.findByText('Whitespace-only changes hidden');
    expect(document.querySelectorAll('[data-diff-line-row="true"]')).toHaveLength(0);
  });

  it('orders same-capture comment refreshes before updating threads', async () => {
    const state = fixture([originalThread]);
    renderApp();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^(Approve|Approved)$/ })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Conversation' }));
    const baseFetch = vi.mocked(fetch).getMockImplementation()!;
    let releaseOld: ((response: Response) => void) | undefined;
    const oldResponse = new Promise<Response>((resolve) => {
      releaseOld = resolve;
    });
    let delayNext = true;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input).startsWith('/api/comments-json?') && delayNext) {
        delayNext = false;
        return oldResponse;
      }
      return baseFetch(input, init);
    });
    const pending = watch.commentsChanged?.();
    state.threads.push({
      ...structuredClone(originalThread),
      id: 'same-capture-new',
      messages: [
        {
          id: 'same-capture-new',
          body: 'Same capture new discussion',
          createdAt: originalThread.createdAt,
          updatedAt: originalThread.updatedAt,
        },
      ],
    });
    state.commentVersion = 2;
    try {
      await act(async () => watch.commentsChanged?.());
      expect(
        await within(screen.getByRole('dialog', { name: 'Conversation' })).findByText(
          'Same capture new discussion',
        ),
      ).toBeVisible();
      await act(async () => {
        releaseOld?.(
          new Response(JSON.stringify({ version: 1, cursor: 'test:1', threads: [originalThread] })),
        );
        await pending;
      });
      expect(
        within(screen.getByRole('dialog', { name: 'Conversation' })).getByText(
          'Same capture new discussion',
        ),
      ).toBeVisible();
    } finally {
      releaseOld?.(
        new Response(JSON.stringify({ version: 1, cursor: 'test:1', threads: [originalThread] })),
      );
    }
  });

  it('ignores prior-capture comment responses after fresh capture comments are loaded', async () => {
    const state = fixture([originalThread]);
    renderApp();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^(Approve|Approved)$/ })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Conversation' }));
    const baseFetch = vi.mocked(fetch).getMockImplementation()!;
    let releaseOld: ((response: Response) => void) | undefined;
    const oldResponse = new Promise<Response>((resolve) => {
      releaseOld = resolve;
    });
    let delayNext = true;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input).startsWith('/api/comments-json?') && delayNext) {
        delayNext = false;
        return oldResponse;
      }
      return baseFetch(input, init);
    });
    const pending = watch.commentsChanged?.();
    state.capture = { ...state.capture, version: 2, patchDigest: 'b'.repeat(64) };
    state.threads.push({
      ...structuredClone(originalThread),
      id: 'after-update',
      capture: { version: 2, patchDigest: state.capture.patchDigest },
      messages: [
        {
          id: 'after-update',
          body: 'New capture discussion',
          createdAt: originalThread.createdAt,
          updatedAt: originalThread.updatedAt,
        },
      ],
    });
    state.commentVersion += 1;
    try {
      await act(async () => watch.captureChanged?.('task-a'));
      // The server announces the agent's comment on the new capture.
      await act(async () => watch.commentsChanged?.());
      expect(
        await within(screen.getByRole('dialog', { name: 'Conversation' })).findByText(
          'New capture discussion',
        ),
      ).toBeVisible();
      await act(async () => {
        releaseOld?.(
          new Response(JSON.stringify({ version: 1, cursor: 'test:1', threads: [originalThread] })),
        );
        await pending;
      });
      expect(
        within(screen.getByRole('dialog', { name: 'Conversation' })).getByText(
          'New capture discussion',
        ),
      ).toBeVisible();
    } finally {
      releaseOld?.(
        new Response(JSON.stringify({ version: 1, cursor: 'test:1', threads: [originalThread] })),
      );
    }
  });

  it('loads a frozen capture by name and binds approval to the displayed capture and proposal', async () => {
    fixture();
    renderApp();
    const identity = await screen.findByRole('status', { name: 'Named review capture' });
    expect(identity).toHaveTextContent('task-a');
    expect(identity).toHaveTextContent('capture v1');
    expect(identity).toHaveTextContent(initialCapture.patchDigest.slice(0, 12));
    expect(screen.queryByRole('button', { name: /Expand.*hidden lines/ })).not.toBeInTheDocument();
    expect(screen.getByText('1 line outside this patch')).toBeVisible();
    const approve = screen.getByRole('button', { name: /^(Approve|Approved)$/ });
    await waitFor(() => expect(approve).toBeEnabled());
    fireEvent.click(approve);
    await waitFor(() => expect(approve).toHaveTextContent(/^Approved$/));
    const init = opPosts('task-a')[0]?.[1];
    expect(JSON.parse(String(init?.body))).toEqual({
      repositoryId: initialCapture.repositoryId,
      ops: [
        {
          type: 'verdict.set',
          verdict: 'approve',
          summaryVersion: 2,
          captureVersion: 1,
          patchDigest: initialCapture.patchDigest,
          id: expect.any(String),
          queuedAt: expect.any(String),
        },
      ],
    });
    for (const [input] of vi.mocked(fetch).mock.calls) {
      const url = new URL(String(input), window.location.origin);
      if (
        [
          '/api/diff',
          '/api/comments-json',
          '/api/review-ops',
          '/api/approval',
          '/api/review-summary',
        ].includes(url.pathname)
      ) {
        expect(url.searchParams.get('review')).toBe('task-a');
        expect(url.searchParams.has('base')).toBe(false);
        expect(url.searchParams.has('target')).toBe(false);
      }
      expect(url.pathname).not.toMatch(/^\/api\/(blob|line-count|reviews)/);
    }
    expect(window.location.search).toBe('?review=task-a');
  });

  it('keeps the discussion while marking original inline anchors outdated', async () => {
    const state = fixture([originalThread]);
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: 'Conversation' }));
    expect(
      await within(screen.getByRole('dialog', { name: 'Conversation' })).findByText(
        'Original capture discussion',
      ),
    ).toBeVisible();
    expect(screen.queryByLabelText('Outdated comment')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close conversation' }));
    const before = diffRequests().length;
    await act(async () => watch.captureChanged?.('another-task'));
    expect(diffRequests()).toHaveLength(before);
    state.capture = {
      ...state.capture,
      version: 2,
      patchDigest: 'b'.repeat(64),
      baseCommit: 'base-two',
    };
    await act(async () => watch.captureChanged?.('task-a'));
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Named review capture' })).toHaveTextContent(
        'capture v2',
      ),
    );
    expect(state.threads[0]?.capture).toEqual({
      version: 1,
      patchDigest: initialCapture.patchDigest,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Conversation' }));
    expect(
      await within(screen.getByRole('dialog', { name: 'Conversation' })).findByLabelText(
        'Outdated comment',
      ),
    ).toBeVisible();
    expect(
      within(screen.getByRole('dialog', { name: 'Conversation' })).getByText(
        'Original capture discussion',
      ),
    ).toBeVisible();
    expect(window.location.search).toBe('?review=task-a');
  });

  // Copies the thread's prompt from its menu, or clicks `button` instead when given.
  async function copyFromConversation(button?: RegExp) {
    fireEvent.click(await screen.findByRole('button', { name: 'Conversation' }));
    const conversation = screen.getByRole('dialog', { name: 'Conversation' });
    await within(conversation).findByText('Original capture discussion');
    vi.mocked(copyTextToClipboard).mockClear();
    if (button) {
      fireEvent.click(await within(conversation).findByRole('button', { name: button }));
    } else {
      fireEvent.click(await within(conversation).findByRole('button', { name: 'Thread actions' }));
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy prompt' }));
    }
    await waitFor(() => expect(copyTextToClipboard).toHaveBeenCalledTimes(1));
    return vi.mocked(copyTextToClipboard).mock.calls[0]?.[0];
  }

  it('names the open review tab in Copy Prompt when the server has several reviews', async () => {
    fixture([originalThread]);
    renderApp();
    await screen.findByRole('navigation', { name: 'Reviews on this server' });
    expect(await copyFromConversation()).toBe(
      '<review-thread tab="task-a" location="file.md:L2">\n<comment>\nOriginal capture discussion\n</comment>\n</review-thread>',
    );
  });

  it.each([
    [
      'the repository directory',
      { source: 'git', repositoryPath: '/src/one', workingDirectory: '/src/one/sub' },
      '/src/one',
    ],
    [
      'the launch directory for a piped diff',
      { source: 'stdin', workingDirectory: '/tmp/x' },
      '/tmp/x',
    ],
  ] as const)('names %s and the agent session in Copy Prompt', async (_case, context, repo) => {
    const state = fixture([originalThread]);
    state.reviewContext = { ...context, hostname: 'host', agentSessionId: 'session-1' };
    renderApp();
    await screen.findByRole('navigation', { name: 'Reviews on this server' });
    expect(await copyFromConversation()).toBe(
      `<review-thread tab="task-a" repo="${repo}" session="session-1" location="file.md:L2">\n<ask-if>Not your diff? Ask before continuing</ask-if>\n<comment>\nOriginal capture discussion\n</comment>\n</review-thread>`,
    );
  });

  it('gives the repository and agent session in Copy All Prompt', async () => {
    const state = fixture([originalThread]);
    state.reviewContext = {
      source: 'git',
      repositoryPath: '/src/one',
      workingDirectory: '/src/one',
      hostname: 'host',
      agentSessionId: 'session-1',
    };
    renderApp();
    await screen.findByRole('navigation', { name: 'Reviews on this server' });
    expect(await copyFromConversation(/Copy All Prompt/)).toMatch(
      /^<review-threads repo="\/src\/one" session="session-1"[^>]*>\n<ask-if>/,
    );
  });

  it('leaves the tab name out of Copy Prompt when the server has one review', async () => {
    const state = fixture([originalThread]);
    renderApp();
    const tabs = { name: 'Reviews on this server' };
    await screen.findByRole('navigation', tabs);
    state.showReviewB = false;
    await act(async () => watch.captureChanged?.('task-b'));
    // The tab row disappears only once the review list holds this one review.
    await waitFor(() => expect(screen.queryByRole('navigation', tabs)).not.toBeInTheDocument());
    expect(await copyFromConversation()).toBe(
      '<review-thread location="file.md:L2">\n<comment>\nOriginal capture discussion\n</comment>\n</review-thread>',
    );
  });

  it('adds a tab when another named review is created', async () => {
    const state = fixture();
    state.showReviewB = false;
    renderApp();
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/conversation/snapshot'));
    expect(
      screen.queryByRole('navigation', { name: 'Reviews on this server' }),
    ).not.toBeInTheDocument();
    const before = diffRequests().length;
    state.showReviewB = true;
    await act(async () => watch.captureChanged?.('task-b'));
    const bar = await screen.findByRole('navigation', { name: 'Reviews on this server' });
    expect(within(bar).getByRole('button', { name: 'task-b, Needs a verdict' })).toBeVisible();
    expect(diffRequests()).toHaveLength(before);
    expect(window.location.search).toBe('?review=task-a');
  });

  // A page that missed the event while disconnected follows the review by its ID.
  it.each([
    ['the live event', () => watch.reviewsChanged?.()],
    ['a reconnect', () => watch.captureChanged?.()],
  ])(
    'follows a rename of the open review after %s without reloading the page',
    async (_, notify) => {
      const state = fixture();
      renderApp();
      await screen.findByRole('navigation', { name: 'Reviews on this server' });
      const entries = window.history.length;
      state.renamedA = 'task-renamed';
      await act(async () => notify());
      await waitFor(() => expect(window.location.search).toBe('?review=task-renamed'));
      expect(window.history.length).toBe(entries);
      const latest = diffRequests().at(-1);
      expect(new URL(String(latest?.[0]), window.location.origin).searchParams.get('review')).toBe(
        'task-renamed',
      );
    },
  );

  // The server sends no inboxDeliveryChanged for a rename: the session inbox ignores agent events.
  it('keeps showing where verdicts go after following a rename', async () => {
    const state = fixture();
    state.inbox = { status: 'ready' };
    renderApp();
    const status = { name: 'Agent available' };
    expect((await screen.findAllByRole('button', status))[0]).toBeInTheDocument();
    state.renamedA = 'task-renamed';
    await act(async () => watch.reviewsChanged?.());
    await waitFor(() => expect(window.location.search).toBe('?review=task-renamed'));
    expect((await screen.findAllByRole('button', status))[0]).toBeInTheDocument();
  });

  // A change waits in localStorage under the review's name until the server confirms it.
  it('sends a change the server had not confirmed to the review under its new name', async () => {
    const verdictButton = (name: string) =>
      within(screen.getByRole('group', { name: 'Verdict' })).getByRole('button', { name });
    const state = fixture();
    renderApp();
    await waitFor(() => expect(verdictButton('Reject')).toBeEnabled());
    const baseFetch = vi.mocked(fetch).getMockImplementation()!;
    let opsDown = true;
    vi.mocked(fetch).mockImplementation(async (input, init) =>
      opsDown && String(input).startsWith('/api/review-ops')
        ? new Response('{}', { status: 503 })
        : baseFetch(input, init),
    );
    fireEvent.click(verdictButton('Reject'));
    await waitFor(() => expect(opPosts('task-a').length).toBeGreaterThan(0));
    opsDown = false;
    state.renamedA = 'task-renamed';
    await act(async () => watch.reviewsChanged?.());
    await waitFor(() => expect(window.location.search).toBe('?review=task-renamed'));
    await waitFor(() =>
      expect(
        opPosts('task-renamed').some(([, init]) => String(init?.body).includes('"reject"')),
      ).toBe(true),
    );
    expect(state.verdict).toBe('reject');
    expect(Object.keys(localStorage).filter((key) => key.startsWith('gavel:review-ops:'))).toEqual(
      [],
    );
  });

  // Every renamed review's waiting changes move, whichever review the page shows meanwhile.
  describe('a change the server had not confirmed when its review was renamed', () => {
    const verdictButton = (name: string) =>
      within(screen.getByRole('group', { name: 'Verdict' })).getByRole('button', { name });
    const rejectWhileOpsFail = async () => {
      const state = fixture();
      renderApp();
      await waitFor(() => expect(verdictButton('Reject')).toBeEnabled());
      const baseFetch = vi.mocked(fetch).getMockImplementation()!;
      const control = { opsDown: true, holdDiff: undefined as string | undefined };
      let releaseDiff = () => {};
      const held = new Promise<void>((resolve) => (releaseDiff = resolve));
      vi.mocked(fetch).mockImplementation(async (input, init) => {
        const url = String(input);
        if (control.opsDown && url.startsWith('/api/review-ops'))
          return new Response('{}', { status: 503 });
        if (control.holdDiff && url.startsWith('/api/diff?') && url.includes(control.holdDiff))
          await held;
        return baseFetch(input, init);
      });
      fireEvent.click(verdictButton('Reject'));
      await waitFor(() => expect(opPosts('task-a').length).toBeGreaterThan(0));
      return { state, control, releaseDiff };
    };
    const rejectReaches = (reviewName: string) =>
      waitFor(() =>
        expect(
          opPosts(reviewName).some(([, init]) => String(init?.body).includes('"reject"')),
        ).toBe(true),
      );

    it("follows two renames made before the first one's diff loads", async () => {
      const { state, control, releaseDiff } = await rejectWhileOpsFail();
      control.opsDown = false;
      control.holdDiff = 'review=task-middle';
      state.renamedA = 'task-middle';
      await act(async () => watch.reviewsChanged?.());
      state.renamedA = 'task-final';
      await act(async () => watch.reviewsChanged?.());
      releaseDiff();
      await waitFor(() => expect(window.location.search).toBe('?review=task-final'));
      await rejectReaches('task-final');
      expect(state.verdict).toBe('reject');
    });

    it('moves them for a review renamed while the page shows another', async () => {
      const { state, control } = await rejectWhileOpsFail();
      control.opsDown = false;
      const bar = screen.getByRole('navigation', { name: 'Reviews on this server' });
      fireEvent.click(within(bar).getByRole('button', { name: 'task-b, Needs a verdict' }));
      await waitFor(() => expect(window.location.search).toBe('?review=task-b'));
      state.renamedA = 'task-renamed';
      await act(async () => watch.reviewsChanged?.());
      const renamedTab = await waitFor(() =>
        within(screen.getByRole('navigation', { name: 'Reviews on this server' })).getByRole(
          'button',
          { name: /^task-renamed,/ },
        ),
      );
      fireEvent.click(renamedTab);
      await waitFor(() => expect(window.location.search).toBe('?review=task-renamed'));
      await rejectReaches('task-renamed');
      expect(state.verdict).toBe('reject');
    });
  });

  it('follows a second rename and then a delete of the review it already followed', async () => {
    const state = fixture();
    renderApp();
    await screen.findByRole('navigation', { name: 'Reviews on this server' });
    state.renamedA = 'task-middle';
    await act(async () => watch.reviewsChanged?.());
    await waitFor(() => expect(window.location.search).toBe('?review=task-middle'));
    state.renamedA = 'task-final';
    await act(async () => watch.reviewsChanged?.());
    await waitFor(() => expect(window.location.search).toBe('?review=task-final'));
    const before = diffRequests().length;
    state.deletedA = true;
    await act(async () => watch.reviewsChanged?.());
    await waitFor(() => expect(diffRequests().length).toBeGreaterThan(before));
    const latest = new URL(String(diffRequests().at(-1)?.[0]), window.location.origin);
    expect(latest.searchParams.get('review')).toBeNull();
  });

  it('follows a rename of a review opened from its tab', async () => {
    const state = fixture();
    renderApp();
    const bar = await screen.findByRole('navigation', { name: 'Reviews on this server' });
    fireEvent.click(within(bar).getByRole('button', { name: 'task-b, Needs a verdict' }));
    await waitFor(() => expect(window.location.search).toBe('?review=task-b'));
    state.renamedB = 'task-b-renamed';
    await act(async () => watch.reviewsChanged?.());
    await waitFor(() => expect(window.location.search).toBe('?review=task-b-renamed'));
  });

  it('follows the open review by its ID when a new review reuses its name', async () => {
    const state = fixture();
    renderApp();
    await screen.findByRole('navigation', { name: 'Reviews on this server' });
    state.renamedA = 'task-renamed';
    state.otherReviews = [
      {
        id: 'new-task-a',
        selection: { baseCommitish: 'base-one', targetCommitish: '.', reviewName: 'task-a' },
        threads: [],
        summary: { commitMessage: '', rationale: '', version: 0 },
        approval: {},
        capture: { ...state.capture },
      },
    ];
    await act(async () => watch.captureChanged?.());
    await waitFor(() => expect(window.location.search).toBe('?review=task-renamed'));
  });

  it('leaves a deleted open review for the uncommitted changes, and ignores another review', async () => {
    const state = fixture();
    renderApp();
    await screen.findByRole('navigation', { name: 'Reviews on this server' });
    const before = diffRequests().length;
    state.showReviewB = false;
    await act(async () => watch.reviewsChanged?.());
    expect(diffRequests()).toHaveLength(before);
    expect(window.location.search).toBe('?review=task-a');

    state.deletedA = true;
    await act(async () => watch.reviewsChanged?.());
    await waitFor(() => expect(diffRequests().length).toBeGreaterThan(before));
    const latest = new URL(String(diffRequests().at(-1)?.[0]), window.location.origin);
    expect(latest.searchParams.get('review')).toBeNull();
    expect(latest.searchParams.get('base')).toBe('HEAD');
    expect(latest.searchParams.get('target')).toBe('.');
  });

  it("lists a deleted review's threads in Conversation as deleted", async () => {
    const state = fixture();
    state.otherReviews = [];
    const baseFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input) !== '/api/conversation/snapshot') return baseFetch(input, init);
      const snapshot = (await (await baseFetch(input, init)).json()) as ConversationSnapshot;
      return new Response(
        JSON.stringify({
          ...snapshot,
          deletedReviews: [
            {
              id: 'gone-id',
              selection: { baseCommitish: 'base-one', targetCommitish: '.', reviewName: 'gone' },
              threads: [{ ...originalThread, id: 'gone-thread' }],
              summary: { commitMessage: '', rationale: '', version: 0 },
              approval: {},
              capture: { ...state.capture, name: 'gone' },
              deletedAt: '2026-11-10T00:00:00Z',
            },
          ],
        } satisfies ConversationSnapshot),
      );
    });
    renderApp();
    const bar = await screen.findByRole('navigation', { name: 'Reviews on this server' });
    expect(within(bar).queryByRole('button', { name: /gone/ })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /Conversation/ }));
    fireEvent.click(await screen.findByRole('radio', { name: 'All reviews' }));
    expect(await screen.findByRole('heading', { name: 'gone (deleted)' })).toBeVisible();
  });

  it("keeps a deleted review's threads in Conversation while a new review reuses its name", async () => {
    const state = fixture();
    state.otherReviews = [];
    const baseFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input) !== '/api/conversation/snapshot') return baseFetch(input, init);
      const snapshot = (await (await baseFetch(input, init)).json()) as ConversationSnapshot;
      return new Response(
        JSON.stringify({
          ...snapshot,
          deletedReviews: [
            {
              id: 'gone-id',
              selection: { baseCommitish: 'base-one', targetCommitish: '.', reviewName: 'task-a' },
              threads: [{ ...originalThread, id: 'gone-thread' }],
              summary: { commitMessage: '', rationale: '', version: 0 },
              approval: {},
              capture: { ...state.capture, name: 'task-a' },
              deletedAt: '2026-11-10T00:00:00Z',
            },
          ],
        } satisfies ConversationSnapshot),
      );
    });
    renderApp();
    await screen.findByRole('navigation', { name: 'Reviews on this server' });
    fireEvent.click(await screen.findByRole('button', { name: /Conversation/ }));
    fireEvent.click(await screen.findByRole('radio', { name: 'All reviews' }));
    expect(await screen.findByRole('heading', { name: 'task-a (deleted)' })).toBeVisible();
  });

  it('shows the other reviews on the server and navigates by their stable names', async () => {
    fixture();
    renderApp();
    const bar = await screen.findByRole('navigation', { name: 'Reviews on this server' });
    expect(within(bar).getByRole('button', { name: 'task-a, Needs a verdict' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    fireEvent.click(within(bar).getByRole('button', { name: 'task-b, Needs a verdict' }));
    await waitFor(() => expect(window.location.search).toBe('?review=task-b'));
    const latest = diffRequests().at(-1);
    expect(new URL(String(latest?.[0]), window.location.origin).searchParams.get('review')).toBe(
      'task-b',
    );
    expect(
      within(screen.getByRole('status', { name: 'Named review capture' })).getByText('task-b'),
    ).toBeVisible();
  });

  it('switches reviews from the tabs without adding browser history, so the tab can close itself', async () => {
    fixture();
    renderApp();
    const bar = await screen.findByRole('navigation', { name: 'Reviews on this server' });
    const entries = window.history.length;
    fireEvent.click(within(bar).getByRole('button', { name: 'task-b, Needs a verdict' }));
    await waitFor(() => expect(window.location.search).toBe('?review=task-b'));
    expect(window.history.length).toBe(entries);
  });

  it('replaces the revision picker with the review name while a review asks for approval', async () => {
    fixture();
    renderApp();
    await screen.findByRole('navigation', { name: 'Reviews on this server' });
    expect(screen.queryByRole('button', { name: /^Revision menu:/ })).not.toBeInTheDocument();
    expect(screen.getByTitle('task-a')).toBeVisible();
  });

  it('offers a tab to the one review that asks for approval when another diff is open', async () => {
    const state = fixture();
    state.showNamedReviews = false;
    state.otherReviews = [
      {
        id: 'proposed',
        selection: { baseCommitish: 'def456^', targetCommitish: 'def456' },
        threads: [],
        summary: { commitMessage: 'feat: next', rationale: '', version: 1 },
        approval: {},
      },
    ];
    renderApp();
    const bar = await screen.findByRole('navigation', { name: 'Reviews on this server' });
    expect(within(bar).getByRole('button', { name: /^def456\^\.\.\.def456, / })).toBeVisible();
    expect(screen.queryByRole('button', { name: /^Revision menu:/ })).not.toBeInTheDocument();
  });

  it('drops a working-tree review whose proposal landed once HEAD moves', async () => {
    const state = fixture();
    const working = (id: string, base: string, commitMessage: string) => ({
      id,
      selection: { baseCommitish: base, targetCommitish: '.' },
      threads: [],
      summary: { commitMessage, rationale: '', version: commitMessage ? 1 : 0 },
      approval: {},
    });
    // The proposal landed, so the review for the new HEAD gets no carried summary.
    state.otherReviews = [
      working('before-commit', 'old-head', 'feat: landed'),
      working('after-commit', 'new-head', ''),
    ];
    renderApp();
    const bar = await screen.findByRole('navigation', { name: 'Reviews on this server' });
    expect(
      within(within(bar).getByRole('list'))
        .getAllByRole('button')
        .map((tab) => tab.textContent),
    ).toEqual(['task-a', 'task-b']);
  });

  it('closes an open Detailed Diff dialog once a review asks for approval', async () => {
    const state = fixture();
    state.showNamedReviews = false;
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: /^Revision menu:/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Detailed\.\.\./ }));
    expect(await screen.findByText('Detailed Diff')).toBeVisible();

    state.showNamedReviews = true;
    await act(async () => watch.approvalChanged?.());
    await screen.findByRole('navigation', { name: 'Reviews on this server' });
    expect(screen.queryByText('Detailed Diff')).not.toBeInTheDocument();
  });

  it('keeps the revision picker while no review asks for approval', async () => {
    const state = fixture();
    state.showNamedReviews = false;
    state.otherReviews = [
      {
        id: 'uncommitted',
        selection: { baseCommitish: 'base-one', targetCommitish: '.' },
        threads: [],
        summary: { commitMessage: '', rationale: '', version: 0 },
        approval: {},
      },
    ];
    renderApp();
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/conversation/snapshot'));
    expect(await screen.findByRole('button', { name: /^Revision menu:/ })).toBeVisible();
  });

  it('leaves browsed commits and working-tree reviews from before HEAD moved out of the tabs', async () => {
    const state = fixture();
    const review = (id: string, base: string, target: string, fromCommit?: true) => ({
      id,
      selection: { baseCommitish: base, targetCommitish: target },
      threads: [],
      summary: {
        commitMessage: `feat: ${id}`,
        rationale: '',
        version: 1,
        ...(fromCommit ? { fromCommit } : {}),
      },
      approval: {},
    });
    state.otherReviews = [
      // The server copies a browsed commit's Git message into its summary.
      review('browsed', 'abc123^', 'abc123', true),
      // A commit that moves HEAD gives `.` a new review; the old one stays on the server.
      review('before-commit', 'old-head', '.'),
      review('proposed-commit', 'def456^', 'def456'),
      review('after-commit', 'new-head', '.'),
    ];
    renderApp();
    const bar = await screen.findByRole('navigation', { name: 'Reviews on this server' });
    expect(
      within(within(bar).getByRole('list'))
        .getAllByRole('button')
        .map((tab) => tab.textContent),
    ).toEqual(['task-a', 'task-b', 'def456^...def456', 'new-head...Uncommitted Changes']);
  });

  it('updates the tabs when a reload follows a commit that moved HEAD', async () => {
    const state = fixture();
    renderApp();
    const bar = await screen.findByRole('navigation', { name: 'Reviews on this server' });
    const tabs = () => within(within(bar).getByRole('list')).getAllByRole('button');
    expect(tabs()).toHaveLength(2);

    // A commit creates a review on the server without any approval, summary, or capture event.
    state.otherReviews = [
      {
        id: 'proposed-commit',
        selection: { baseCommitish: 'def456^', targetCommitish: 'def456' },
        threads: [],
        summary: { commitMessage: 'feat: next', rationale: '', version: 1 },
        approval: {},
      },
    ];
    await act(async () => watch.reload?.());
    await waitFor(() => expect(tabs()).toHaveLength(3));
  });

  it('marks a review approved in the bar once its approval arrives', async () => {
    const state = fixture();
    renderApp();
    const bar = await screen.findByRole('navigation', { name: 'Reviews on this server' });
    expect(bar).toHaveTextContent('2 need a verdict');
    state.verdict = 'approve';
    await act(async () => watch.approvalChanged?.());
    expect(await within(bar).findByRole('button', { name: 'task-a, Approved' })).toBeVisible();
    expect(bar).toHaveTextContent('1 needs a verdict');
  });
});

describe('after a verdict', () => {
  const verdictButton = (name: string) =>
    within(screen.getByRole('group', { name: 'Verdict' })).getByRole('button', { name });
  const nextStep = () => screen.getByRole('status', { name: 'Next step' });

  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', '/?review=task-a');
    vi.mocked(fetch).mockReset();
    watch.approvalChanged = undefined;
    vi.stubGlobal('WebSocket', MockWebSocket);
    // Fake timers that still advance with real time, so waitFor keeps polling.
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('the open review in the tab bar', () => {
    const openTabMark = () =>
      within(screen.getByRole('navigation', { name: 'Reviews on this server' }))
        .getByRole('button', { current: 'page' })
        .querySelector('.verdict-mark');

    async function approveOpenReview() {
      const state = fixture();
      renderApp();
      const bar = await screen.findByRole('navigation', { name: 'Reviews on this server' });
      await waitFor(() => expect(verdictButton('Approve')).toBeEnabled());
      expect(bar).toHaveTextContent('2 need a verdict');
      expect(openTabMark()).toHaveClass('lucide-circle');
      fireEvent.click(verdictButton('Approve'));
      await waitFor(() => expect(nextStep()).toHaveTextContent('Switching to task-b in 10s'));
      return { bar, state };
    }

    it('shows its own verdict', async () => {
      const { bar } = await approveOpenReview();
      expect(within(bar).getByRole('button', { name: 'task-a, Approved' })).toBeVisible();
      expect(openTabMark()).toHaveClass('lucide-check');
      expect(bar).toHaveTextContent('1 needs a verdict');
    });

    it('needs a verdict again once the reviewer clears it', async () => {
      const { bar } = await approveOpenReview();
      await waitFor(() => expect(verdictButton('Approved')).toBeEnabled());
      fireEvent.click(verdictButton('Approved'));
      await waitFor(() => expect(verdictButton('Approve')).toBeVisible());
      // The server broadcasts this when the approval changes.
      await act(async () => watch.approvalChanged?.());
      expect(
        await within(bar).findByRole('button', { name: 'task-a, Needs a verdict' }),
      ).toBeVisible();
      expect(openTabMark()).toHaveClass('lucide-circle');
      expect(bar).toHaveTextContent('2 need a verdict');
    });

    // The agent recaptures to address the comments, so the countdown must outlive it.
    it('keeps its verdict and its next step through a recapture, which the approval follows', async () => {
      const { bar, state } = await approveOpenReview();
      state.capture = { ...state.capture, version: 2, patchDigest: 'b'.repeat(64) };
      // Resolves once the page has read the new capture.
      await act(async () => watch.captureChanged?.('task-a'));
      expect(await within(bar).findByRole('button', { name: 'task-a, Approved' })).toBeVisible();
      expect(openTabMark()).toHaveClass('lucide-check');
      expect(bar).toHaveTextContent('1 needs a verdict');
      expect(nextStep()).toHaveTextContent('Switching to task-b');
    });
  });

  it('counts down and opens the next review without a verdict', async () => {
    fixture();
    renderApp();
    await waitFor(() => expect(verdictButton('Approve')).toBeEnabled());
    fireEvent.click(verdictButton('Approve'));
    await waitFor(() => expect(nextStep()).toHaveTextContent('Switching to task-b in 10s'));
    const bar = screen.getByRole('navigation', { name: 'Reviews on this server' });
    expect(within(bar).getByRole('button', { name: 'task-b, Needs a verdict' })).toHaveClass(
      /verdict-pulse-/,
    );
    await act(async () => void (await vi.advanceTimersByTimeAsync(10_000)));
    await waitFor(() => expect(window.location.search).toBe('?review=task-b'));
    expect(screen.queryByRole('status', { name: 'Next step' })).not.toBeInTheDocument();
  });

  it('ends the countdown when the reviewer opens the next review from its tab', async () => {
    fixture();
    const close = vi.spyOn(window, 'close').mockImplementation(() => {});
    renderApp();
    const bar = await screen.findByRole('navigation', { name: 'Reviews on this server' });
    fireEvent.click(await within(bar).findByRole('button', { name: 'task-b, Needs a verdict' }));
    await waitFor(() => expect(window.location.search).toBe('?review=task-b'));
    await waitFor(() => expect(verdictButton('Approve')).toBeEnabled());
    fireEvent.click(verdictButton('Approve'));
    await waitFor(() => expect(nextStep()).toHaveTextContent('Switching to task-a in 10s'));
    // The bar remounts on every review switch.
    const barNow = screen.getByRole('navigation', { name: 'Reviews on this server' });
    fireEvent.click(within(barNow).getByRole('button', { name: 'task-a, Needs a verdict' }));
    await waitFor(() => expect(window.location.search).toBe('?review=task-a'));
    await waitFor(() => expect(verdictButton('Approve')).toBeEnabled());
    expect(screen.queryByRole('status', { name: 'Next step' })).not.toBeInTheDocument();
    await act(async () => void (await vi.advanceTimersByTimeAsync(10_000)));
    expect(close).not.toHaveBeenCalled();
  });

  it('rejects in one click, then counts down to closing the tab once nothing is left', async () => {
    const state = fixture();
    state.showReviewB = false;
    const close = vi.spyOn(window, 'close').mockImplementation(() => {});
    renderApp();
    await waitFor(() => expect(verdictButton('Reject')).toBeEnabled());
    fireEvent.click(verdictButton('Reject'));
    await waitFor(() =>
      expect(nextStep()).toHaveTextContent('This review has a verdict. Closing this tab in 10s'),
    );
    expect(fetch).toHaveBeenCalledWith(
      '/api/review-ops?review=task-a',
      expect.objectContaining({ method: 'POST', body: expect.stringContaining('"reject"') }),
    );
    expect(verdictButton('Reject')).toHaveAttribute('aria-pressed', 'true');
    await act(async () => void (await vi.advanceTimersByTimeAsync(10_000)));
    expect(close).toHaveBeenCalledOnce();
    expect(nextStep()).toHaveTextContent('This review has a verdict. You can close this tab.');
  });

  it.each(['Approve', 'Reject'])(
    'requires a resume prompt before closing a Codex review after %s',
    async (verdict) => {
      const state = fixture();
      state.verdictB = 'approve';
      state.reviewContext = {
        source: 'git',
        workingDirectory: '/repo',
        hostname: 'host',
        agent: 'Codex desktop',
      };
      const close = vi.spyOn(window, 'close').mockImplementation(() => {});
      vi.mocked(copyTextToClipboard).mockClear();
      renderApp();
      await waitFor(() => expect(verdictButton(verdict)).toBeEnabled());
      fireEvent.click(verdictButton(verdict));
      await waitFor(() => expect(nextStep()).toHaveTextContent('All 2 reviews have a verdict.'));
      await act(async () => void (await vi.advanceTimersByTimeAsync(20_000)));
      expect(close).not.toHaveBeenCalled();
      expect(copyTextToClipboard).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Copy resume prompt and close' }));
      await waitFor(() => expect(close).toHaveBeenCalledOnce());
      expect(copyTextToClipboard).toHaveBeenCalledWith(expect.stringContaining('comment snapshot'));
      expect(nextStep()).toHaveTextContent("Resume prompt copied. Paste it into the agent's chat");
    },
  );

  // The send settles 2 seconds after the verdict, so the failure arrives during the countdown.
  it('keeps the tab open with the resume prompt when the last verdict did not reach the agent', async () => {
    const state = fixture();
    state.showReviewB = false;
    state.inbox = { status: 'ready' };
    const close = vi.spyOn(window, 'close').mockImplementation(() => {});
    vi.mocked(copyTextToClipboard).mockClear();
    renderApp();
    await waitFor(() => expect(verdictButton('Approve')).toBeEnabled());
    fireEvent.click(verdictButton('Approve'));
    await waitFor(() =>
      expect(nextStep()).toHaveTextContent('This review has a verdict. Closing this tab in 10s'),
    );
    await act(async () => void (await vi.advanceTimersByTimeAsync(2_000)));
    state.inbox = { status: 'failed', at: '2026-11-11T17:00:00.000Z', error: 'connect ENOENT' };
    await act(async () => {
      await watch.inboxChanged?.();
    });
    await act(async () => void (await vi.advanceTimersByTimeAsync(20_000)));
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Copy resume prompt and close' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(copyTextToClipboard).toHaveBeenCalledWith(expect.stringContaining('comment snapshot'));
    expect(nextStep()).toHaveTextContent("Paste it into the agent's chat that opened this review");
  });

  it('asks before leaving while a review has no verdict, and pulses its tab', async () => {
    const state = fixture();
    renderApp();
    const bar = await screen.findByRole('navigation', { name: 'Reviews on this server' });
    await waitFor(() => expect(bar).toHaveTextContent('2 need a verdict'));
    const leave = new Event('beforeunload', { cancelable: true });
    act(() => void window.dispatchEvent(leave));
    expect(leave.defaultPrevented).toBe(true);
    expect(within(bar).getByRole('button', { name: 'task-b, Needs a verdict' })).toHaveClass(
      /verdict-pulse-/,
    );

    state.showReviewB = false;
    state.verdict = 'approve';
    await act(async () => watch.approvalChanged?.());
    await waitFor(() =>
      expect(screen.queryByRole('navigation', { name: 'Reviews on this server' })).toBeNull(),
    );
    const leaveAgain = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaveAgain);
    expect(leaveAgain.defaultPrevented).toBe(false);
  });
});
