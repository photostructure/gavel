import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { HotkeysProvider } from 'react-hotkeys-hook';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom';

import { mockFetch } from '../../vitest.setup';
import type { DiffCommentThread, DiffResponse } from '../types/diff';
import type { ClientWatchState } from '../types/watch';
import { DiffMode } from '../types/watch';

import App from './App';
import { MEDIA_QUERIES } from './constants/breakpoints';
import { useDiffComments } from './hooks/useDiffComments';
import { useFileWatch } from './hooks/useFileWatch';
import { MockWebSocket } from './utils/liveConnection.testing';
import { useViewedFiles } from './hooks/useViewedFiles';
import { useViewport } from './hooks/useViewport';
import {
  readClientSettings,
  resetClientSettingsForTests,
  saveClientSettings,
} from './services/userSettings';

async function openViewMenu() {
  const button = await screen.findByRole('button', { name: 'View' });
  if (!screen.queryByRole('button', { name: 'Unified' })) fireEvent.click(button);
}

// Mock the useViewport hook
vi.mock('./hooks/useViewport', () => ({
  useViewport: vi.fn(() => ({ isMobile: false, isDesktop: true })),
}));

// Mock the useDiffComments hook
vi.mock('./hooks/useDiffComments', () => ({
  useDiffComments: vi.fn(() => ({
    deletedComments: [],
    restoreComment: vi.fn(),
    hasLoadedComments: true,
    comments: [],
    threads: mockComments,
    replaceThreads: mockReplaceThreads,
    addComment: vi.fn(),
    addThread: vi.fn(),
    addReviewThread: vi.fn(),
    toggleThreadResolved: vi.fn(),
    removeComment: vi.fn(),
    removeThread: vi.fn(),
    removeMessage: vi.fn(),
    replyToThread: vi.fn(),
    updateComment: vi.fn(),
    updateMessage: vi.fn(),
    setThreadQuestion: vi.fn(),
    clearAllComments: mockClearAllComments,
    applyCommentImports: mockApplyCommentImports,
    generatePrompt: vi.fn(),
    generateThreadPrompt: vi.fn(),
    generateAllCommentsPrompt: mockGenerateAllCommentsPrompt,
  })),
}));

// Mock the useViewedFiles hook
const mockClearViewedFiles = vi.fn();
const mockToggleFileViewed = vi.fn();
let mockViewedFiles = new Set<string>();
let mockChangedSinceViewedFiles = new Set<string>();
let mockHasLoadedInitialViewedFiles = true;
vi.mock('./hooks/useViewedFiles', () => ({
  useViewedFiles: vi.fn(() => ({
    viewedFiles: mockViewedFiles,
    changedSinceViewedFiles: mockChangedSinceViewedFiles,
    hasLoadedInitialViewedFiles: mockHasLoadedInitialViewedFiles,
    toggleFileViewed: mockToggleFileViewed,
    isFileContentChanged: vi.fn(),
    getViewedFileRecord: vi.fn(),
    clearViewedFiles: mockClearViewedFiles,
  })),
}));

const mockWatchState: ClientWatchState = {
  isWatchEnabled: true,
  diffMode: DiffMode.DEFAULT,
  shouldReload: false,
  isReloading: false,
  lastChangeTime: null,
  lastChangeType: null,
  connectionStatus: 'connected',
};

vi.mock('./hooks/useFileWatch', () => ({
  useFileWatch: vi.fn((onReload?: () => Promise<void>) => ({
    shouldReload: mockWatchState.shouldReload,
    isConnected: true,
    error: null,
    reload: vi.fn(async () => {
      if (onReload) {
        await onReload();
      }
      mockWatchState.shouldReload = false;
      mockWatchState.lastChangeType = null;
    }),
    watchState: mockWatchState,
  })),
}));

// Mock navigator.sendBeacon
Object.defineProperty(navigator, 'sendBeacon', {
  writable: true,
  value: vi.fn(),
});

// Mock window.confirm
const mockConfirm = vi.fn();
Object.defineProperty(window, 'confirm', {
  writable: true,
  value: mockConfirm,
});

Object.defineProperty(window, 'WebSocket', { writable: true, value: MockWebSocket });

let mockComments: DiffCommentThread[] = [];
const mockReplaceThreads = vi.fn();
const mockClearAllComments = vi.fn();
const mockApplyCommentImports = vi.fn(() => []);
const mockGenerateAllCommentsPrompt = vi.fn(() => 'formatted prompt');

function createMockThread({
  id,
  filePath,
  line,
  body,
  author = 'User',
}: {
  id: string;
  filePath: string;
  line: number;
  body: string;
  author?: string;
}): DiffCommentThread {
  const timestamp = '2024-01-01T00:00:00.000Z';
  return {
    id,
    filePath,
    createdAt: timestamp,
    updatedAt: timestamp,
    position: { side: 'new', line },
    messages: [
      {
        id,
        body,
        author,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
  };
}

// Helper to render App with HotkeysProvider
const renderApp = () => {
  return render(
    <HotkeysProvider initiallyActiveScopes={['navigation']}>
      <App />
    </HotkeysProvider>,
  );
};

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
  resetClientSettingsForTests();
  vi.unstubAllEnvs();
  MockWebSocket.instances = [];
  mockViewedFiles = new Set<string>();
  mockChangedSinceViewedFiles = new Set<string>();
  mockHasLoadedInitialViewedFiles = true;
  mockReplaceThreads.mockReset();
  mockGenerateAllCommentsPrompt.mockClear();
});

const mockDiffResponse: DiffResponse = {
  commit: 'abc123',
  baseCommitish: 'HEAD^',
  targetCommitish: 'HEAD',
  requestedBaseCommitish: 'HEAD^',
  requestedTargetCommitish: 'HEAD',
  files: [
    {
      path: 'test.ts',
      status: 'modified',
      additions: 5,
      deletions: 2,
      chunks: [],
    },
  ],
  ignoreWhitespace: false,
  isEmpty: false,
};

it('opens the detailed comparison picker and changes the diff only after Apply', async () => {
  mockFetch(mockDiffResponse, {
    specialOptions: [],
    commits: [],
    branches: [{ name: 'main', current: true }],
  });
  renderApp();
  fireEvent.click(await screen.findByRole('button', { name: /^Revision menu:/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Detailed...' }));
  expect(await screen.findByRole('heading', { name: 'Detailed Diff' })).toBeVisible();
  const diffRequests = () =>
    vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith('/api/diff'));
  const beforeSelection = diffRequests().length;
  fireEvent.click(screen.getByRole('button', { name: /^Base:/ }));
  fireEvent.click(screen.getByRole('button', { name: 'main (current)' }));
  expect(diffRequests()).toHaveLength(beforeSelection);
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() =>
    expect(
      diffRequests().some(([url]) => {
        const params = new URL(String(url), window.location.origin).searchParams;
        return params.get('base') === 'main' && params.get('target') === 'HEAD';
      }),
    ).toBe(true),
  );
  expect(screen.queryByRole('heading', { name: 'Detailed Diff' })).not.toBeInTheDocument();
});

it('filters stdin whitespace locally without replacing the canonical patch', async () => {
  vi.clearAllMocks();
  mockComments = [];
  const response: DiffResponse = {
    ...mockDiffResponse,
    baseCommitish: 'stdin',
    targetCommitish: 'stdin',
    requestedBaseCommitish: 'stdin',
    requestedTargetCommitish: 'stdin',
    files: [
      {
        path: 'stdin.ts',
        status: 'modified',
        additions: 1,
        deletions: 1,
        chunks: [
          {
            header: '@@ -1 +1 @@',
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            lines: [
              { type: 'delete', content: 'const value = 1;', oldLineNumber: 1 },
              { type: 'add', content: '  const value = 1;  ', newLineNumber: 1 },
            ],
          },
        ],
      },
    ],
  };
  mockFetch(response);
  renderApp();
  await screen.findByText('Whitespace-only changes hidden');
  expect(document.querySelectorAll('[data-diff-line-row="true"]')).toHaveLength(0);
  const diffRequests = () =>
    vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith('/api/diff'));
  const requestsBefore = diffRequests().length;
  await openViewMenu();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Ignore Whitespace' }));
  await waitFor(() =>
    expect(document.querySelectorAll('[data-diff-line-row="true"]').length).toBeGreaterThan(0),
  );
  expect(diffRequests()).toHaveLength(requestsBefore);
  expect(vi.mocked(useViewedFiles).mock.lastCall?.[4]).toEqual(response.files);
});

describe('App Component - Clear Comments Functionality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockComments = [];
    mockApplyCommentImports.mockReset();
    mockApplyCommentImports.mockReturnValue([]);
    mockConfirm.mockReturnValue(false);
    mockFetch(mockDiffResponse);
  });

  it('keeps Conversation open when an empty general composer loses focus to a thread action', async () => {
    const root = createMockThread({
      id: 'general',
      filePath: 'test.ts',
      line: 1,
      body: 'General question',
    });
    mockComments = [
      {
        id: root.id,
        scope: 'review',
        createdAt: root.createdAt,
        updatedAt: root.updatedAt,
        messages: root.messages,
      },
    ];
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: 'Conversation' }));
    expect(screen.getByPlaceholderText('Comment or ask about this review…')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse thread' }));
    expect(screen.getByRole('dialog', { name: 'Conversation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand thread' })).toBeInTheDocument();
  });

  it('shows server-provided repository context on mobile', async () => {
    vi.mocked(useViewport).mockReturnValue({ isMobile: true, isDesktop: false });
    mockFetch({
      ...mockDiffResponse,
      reviewContext: {
        source: 'git',
        repositoryName: 'example-project',
        repositoryPath: '/worktrees/review',
        workingDirectory: '/worktrees/review/src',
        hostname: 'build-host',
      },
    });
    renderApp();
    expect(screen.queryByRole('region', { name: 'Review context' })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'About' }));
    expect(await screen.findByRole('region', { name: 'Review context' })).toBeVisible();
    expect(screen.getByText('example-project')).toBeVisible();
    expect(document.title).toBe(`example-project — gavel (${window.location.host})`);
    expect(screen.getByText('Files changed (1)')).toBeVisible();
    vi.mocked(useViewport).mockReturnValue({ isMobile: false, isDesktop: true });
  });

  it('opens Conversation before any comments exist', async () => {
    mockComments = [];
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: 'Conversation' }));
    expect(screen.getByRole('dialog', { name: 'Conversation' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Comment or ask about this review…')).toBeInTheDocument();
  });

  it('hides the review header while the diff scrolls down on a touch screen', async () => {
    const matchMedia = window.matchMedia.bind(window);
    const spy = vi.spyOn(window, 'matchMedia').mockImplementation((query) =>
      query === MEDIA_QUERIES.autoHideHeader
        ? ({
            matches: true,
            addEventListener: () => {},
            removeEventListener: () => {},
          } as unknown as MediaQueryList)
        : matchMedia(query),
    );
    try {
      renderApp();
      const settings = await screen.findByRole('button', { name: 'Settings' });
      const chrome = screen.getByTestId('review-chrome');
      const diff = screen.getByRole('main');
      Object.defineProperty(diff, 'scrollHeight', { value: 5000 });
      Object.defineProperty(diff, 'clientHeight', { value: 300 });
      Object.defineProperty(diff, 'scrollTop', { value: 200 });
      fireEvent.scroll(diff);
      expect(chrome).toHaveAttribute('data-hidden', 'true');
      act(() => settings.focus());
      expect(chrome).toHaveAttribute('data-hidden', 'false');
    } finally {
      spy.mockRestore();
    }
  });

  it('highlights the sidebar row of the file at the top of the scrolled diff', async () => {
    const file = (path: string) => ({
      path,
      status: 'modified' as const,
      additions: 1,
      deletions: 1,
      chunks: [],
    });
    mockFetch({ ...mockDiffResponse, files: [file('first.ts'), file('second.ts')] });
    renderApp();
    const firstRow = (await screen.findByTitle('first.ts')).closest('[data-file-row]');
    const secondRow = screen.getByTitle('second.ts').closest('[data-file-row]');
    const diff = screen.getByRole('main');

    // first.ts spans 0–400 in the diff, second.ts 424–824
    let scrollTop = 0;
    const rect = (top: number, height: number) =>
      ({ top, bottom: top + height, height }) as DOMRect;
    const spy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        if (this === diff) return rect(0, 600);
        if (this.dataset.filePath === 'first.ts') return rect(-scrollTop, 400);
        if (this.dataset.filePath === 'second.ts') return rect(424 - scrollTop, 400);
        return rect(0, 0);
      });
    const scrollTo = async (top: number) => {
      scrollTop = top;
      fireEvent.scroll(diff);
      await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    };
    try {
      await scrollTo(10);
      expect(firstRow).toHaveClass('file-tree-row-selected');
      expect(secondRow).not.toHaveClass('file-tree-row-selected');

      await scrollTo(500);
      expect(firstRow).not.toHaveClass('file-tree-row-selected');
      expect(secondRow).toHaveClass('file-tree-row-selected');
    } finally {
      spy.mockRestore();
    }
  });

  describe('Copy All Prompt Button', () => {
    it('should generate Copy All Prompt with requested and resolved diff context', async () => {
      mockComments = [
        createMockThread({ id: 'test-1', filePath: 'test.ts', line: 10, body: 'Test comment' }),
      ];
      mockFetch({
        ...mockDiffResponse,
        baseCommitish: 'abcdef1',
        targetCommitish: '1234567',
        requestedBaseCommitish: 'main',
        requestedTargetCommitish: 'feature/docs-update',
        requestedBaseMode: 'merge-base',
      });

      renderApp();

      fireEvent.click(await screen.findByRole('button', { name: 'Conversation' }));
      fireEvent.click(await screen.findByText(/Copy All Prompt/));

      await waitFor(() => {
        expect(mockGenerateAllCommentsPrompt).toHaveBeenCalledWith({
          requestedBaseCommitish: 'main',
          requestedTargetCommitish: 'feature/docs-update',
          baseMode: 'merge-base',
          resolvedBaseCommitish: 'abcdef1',
          resolvedTargetCommitish: '1234567',
        });
      });
    });
  });

  describe('Cleanup All Prompt Button', () => {
    it('should not show delete button when no comments exist', async () => {
      mockComments = [];

      renderApp();

      await waitFor(() => {
        // Cleanup All Prompt should not be visible without comments (dropdown doesn't exist)
        expect(screen.queryByText('Copy All Prompt')).not.toBeInTheDocument();
        expect(screen.queryByText('Cleanup All Prompt')).not.toBeInTheDocument();
      });
    });

    it('should show delete button when comments exist', async () => {
      mockComments = [
        createMockThread({ id: 'test-1', filePath: 'test.ts', line: 10, body: 'Test comment' }),
      ];

      renderApp();

      fireEvent.click(await screen.findByRole('button', { name: 'Conversation' }));
      await waitFor(() => {
        // Find and click the dropdown toggle button (chevron)
        const dropdownToggle = screen.getByTitle('More options');
        fireEvent.click(dropdownToggle);
      });

      await waitFor(() => {
        expect(screen.getByText('Cleanup All Prompt')).toBeInTheDocument();
      });
    });

    it('should call clearAllComments immediately when delete button is clicked', async () => {
      mockComments = [
        createMockThread({ id: '1', filePath: 'test.ts', line: 10, body: 'Comment 1' }),
        createMockThread({ id: '2', filePath: 'test.ts', line: 20, body: 'Comment 2' }),
      ];

      renderApp();

      fireEvent.click(await screen.findByRole('button', { name: 'Conversation' }));
      await waitFor(() => {
        // First, open the dropdown
        const dropdownToggle = screen.getByTitle('More options');
        fireEvent.click(dropdownToggle);
      });

      await waitFor(() => {
        const deleteButton = screen.getByText('Cleanup All Prompt');
        fireEvent.click(deleteButton);
      });

      expect(mockClearAllComments).toHaveBeenCalled();
    });
  });

  describe('Clean flag on Startup', () => {
    it('should clear existing comments when clearComments flag is true in response', async () => {
      const responseWithClearFlag: DiffResponse = {
        ...mockDiffResponse,
        clearComments: true,
      };

      mockFetch(responseWithClearFlag);

      renderApp();

      await waitFor(() => {
        expect(mockClearAllComments).toHaveBeenCalledWith({
          resetAppliedCommentImportIds: true,
        });
      });
    });

    it('should clear viewed files when clearComments flag is true in response', async () => {
      const responseWithClearFlag: DiffResponse = {
        ...mockDiffResponse,
        clearComments: true,
      };

      mockFetch(responseWithClearFlag);

      renderApp();

      await waitFor(() => {
        expect(mockClearViewedFiles).toHaveBeenCalled();
      });
    });

    it('should not clear comments when clearComments flag is false', async () => {
      const responseWithoutClearFlag: DiffResponse = {
        ...mockDiffResponse,
        clearComments: false,
      };

      mockFetch(responseWithoutClearFlag);

      renderApp();

      await waitFor(() => {
        expect(mockClearAllComments).not.toHaveBeenCalled();
      });
    });

    it('should not clear comments when clearComments flag is undefined', async () => {
      const responseWithoutFlag: DiffResponse = {
        ...mockDiffResponse,
        // clearComments is undefined
      };

      mockFetch(responseWithoutFlag);

      renderApp();

      await waitFor(() => {
        expect(mockClearAllComments).not.toHaveBeenCalled();
      });
    });

    it('should log message when clearing comments via CLI flag', async () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const responseWithClearFlag: DiffResponse = {
        ...mockDiffResponse,
        clearComments: true,
      };

      mockFetch(responseWithClearFlag);

      renderApp();

      await waitFor(() => {
        expect(consoleLogSpy).toHaveBeenCalledWith(
          '✅ All existing comments and viewed files cleared as requested via --clean flag',
        );
      });

      consoleLogSpy.mockRestore();
    });

    it('hydrates comments from the server comment session on startup', async () => {
      const serverThreads = [
        createMockThread({
          id: 'imported-thread',
          filePath: 'test.ts',
          line: 10,
          body: 'Imported comment',
        }),
      ];

      vi.mocked(global.fetch).mockImplementation((input) => {
        const url = String(input);

        if (url.startsWith('/api/comments-json')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ threads: serverThreads }),
          } as Response);
        }

        if (url.startsWith('/api/comments')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ success: true }),
          } as Response);
        }

        if (url === '/api/revisions') {
          return Promise.resolve({
            ok: true,
            json: async () => null,
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          json: async () => mockDiffResponse,
          blob: async () => ({ size: 1024 }),
        } as Response);
      });

      renderApp();

      await waitFor(() => {
        expect(mockReplaceThreads).toHaveBeenCalledWith(serverThreads);
      });

      expect(vi.mocked(global.fetch)).toHaveBeenCalledWith(
        '/api/comments-json?base=HEAD%5E&target=HEAD',
      );
    });

    it('preserves server-provided comments after clearing local comments on startup', async () => {
      mockComments = [
        createMockThread({
          id: 'stale-local-thread',
          filePath: 'test.ts',
          line: 5,
          body: 'Stale local comment',
        }),
      ];
      const serverThreads = [
        createMockThread({
          id: 'imported-thread',
          filePath: 'test.ts',
          line: 10,
          body: 'Imported comment',
        }),
      ];
      const responseWithClearFlag: DiffResponse = {
        ...mockDiffResponse,
        clearComments: true,
      };

      vi.mocked(global.fetch).mockImplementation((input) => {
        const url = String(input);

        if (url.startsWith('/api/comments-json')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ threads: serverThreads }),
          } as Response);
        }

        if (url.startsWith('/api/comments')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ success: true }),
          } as Response);
        }

        if (url === '/api/revisions') {
          return Promise.resolve({
            ok: true,
            json: async () => null,
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          json: async () => responseWithClearFlag,
          blob: async () => ({ size: 1024 }),
        } as Response);
      });

      renderApp();

      await waitFor(() => {
        expect(mockClearAllComments).toHaveBeenCalledWith({
          resetAppliedCommentImportIds: true,
        });
      });

      await waitFor(() => {
        expect(mockReplaceThreads).toHaveBeenCalledWith(serverThreads);
      });

      expect(mockReplaceThreads).not.toHaveBeenCalledWith([...serverThreads, ...mockComments]);
    });
  });
});

describe('App Component - Heartbeat Connection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockComments = [];
    mockConfirm.mockReturnValue(false);
    mockFetch(mockDiffResponse);
  });

  it('opens the live connection on the direct API url when configured in development', async () => {
    vi.stubEnv('VITE_GAVEL_API_URL', 'http://localhost:4969');

    renderApp();

    await waitFor(() => {
      expect(MockWebSocket.instances[0]?.url).toMatch(/^ws:\/\/localhost:4969\/api\/live\?tab=/);
    });
  });
});

describe('App Component - Header display controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockComments = [];
    mockConfirm.mockReturnValue(false);
    mockFetch(mockDiffResponse);
  });

  // The file list shows the count; the header copy, shown only while the list was closed,
  // took header space the maintainer did not find worth it.
  it('leaves the files-viewed count out of the header, even with the file list closed', async () => {
    renderApp();
    const header = await screen.findByTestId('compact-review-header');
    await screen.findByText(/^\d+ \/ \d+ files viewed$/);
    const toggle = screen.getByRole('button', { name: 'Toggle file tree panel' });
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'false'));

    expect(within(header).queryByRole('status', { name: 'Files viewed' })).toBeNull();
    expect(within(header).queryByText(/\d+\/\d+/)).toBeNull();
  });

  it('switches between dark and light themes from the Settings button', async () => {
    renderApp();

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Light' }));

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    });
  });
});

describe('App Component - Diff load errors', () => {
  it("shows the server's explanation when the diff fails to load", async () => {
    vi.mocked(global.fetch).mockImplementation(async (url) =>
      String(url).startsWith('/api/diff')
        ? ({
            ok: false,
            status: 500,
            json: async () => ({ error: '/home/u/.gavel/config.json is not valid JSON' }),
          } as Response)
        : ({ ok: false, status: 404, json: async () => ({}) } as Response),
    );

    renderApp();

    expect(
      await screen.findByText('/home/u/.gavel/config.json is not valid JSON'),
    ).toBeInTheDocument();
  });

  it('falls back to a generic message when the error page is not JSON', async () => {
    vi.mocked(global.fetch).mockImplementation(
      async () =>
        ({
          ok: false,
          status: 400,
          json: async () => {
            throw new SyntaxError("Unexpected token '<'");
          },
        }) as unknown as Response,
    );

    renderApp();

    expect(await screen.findByText('Failed to fetch diff data')).toBeInTheDocument();
  });
});

describe('App Component - Settings the browser refuses to keep', () => {
  afterEach(() => {
    delete (document as { cookie?: string }).cookie;
  });

  it('says so in the header and keeps the page', async () => {
    mockFetch(mockDiffResponse);
    // As Chromium does in a cross-site frame, or with cookies blocked.
    Object.defineProperty(document, 'cookie', { configurable: true, get: () => '', set: () => {} });
    renderApp();

    fireEvent.click(await screen.findByRole('button', { name: /toggle file tree panel/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/did not keep/);
    expect(screen.getByRole('button', { name: /toggle file tree panel/i })).toBeInTheDocument();
  });
});

describe('App Component - Auto-viewed patterns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockComments = [];
    mockConfirm.mockReturnValue(false);
  });

  it('auto-marks files with the patterns saved on the server', async () => {
    mockFetch({ ...mockDiffResponse, autoViewedPatterns: ['*.snap'] });
    renderApp();

    await waitFor(() => {
      expect(vi.mocked(useViewedFiles).mock.lastCall?.[6]).toEqual(['*.snap']);
    });
  });

  it('saves edited patterns to the server and uses them', async () => {
    mockFetch({ ...mockDiffResponse, autoViewedPatterns: ['*.snap'] });
    renderApp();

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('button', { name: /^System/ }));
    const textarea = screen.getByLabelText('Auto-Mark Viewed Patterns');
    expect(textarea).toHaveValue('*.snap');
    fireEvent.change(textarea, { target: { value: 'vendor/**' } });

    expect(vi.mocked(useViewedFiles).mock.lastCall?.[6]).toEqual(['vendor/**']);
    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        '/api/auto-viewed-patterns',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ patterns: ['vendor/**'] }),
        }),
      );
    });
  });
});

describe('App Component - Editor launch', () => {
  it.each([
    { name: 'from the launch URL', navigateToAnchor: false },
    { name: 'after in-page fragment navigation', navigateToAnchor: true },
  ])('sends only the file and line $name', async ({ navigateToAnchor }) => {
    vi.clearAllMocks();
    mockComments = [];
    window.history.replaceState({}, '', '/#gavel-editor-token=test-capability');
    mockFetch({
      ...mockDiffResponse,
      files: [
        {
          ...mockDiffResponse.files[0]!,
          chunks: [
            {
              header: '@@ -1 +1 @@',
              oldStart: 1,
              oldLines: 0,
              newStart: 1,
              newLines: 1,
              lines: [{ type: 'add', content: 'const value = 1;', newLineNumber: 1 }],
            },
          ],
        },
      ],
    });

    const { container, rerender } = renderApp();
    await waitFor(() => {
      expect(container.querySelector('[data-diff-line-row="true"]')).not.toBeNull();
    });
    if (navigateToAnchor) {
      window.history.replaceState({}, '', '/#guide');
      rerender(
        <HotkeysProvider initiallyActiveScopes={['navigation']}>
          <App />
        </HotkeysProvider>,
      );
    }
    fireEvent.mouseEnter(container.querySelector('[data-diff-line-row="true"]')!.children[2]!);
    await waitFor(() => {
      expect(container.querySelector('button[title="Open in editor"]')).not.toBeNull();
    });
    fireEvent.click(container.querySelector('button[title="Open in editor"]')!);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/open-in-editor',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'X-Gavel-Editor-Token': 'test-capability' }),
          body: JSON.stringify({ filePath: mockDiffResponse.files[0]!.path, line: 1 }),
        }),
      );
    });
    window.history.replaceState({}, '', '/');
  });
});

describe('App Component - Ship it', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockComments = [];
  });

  it('hides the Ship it button unless the server enables it', async () => {
    mockFetch(mockDiffResponse);

    renderApp();

    await screen.findByText('0 / 1 files viewed');
    expect(
      screen.queryByRole('button', { name: /^(Approve as-is|Approved as-is)$/ }),
    ).not.toBeInTheDocument();
  });

  it('approves from the as-is button and clears the approval by clicking it again', async () => {
    mockFetch({ ...mockDiffResponse, shipIt: true });

    renderApp();
    const button = await screen.findByRole('button', { name: /^(Approve as-is|Approved as-is)$/ });
    await waitFor(() => expect(button).toBeEnabled());
    expect(button).toHaveTextContent(/^Approve as-is$/);
    expect(button.querySelector('img')).toBeNull();
    expect(button).toHaveAttribute('title', 'Approve the reviewed patch as-is');
    fireEvent.click(button);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/approval?base=HEAD%5E&target=HEAD', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: true, summaryVersion: 0 }),
      });
    });
    await waitFor(() => expect(button).toHaveTextContent(/^Approved as-is$/));
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('title', 'Clear this verdict');
    expect(button.querySelector('img')).toBeNull();
    expect(screen.queryByText('Shipped')).not.toBeInTheDocument();
    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveTextContent(/^Approve as-is$/));
    expect(screen.queryByRole('status', { name: 'Next step' })).not.toBeInTheDocument();
    expect(button).toHaveTextContent(/^Approve as-is$/);
    expect(button).toHaveAttribute('title', 'Approve the reviewed patch as-is');
    expect(button).toBeEnabled();
    expect(button.querySelector('img')).toBeNull();
    expect(global.fetch).toHaveBeenCalledWith('/api/approval?base=HEAD%5E&target=HEAD', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved: false }),
    });
  });

  it('edits review intent and waits for the summary to be saved before any verdict', async () => {
    mockFetch({ ...mockDiffResponse, shipIt: true });
    renderApp();
    const approval = await screen.findByRole('button', {
      name: /^(Approve as-is|Approved as-is)$/,
    });
    const notYet = screen.getByRole('button', { name: 'Not yet' });
    await waitFor(() => expect(approval).toBeEnabled());
    expect(notYet).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /Change summary/ }));
    fireEvent.change(screen.getByLabelText('Why this change'), {
      target: { value: 'Reviewers need to understand the proposed commit.' },
    });
    fireEvent.change(screen.getByLabelText('Proposed commit message'), {
      target: { value: 'feat: explain the proposed commit' },
    });
    expect(approval).toBeDisabled();
    // Not yet moves on to another review or closes the tab, which would drop the unsaved draft.
    expect(notYet).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save summary' }));
    await waitFor(() => expect(approval).toBeEnabled());
    expect(notYet).toBeEnabled();
    expect(global.fetch).toHaveBeenCalledWith('/api/review-summary?base=HEAD%5E&target=HEAD', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commitMessage: 'feat: explain the proposed commit',
        rationale: 'Reviewers need to understand the proposed commit.',
        baseVersion: 0,
      }),
    });
    expect(screen.getByText('Saved for this review')).toBeInTheDocument();
    fireEvent.click(approval);
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith('/api/approval?base=HEAD%5E&target=HEAD', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: true, summaryVersion: 1 }),
      }),
    );
  });
});

describe('App Component - Approval celebration', () => {
  let bursts = 0;
  /** While set, approval POSTs wait for this promise before the server answers. */
  let approvalPostGate: Promise<void> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    mockComments = [];
    bursts = 0;
    approvalPostGate = null;
    // happy-dom has no 2D context; a stand-in lets each burst get past that check so it can be counted.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      bursts++;
      return new Proxy(
        {},
        {
          get: (_target, key) =>
            key === 'createRadialGradient' || key === 'createLinearGradient'
              ? () => ({ addColorStop: () => {} })
              : () => undefined,
          set: () => true,
        },
      ) as never;
    });
    const approvals = new Map<string, boolean>();
    vi.mocked(global.fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.startsWith('/api/review-summary')) {
        return Promise.resolve(Response.json({ commitMessage: '', rationale: '', version: 0 }));
      }
      if (url.startsWith('/api/approval')) {
        if (init?.method === 'POST') {
          const approved = Boolean(JSON.parse(String(init.body)).approved);
          return (approvalPostGate ?? Promise.resolve()).then(() => {
            approvals.set(url, approved);
            return Response.json({ approved });
          });
        }
        return Promise.resolve(Response.json({ approved: approvals.get(url) ?? false }));
      }
      if (url.includes('/api/revisions')) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      if (url.startsWith('/api/diff')) {
        const params = new URL(url, 'http://localhost').searchParams;
        const base = params.get('base') ?? 'HEAD^';
        const target = params.get('target') ?? 'HEAD';
        return Promise.resolve(
          Response.json({
            ...mockDiffResponse,
            shipIt: true,
            commit: `${base}...${target}`,
            baseCommitish: base,
            targetCommitish: target,
            requestedBaseCommitish: base,
            requestedTargetCommitish: target,
          }),
        );
      }
      return Promise.resolve(Response.json({}));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const navigate = (search: string) => {
    act(() => {
      window.history.pushState(null, '', `/${search}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
  };
  const approveButton = () =>
    screen.getByRole('button', { name: /^(Approve as-is|Approved as-is)$/ });

  // Before the burst was fired from the click handler, returning to an approved
  // review remounted the celebration and fired a second burst with no click.
  it('fires one burst per approval, not again when returning to an approved review', async () => {
    renderApp();
    await waitFor(() => expect(approveButton()).toBeEnabled());
    fireEvent.click(approveButton());
    await waitFor(() => expect(approveButton()).toHaveTextContent(/^Approved as-is$/));
    expect(bursts).toBe(1);

    navigate('?base=main&target=feature');
    await waitFor(() => expect(window.location.search).toContain('base=main'));
    await waitFor(() => expect(approveButton()).toHaveTextContent(/^Approve as-is$/));

    navigate('?base=HEAD%5E&target=HEAD');
    await waitFor(() => expect(approveButton()).toHaveTextContent(/^Approved as-is$/));
    expect(bursts).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'Verdict options' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Clear verdict' }));
    await waitFor(() => expect(approveButton()).toHaveTextContent(/^Approve as-is$/));
    expect(bursts).toBe(1);
  });

  it('does not celebrate on another review when an earlier approval finishes late', async () => {
    let releaseApprovalPost = () => {};
    approvalPostGate = new Promise((resolve) => {
      releaseApprovalPost = resolve;
    });
    renderApp();
    await waitFor(() => expect(approveButton()).toBeEnabled());
    fireEvent.click(approveButton());
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/approval?base=HEAD%5E&target=HEAD',
        expect.objectContaining({ method: 'POST' }),
      ),
    );

    navigate('?base=main&target=feature');
    await waitFor(() => expect(window.location.search).toContain('base=main'));
    await waitFor(() => expect(approveButton()).toHaveTextContent(/^Approve as-is$/));
    await act(async () => {
      releaseApprovalPost();
      await approvalPostGate;
    });

    await waitFor(() => expect(approveButton()).toBeEnabled());
    expect(approveButton()).toHaveTextContent(/^Approve as-is$/);
    expect(bursts).toBe(0);
  });
});

describe('App Component - Ship it delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockComments = [];
  });

  it('waits for comment bootstrap before enabling approval', async () => {
    mockFetch({ ...mockDiffResponse, shipIt: true });
    const fallback = vi.mocked(global.fetch).getMockImplementation()!;
    vi.mocked(global.fetch).mockImplementation((input, init) => {
      if (String(input).startsWith('/api/comments-json')) {
        return new Promise<Response>(() => {});
      }
      return fallback(input, init);
    });

    renderApp();

    expect(
      await screen.findByRole('button', { name: /^(Approve as-is|Approved as-is)$/ }),
    ).toBeDisabled();
  });

  it('waits for a final comment save and approves the displayed selection', async () => {
    mockFetch({
      ...mockDiffResponse,
      baseCommitish: 'def4567',
      targetCommitish: 'abc1234',
      shipIt: true,
    });
    const fallback = vi.mocked(global.fetch).getMockImplementation()!;
    let finishSave: ((response: Response) => void) | undefined;
    vi.mocked(global.fetch).mockImplementation((input, init) => {
      if (String(input).startsWith('/api/comments?')) {
        return new Promise<Response>((resolve) => {
          finishSave = resolve;
        });
      }
      return fallback(input, init);
    });

    renderApp();
    const button = await screen.findByRole('button', { name: /^(Approve as-is|Approved as-is)$/ });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    await waitFor(() => expect(finishSave).toBeTypeOf('function'));
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/approval'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(button).toBeDisabled();

    await act(async () => {
      finishSave?.({ ok: true, json: async () => ({}) } as Response);
    });
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/approval?base=def4567&target=abc1234', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: true, summaryVersion: 0 }),
      });
    });
  });

  it('keeps approval pending when the final comment save fails', async () => {
    mockFetch({ ...mockDiffResponse, shipIt: true });
    const fallback = vi.mocked(global.fetch).getMockImplementation()!;
    vi.mocked(global.fetch).mockImplementation((input, init) => {
      if (String(input).startsWith('/api/comments?')) {
        return Promise.resolve({ ok: false, status: 500 } as Response);
      }
      return fallback(input, init);
    });

    renderApp();
    const button = await screen.findByRole('button', { name: /^(Approve as-is|Approved as-is)$/ });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the verdict');
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/approval'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(screen.getByRole('button', { name: /^(Approve as-is|Approved as-is)$/ })).toBeEnabled();
  });

  it('reloads the diff when approval is refused because the diff changed', async () => {
    mockFetch({ ...mockDiffResponse, shipIt: true });
    const fallback = vi.mocked(global.fetch).getMockImplementation()!;
    vi.mocked(global.fetch).mockImplementation((input, init) => {
      if (String(input).startsWith('/api/approval') && init?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          status: 409,
          json: async () => ({ error: 'Diff changed', diffDigest: 'f'.repeat(64) }),
        } as Response);
      }
      return fallback(input, init);
    });
    const diffRequests = () =>
      vi.mocked(global.fetch).mock.calls.filter(([input]) => String(input).startsWith('/api/diff'))
        .length;

    renderApp();
    const button = await screen.findByRole('button', { name: /^(Approve as-is|Approved as-is)$/ });
    await waitFor(() => expect(button).toBeEnabled());
    const before = diffRequests();
    fireEvent.click(button);

    expect(await screen.findByRole('alert')).toHaveTextContent('The diff changed');
    await waitFor(() => expect(diffRequests()).toBeGreaterThan(before));
    // Like Reload, re-check viewed files so a viewed file whose diff changed is flagged.
    await waitFor(() => expect(vi.mocked(useViewedFiles).mock.lastCall?.[9]).toBe(1));
  });

  it.each([{ failure: 'http' }, { failure: 'network' }])(
    'allows retry after a $failure approval failure',
    async ({ failure }) => {
      mockFetch({ ...mockDiffResponse, shipIt: true });
      const fallback = vi.mocked(global.fetch).getMockImplementation()!;
      vi.mocked(global.fetch).mockImplementation((input, init) => {
        if (String(input).startsWith('/api/approval') && init?.method === 'POST') {
          return failure === 'network'
            ? Promise.reject(new Error('Connection refused'))
            : Promise.resolve({ ok: false, status: 500 } as Response);
        }
        return fallback(input, init);
      });

      renderApp();
      const button = await screen.findByRole('button', {
        name: /^(Approve as-is|Approved as-is)$/,
      });
      await waitFor(() => expect(button).toBeEnabled());
      fireEvent.click(button);

      expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the verdict');
      expect(
        screen.getByRole('button', { name: /^(Approve as-is|Approved as-is)$/ }),
      ).toBeEnabled();
    },
  );
});

describe('App Component - Initial file collapsing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockComments = [];
    mockConfirm.mockReturnValue(false);
    mockFetch(mockDiffResponse);
    mockViewedFiles = new Set<string>();
    mockHasLoadedInitialViewedFiles = false;
  });

  it.each([false, true])(
    'expands a selected sidebar file without toggling its viewed state (initially viewed: %s)',
    async (initiallyViewed) => {
      mockViewedFiles = new Set(initiallyViewed ? ['test.ts'] : []);
      mockHasLoadedInitialViewedFiles = true;
      mockFetch({
        ...mockDiffResponse,
        files: [
          {
            ...mockDiffResponse.files[0]!,
            chunks: [
              {
                header: '@@ -0,0 +1 @@',
                oldStart: 0,
                oldLines: 0,
                newStart: 1,
                newLines: 1,
                lines: [{ type: 'add', content: 'selected_file_content', newLineNumber: 1 }],
              },
            ],
          },
        ],
      });
      const { container } = renderApp();
      if (!initiallyViewed) {
        fireEvent.click(await screen.findByTitle('Collapse file (Alt+Click to collapse all)'));
      }
      await screen.findByTitle('Expand file (Alt+Click to expand all)');
      expect(container.querySelector('[data-diff-line-row="true"]')).toBeNull();

      const fileRow = await screen.findByTitle('test.ts');
      fireEvent.click(fileRow.closest('[data-file-row]')!);
      await screen.findByTitle('Collapse file (Alt+Click to collapse all)');
      await waitFor(() => {
        expect(container.querySelector('[data-diff-line-row="true"]')).not.toBeNull();
      });

      fireEvent.click(fileRow.closest('[data-file-row]')!);
      expect(screen.getByTitle('Collapse file (Alt+Click to collapse all)')).toBeInTheDocument();
      expect(mockViewedFiles.has('test.ts')).toBe(initiallyViewed);
      expect(mockToggleFileViewed).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Viewed' })).toHaveAttribute(
        'title',
        initiallyViewed ? 'Mark as not reviewed' : 'Mark as reviewed',
      );
    },
  );

  it.each([
    { selectedViewed: true, collapseAfterSelection: false },
    { selectedViewed: true, collapseAfterSelection: true },
    { selectedViewed: false, collapseAfterSelection: false },
    { selectedViewed: false, collapseAfterSelection: true },
  ])(
    'retains sidebar intent through viewed hydration ($selectedViewed, later collapse: $collapseAfterSelection)',
    async ({ selectedViewed, collapseAfterSelection }) => {
      const files = ['selected.ts', 'other-viewed.ts'];
      mockFetch({
        ...mockDiffResponse,
        files: files.map((path) => ({ ...mockDiffResponse.files[0]!, path })),
      });
      const view = renderApp();
      await screen.findByRole('heading', { name: 'selected.ts' });
      const selectedSection = screen
        .getByRole('heading', { name: 'selected.ts' })
        .closest('[data-file-path]')!;
      const otherSection = screen
        .getByRole('heading', { name: 'other-viewed.ts' })
        .closest('[data-file-path]')!;
      // Start collapsed, then select through the real sidebar while hydration is pending.
      fireEvent.click(
        selectedSection.querySelector(
          'button[aria-label="Collapse file (Alt+Click to collapse all)"]',
        )!,
      );
      fireEvent.click(screen.getByTitle('selected.ts').closest('[data-file-row]')!);
      expect(
        selectedSection.querySelector(
          'button[aria-label="Collapse file (Alt+Click to collapse all)"]',
        ),
      ).toBeInTheDocument();
      if (collapseAfterSelection) {
        fireEvent.click(
          selectedSection.querySelector(
            'button[aria-label="Collapse file (Alt+Click to collapse all)"]',
          )!,
        );
      }

      act(() => {
        mockViewedFiles = new Set(selectedViewed ? files : ['other-viewed.ts']);
        mockHasLoadedInitialViewedFiles = true;
        view.rerender(
          <HotkeysProvider initiallyActiveScopes={['navigation']}>
            <App />
          </HotkeysProvider>,
        );
      });

      await waitFor(() => {
        expect(
          otherSection.querySelector('button[aria-label="Expand file (Alt+Click to expand all)"]'),
        ).toBeInTheDocument();
        expect(
          selectedSection.querySelector(
            `button[aria-label="${collapseAfterSelection ? 'Expand file (Alt+Click to expand all)' : 'Collapse file (Alt+Click to collapse all)'}"]`,
          ),
        ).toBeInTheDocument();
      });
      expect(mockToggleFileViewed).not.toHaveBeenCalled();
      expect(selectedSection.querySelector('button[title="Mark as not reviewed"]') !== null).toBe(
        selectedViewed,
      );
    },
  );

  it.each(['comparison', 'capture'] as const)(
    'clears pending sidebar intent when the %s context changes',
    async (context) => {
      const first: DiffResponse = {
        ...mockDiffResponse,
        ...(context === 'capture'
          ? {
              capture: {
                name: 'task',
                version: 1,
                patchDigest: 'a'.repeat(64),
                baseCommit: 'base',
                repositoryId: 'repo',
              },
            }
          : {}),
      };
      if (context === 'capture') window.history.replaceState(null, '', '/?review=task');
      mockFetch(first);
      const view = renderApp();
      fireEvent.click((await screen.findByTitle('test.ts')).closest('[data-file-row]')!);
      expect(screen.getByTitle('Collapse file (Alt+Click to collapse all)')).toBeInTheDocument();

      mockFetch({
        ...first,
        ...(context === 'capture'
          ? { capture: { ...first.capture!, version: 2, patchDigest: 'b'.repeat(64) } }
          : { commit: 'different-commit' }),
      });
      const refresh = vi.mocked(useFileWatch).mock.calls.at(-1)?.[0];
      await act(async () => refresh?.());
      await waitFor(() => {
        const current = vi.mocked(useDiffComments).mock.calls.at(-1);
        if (context === 'capture') expect(current?.[6]?.version).toBe(2);
        else expect(current?.[2]).toBe('different-commit');
      });
      act(() => {
        mockViewedFiles = new Set(['test.ts']);
        mockHasLoadedInitialViewedFiles = true;
        view.rerender(
          <HotkeysProvider initiallyActiveScopes={['navigation']}>
            <App />
          </HotkeysProvider>,
        );
      });
      await screen.findByTitle('Expand file (Alt+Click to expand all)');
      expect(mockToggleFileViewed).not.toHaveBeenCalled();
    },
  );

  it('collapses initially viewed files after viewed state finishes loading', async () => {
    const view = renderApp();

    await waitFor(() => {
      expect(screen.getByTitle('Collapse file (Alt+Click to collapse all)')).toBeInTheDocument();
    });

    expect(screen.getByTitle('Collapse file (Alt+Click to collapse all)')).toBeInTheDocument();

    act(() => {
      mockViewedFiles = new Set(['test.ts']);
      mockHasLoadedInitialViewedFiles = true;
      view.rerender(
        <HotkeysProvider initiallyActiveScopes={['navigation']}>
          <App />
        </HotkeysProvider>,
      );
    });

    await waitFor(() => {
      expect(screen.getByTitle('Expand file (Alt+Click to expand all)')).toBeInTheDocument();
    });
  });

  it('expands a viewed file that is un-viewed because its diff changed', async () => {
    mockViewedFiles = new Set(['test.ts']);
    mockHasLoadedInitialViewedFiles = true;
    const view = renderApp();

    await waitFor(() => {
      expect(screen.getByTitle('Expand file (Alt+Click to expand all)')).toBeInTheDocument();
    });

    act(() => {
      mockViewedFiles = new Set();
      mockChangedSinceViewedFiles = new Set(['test.ts']);
      view.rerender(
        <HotkeysProvider initiallyActiveScopes={['navigation']}>
          <App />
        </HotkeysProvider>,
      );
    });

    await waitFor(() => {
      expect(screen.getByTitle('Collapse file (Alt+Click to collapse all)')).toBeInTheDocument();
    });
  });

  it('does not re-expand an updated file the user collapsed', async () => {
    mockChangedSinceViewedFiles = new Set(['test.ts']);
    mockHasLoadedInitialViewedFiles = true;
    const view = renderApp();

    fireEvent.click(await screen.findByTitle('Collapse file (Alt+Click to collapse all)'));
    expect(screen.getByTitle('Expand file (Alt+Click to expand all)')).toBeInTheDocument();

    act(() => {
      mockChangedSinceViewedFiles = new Set(['test.ts']);
      view.rerender(
        <HotkeysProvider initiallyActiveScopes={['navigation']}>
          <App />
        </HotkeysProvider>,
      );
    });

    expect(screen.getByTitle('Expand file (Alt+Click to expand all)')).toBeInTheDocument();
  });
});

describe('App Component - Viewed files reload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockComments = [];
    mockFetch(mockDiffResponse);
  });

  it('re-checks viewed files on reload but not when toggling whitespace', async () => {
    const getDiffCallCount = () =>
      vi
        .mocked(global.fetch)
        .mock.calls.filter(([url]) => typeof url === 'string' && url.startsWith('/api/diff'))
        .length;
    const getReloadVersion = () => vi.mocked(useViewedFiles).mock.lastCall?.[9];

    renderApp();
    await waitFor(() => {
      expect(getDiffCallCount()).toBe(1);
    });

    await openViewMenu();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Ignore Whitespace' }));
    await waitFor(() => {
      expect(getDiffCallCount()).toBe(2);
    });
    expect(getReloadVersion()).toBe(0);

    const onReload = vi.mocked(useFileWatch).mock.lastCall?.[0];
    await act(async () => {
      await onReload?.();
    });

    expect(getDiffCallCount()).toBe(3);
    expect(getReloadVersion()).toBe(1);
  });
});

describe('App Component - Review progress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockComments = [];
    mockConfirm.mockReturnValue(false);
  });

  it('counts only the viewed files the current diff still has', async () => {
    mockFetch({
      ...mockDiffResponse,
      files: [
        ...mockDiffResponse.files,
        {
          path: 'other.ts',
          status: 'modified',
          additions: 1,
          deletions: 1,
          chunks: [],
        },
      ],
    });
    mockViewedFiles = new Set(['test.ts', 'renamed-away.ts']);

    renderApp();

    expect(await screen.findByText('1 / 2 files viewed')).toBeInTheDocument();
  });

  it('reports a fully viewed diff without animating sparkles', async () => {
    mockFetch(mockDiffResponse);
    mockViewedFiles = new Set(['test.ts']);

    renderApp();

    expect(await screen.findByText('All files viewed')).toBeInTheDocument();
    expect(screen.queryAllByText('✨')).toHaveLength(0);
  });
});

describe('App Component - Comment sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfirm.mockReturnValue(false);
    mockFetch(mockDiffResponse);
  });

  it('syncs an empty comment list after the last comment is deleted', async () => {
    mockComments = [
      createMockThread({ id: 'test-1', filePath: 'test.ts', line: 10, body: 'Test comment' }),
    ];

    const mockGlobalFetch = vi.mocked(global.fetch);
    const { rerender } = renderApp();

    await waitFor(() => {
      const commentCalls = mockGlobalFetch.mock.calls.filter(([url]) =>
        String(url).startsWith('/api/comments?'),
      );
      expect(commentCalls).toHaveLength(1);

      const [url, request] = commentCalls[0] as [string, RequestInit];
      expect(url).toBe('/api/comments?base=HEAD%5E&target=HEAD');
      expect(request.method).toBe('POST');
      expect(JSON.parse(String(request.body))).toEqual({
        threads: [
          expect.objectContaining({
            id: 'test-1',
            filePath: 'test.ts',
            position: { side: 'new', line: 10 },
            messages: [
              expect.objectContaining({
                id: 'test-1',
                body: 'Test comment',
                author: 'User',
              }),
            ],
          }),
        ],
      });
    });

    mockComments = [];
    rerender(
      <HotkeysProvider initiallyActiveScopes={['navigation']}>
        <App />
      </HotkeysProvider>,
    );

    await waitFor(() => {
      const commentCalls = mockGlobalFetch.mock.calls.filter(([url]) =>
        String(url).startsWith('/api/comments?'),
      );
      expect(commentCalls).toHaveLength(2);

      const [url, request] = commentCalls[1] as [string, RequestInit];
      expect(url).toBe('/api/comments?base=HEAD%5E&target=HEAD');
      expect(request.method).toBe('POST');
      expect(JSON.parse(String(request.body))).toEqual({ threads: [] });
    });
  });

  it('sends an empty comment list on unload when no comments remain', async () => {
    mockComments = [];
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');

    renderApp();

    await waitFor(() => {
      expect(addEventListenerSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    });

    const beforeUnloadHandler = addEventListenerSpy.mock.calls.find(
      ([eventName]) => eventName === 'beforeunload',
    )?.[1] as (() => void) | undefined;
    expect(beforeUnloadHandler).toBeDefined();
    beforeUnloadHandler?.();

    expect(navigator.sendBeacon).toHaveBeenCalledWith(
      '/api/comments?base=HEAD%5E&target=HEAD',
      JSON.stringify({ threads: [] }),
    );
    addEventListenerSpy.mockRestore();
  });

  it('shows author badges in the comments modal when the diff has multiple authors', async () => {
    mockComments = [
      createMockThread({ id: 'test-1', filePath: 'test.ts', line: 10, body: 'User comment' }),
      createMockThread({
        id: 'test-2',
        filePath: 'other.ts',
        line: 20,
        body: 'Reviewer comment',
        author: 'Reviewer',
      }),
    ];
    mockFetch({
      ...mockDiffResponse,
      files: [
        ...mockDiffResponse.files,
        {
          path: 'other.ts',
          status: 'modified',
          additions: 1,
          deletions: 1,
          chunks: [],
        },
      ],
    });

    renderApp();

    fireEvent.click(await screen.findByRole('button', { name: 'Conversation' }));

    expect(await screen.findByText('User')).toBeInTheDocument();
    expect(screen.getByText('Reviewer')).toBeInTheDocument();
  });
});

describe('App Component - Diff Mode Persistence', () => {
  it('initializes the selected view mode from the settings cookie', async () => {
    mockFetch(mockDiffResponse);
    saveClientSettings({ diffViewMode: 'unified' });

    renderApp();

    await openViewMenu();
    const unifiedButton = await screen.findByRole('button', { name: 'Unified' });

    await waitFor(() => {
      expect(unifiedButton).toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('persists the selected view mode to the settings cookie', async () => {
    mockFetch(mockDiffResponse);

    renderApp();

    await openViewMenu();
    const unifiedButton = await screen.findByRole('button', { name: 'Unified' });
    fireEvent.click(unifiedButton);

    expect(readClientSettings().diffViewMode).toBe('unified');
  });

  it('keeps the selected view mode after triggering refresh', async () => {
    const mockGlobalFetch = vi.mocked(global.fetch);
    mockGlobalFetch.mockClear();
    mockComments = [];
    mockClearAllComments.mockReset();
    mockConfirm.mockReturnValue(false);
    mockWatchState.shouldReload = true;
    mockWatchState.lastChangeType = 'file';
    mockFetch(mockDiffResponse);

    renderApp();

    await openViewMenu();
    const unifiedButton = await screen.findByRole('button', { name: 'Unified' });
    fireEvent.click(unifiedButton);

    await waitFor(() => {
      expect(unifiedButton).toHaveAttribute('aria-pressed', 'true');
    });

    const refreshButton = await screen.findByRole('button', { name: 'Refresh' });
    fireEvent.click(refreshButton);

    await waitFor(() => {
      expect(
        mockGlobalFetch.mock.calls.filter(([url]) => String(url).startsWith('/api/diff')),
      ).toHaveLength(2);
    });

    await waitFor(() => {
      expect(unifiedButton).toHaveAttribute('aria-pressed', 'true');
    });
    mockWatchState.shouldReload = false;
    mockWatchState.lastChangeType = null;
  });
});

describe('App Component - Merge-base selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockComments = [];
    mockConfirm.mockReturnValue(false);
  });

  it('clears the resolved base revision after switching to a merge-base quick diff', async () => {
    const initialDiffResponse: DiffResponse = {
      ...mockDiffResponse,
      baseCommitish: '88aabb0',
      targetCommitish: '.',
      requestedBaseCommitish: 'HEAD',
      requestedTargetCommitish: '.',
    };
    const mergeBaseDiffResponse: DiffResponse = {
      ...mockDiffResponse,
      baseCommitish: '1122334',
      targetCommitish: '.',
      requestedBaseCommitish: 'origin/main',
      requestedTargetCommitish: '.',
      requestedBaseMode: 'merge-base',
    };
    const revisionsResponse = {
      specialOptions: [{ value: '.', label: 'All Uncommitted Changes' }],
      branches: [],
      commits: [
        {
          hash: '88aabb0fffff1111222233334444555566667777',
          shortHash: '88aabb0',
          message: 'stale direct base',
        },
        {
          hash: '1122334fffff1111222233334444555566667777',
          shortHash: '1122334',
          message: 'merge base',
        },
      ],
      originDefaultBranch: 'origin/main',
    };

    vi.mocked(global.fetch).mockImplementation((input) => {
      const url = String(input);

      if (url.includes('/api/revisions')) {
        return Promise.resolve({
          ok: true,
          json: async () => revisionsResponse,
        } as Response);
      }

      if (url.includes('/api/diff')) {
        const response =
          url.includes('base=origin%2Fmain') && url.includes('baseMode=merge-base')
            ? mergeBaseDiffResponse
            : initialDiffResponse;

        return Promise.resolve({
          ok: true,
          json: async () => response,
          blob: async () => ({ size: 1024 }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      } as Response);
    });

    renderApp();

    fireEvent.click(await screen.findByRole('button', { name: /Revision menu:/ }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'origin/main...Uncommitted (merge-base)' }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole('button', {
          name: 'Revision menu: origin/main...Uncommitted Changes (merge-base)',
        }),
      ).toBeInTheDocument();
    });

    expect(
      screen.queryByRole('button', {
        name: 'Revision menu: 88aabb0...Uncommitted Changes (merge-base)',
      }),
    ).not.toBeInTheDocument();
  });

  it('uses resolved revisions for persisted diff state identity', async () => {
    const response: DiffResponse = {
      ...mockDiffResponse,
      baseCommitish: '1234567',
      targetCommitish: '98664e1',
      requestedBaseCommitish: '98664e1^',
      requestedTargetCommitish: '98664e1',
    };

    mockFetch(response);

    renderApp();

    await waitFor(() => {
      expect(vi.mocked(useDiffComments)).toHaveBeenCalledWith(
        '1234567',
        '98664e1',
        'abc123',
        undefined,
        undefined,
        undefined,
        undefined,
      );
    });

    expect(vi.mocked(useViewedFiles)).toHaveBeenCalledWith(
      '1234567',
      '98664e1',
      'abc123',
      undefined,
      response.files,
      undefined,
      [],
      undefined,
      undefined,
      expect.any(Number),
    );
  });

  it('ignores stale resolvedBase from /api/revisions on initial merge-base load', async () => {
    const mergeBaseDiffResponse: DiffResponse = {
      ...mockDiffResponse,
      baseCommitish: '1122334',
      targetCommitish: '.',
      requestedBaseCommitish: 'origin/main',
      requestedTargetCommitish: '.',
      requestedBaseMode: 'merge-base',
    };
    const revisionsResponse = {
      specialOptions: [{ value: '.', label: 'All Uncommitted Changes' }],
      branches: [],
      commits: [
        {
          hash: '88aabb0fffff1111222233334444555566667777',
          shortHash: '88aabb0',
          message: 'stale direct base',
        },
      ],
      originDefaultBranch: 'origin/main',
      resolvedBase: '88aabb0',
      resolvedTarget: '1122334',
    };

    let resolveRevisions: (() => void) | null = null;

    vi.mocked(global.fetch).mockImplementation((input) => {
      const url = String(input);

      if (url.includes('/api/revisions')) {
        return new Promise<Response>((resolve) => {
          resolveRevisions = () =>
            resolve({
              ok: true,
              json: async () => revisionsResponse,
            } as Response);
        });
      }

      if (url.includes('/api/diff')) {
        return Promise.resolve({
          ok: true,
          json: async () => mergeBaseDiffResponse,
          blob: async () => ({ size: 1024 }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      } as Response);
    });

    renderApp();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
    });

    await act(async () => {
      resolveRevisions?.();
    });

    await waitFor(() => {
      expect(
        screen.getByRole('button', {
          name: 'Revision menu: origin/main...Uncommitted Changes (merge-base)',
        }),
      ).toBeInTheDocument();
    });

    expect(
      screen.queryByRole('button', {
        name: 'Revision menu: 88aabb0...Uncommitted Changes (merge-base)',
      }),
    ).not.toBeInTheDocument();
  });
});

describe('App Component - Revision-aware refetching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockComments = [];
    mockConfirm.mockReturnValue(false);
  });

  it('keeps the selected revisions when refetching without explicit revision params', async () => {
    const diffResponse: DiffResponse = {
      ...mockDiffResponse,
      requestedBaseCommitish: 'HEAD^',
      requestedTargetCommitish: 'HEAD',
    };

    vi.mocked(global.fetch).mockImplementation((input: string | URL | Request) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes('/api/revisions')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            specialOptions: [],
            branches: [],
            commits: [
              {
                hash: 'abc1234',
                shortHash: 'abc1234',
                message: 'Test commit',
              },
            ],
          }),
        } as Response);
      }

      if (url.startsWith('/api/comments?')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        json: async () => diffResponse,
        blob: async () => ({ size: 1024 }),
      } as Response);
    });

    renderApp();

    fireEvent.click(await screen.findByRole('button', { name: /Revision menu:/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Previous commit' }));

    await waitFor(() => {
      const diffCalls = vi
        .mocked(global.fetch)
        .mock.calls.filter(([url]) => typeof url === 'string' && url.startsWith('/api/diff'));
      expect(diffCalls).toHaveLength(2);
      expect(String(diffCalls[1]?.[0])).toContain('base=HEAD%5E%5E');
      expect(String(diffCalls[1]?.[0])).toContain('target=HEAD%5E');
    });

    await openViewMenu();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ignore Whitespace' }));

    await waitFor(() => {
      const diffCalls = vi
        .mocked(global.fetch)
        .mock.calls.filter(([url]) => typeof url === 'string' && url.startsWith('/api/diff'));
      expect(diffCalls).toHaveLength(3);
      expect(String(diffCalls[2]?.[0])).toContain('base=HEAD%5E%5E');
      expect(String(diffCalls[2]?.[0])).toContain('target=HEAD%5E');
    });
  });
});

describe('App Component - Sidebar persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockComments = [];
    mockConfirm.mockReturnValue(false);
    vi.mocked(useViewport).mockReturnValue({ isMobile: false, isDesktop: true });
    mockFetch(mockDiffResponse);
  });

  it('restores file tree open state from the settings cookie', async () => {
    saveClientSettings({ sidebarOpen: false });

    renderApp();

    const toggleButton = await screen.findByRole('button', { name: /toggle file tree panel/i });
    expect(toggleButton).toHaveAttribute('aria-expanded', 'false');
  });

  it('persists file tree open state when toggled', async () => {
    renderApp();

    const toggleButton = await screen.findByRole('button', { name: /toggle file tree panel/i });

    fireEvent.click(toggleButton);
    await waitFor(() => {
      expect(readClientSettings().sidebarOpen).toBe(false);
    });

    fireEvent.click(toggleButton);
    await waitFor(() => {
      expect(readClientSettings().sidebarOpen).toBe(true);
    });
  });
});

describe('App Component - Mobile sidebar auto-close', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockComments = [];
    mockConfirm.mockReturnValue(false);
    vi.mocked(useViewport).mockReturnValue({ isMobile: true, isDesktop: false });
  });

  afterEach(() => {
    vi.mocked(useViewport).mockReturnValue({ isMobile: false, isDesktop: true });
  });

  it('expands the selected file and closes the sidebar on mobile', async () => {
    mockViewedFiles = new Set(['test.ts']);
    mockFetch(mockDiffResponse);
    renderApp();

    // Sidebar toggle button
    const toggleButton = await screen.findByRole('button', { name: /toggle file tree panel/i });
    expect(toggleButton).toHaveAttribute('aria-expanded', 'true');

    await screen.findByTitle('Expand file (Alt+Click to expand all)');
    // Wait for file list to render, then click the file row
    const fileRow = await screen.findByTitle('test.ts');
    fireEvent.click(fileRow.closest('[data-file-row]')!);

    // Sidebar should now be closed on mobile
    await waitFor(() => {
      expect(toggleButton).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getByTitle('Collapse file (Alt+Click to collapse all)')).toBeInTheDocument();
    });
    expect(mockToggleFileViewed).not.toHaveBeenCalled();
  });
});

describe('App Component - Review navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockComments = [];
    mockConfirm.mockReturnValue(false);
  });

  it('loads a bookmarked comparison and preserves other query parameters and fragments', async () => {
    window.history.replaceState(
      { retained: true },
      '',
      '/?base=chosen-base&target=chosen-tip&baseMode=merge-base&retained=yes#gavel-editor-token=fixture',
    );
    mockFetch({
      ...mockDiffResponse,
      baseCommitish: 'resolved-base',
      targetCommitish: 'resolved-tip',
      requestedBaseCommitish: 'chosen-base',
      requestedTargetCommitish: 'chosen-tip',
      requestedBaseMode: 'merge-base',
    });
    renderApp();
    await waitFor(() => {
      const first = vi
        .mocked(global.fetch)
        .mock.calls.find(([url]) => String(url).startsWith('/api/diff'));
      const params = new URL(String(first?.[0]), window.location.origin).searchParams;
      expect(params.get('base')).toBe('chosen-base');
      expect(params.get('target')).toBe('chosen-tip');
      expect(params.get('baseMode')).toBe('merge-base');
    });
    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).get('base')).toBe('chosen-base'),
    );
    expect(new URLSearchParams(window.location.search).get('retained')).toBe('yes');
    expect(window.location.hash).toBe('#gavel-editor-token=fixture');
    expect(window.history.state).toMatchObject({ retained: true });
  });

  it('records the launch comparison without adding an extra Back step', async () => {
    mockFetch({
      ...mockDiffResponse,
      baseCommitish: 'base-a',
      targetCommitish: '.',
      requestedBaseCommitish: 'HEAD',
      requestedTargetCommitish: '.',
    });
    const length = window.history.length;
    renderApp();
    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).get('base')).toBe('HEAD'),
    );
    expect(new URLSearchParams(window.location.search).get('target')).toBe('.');
    expect(window.history.length).toBe(length);
  });

  it.each([
    { base: 'HEAD', mode: undefined },
    { base: 'main', mode: 'merge-base' as const },
  ])('continues following $base after reload and a ref update', async ({ base, mode }) => {
    let resolvedBase = 'before-commit';
    vi.mocked(global.fetch).mockImplementation((input) => {
      const url = new URL(String(input), window.location.origin);
      let payload: unknown = {};
      if (url.pathname === '/api/diff') {
        payload = {
          ...mockDiffResponse,
          baseCommitish:
            url.searchParams.get('base') === 'before-commit' ? 'before-commit' : resolvedBase,
          targetCommitish: '.',
          requestedBaseCommitish: url.searchParams.get('base') ?? base,
          requestedTargetCommitish: '.',
          requestedBaseMode: mode,
        };
      } else if (url.pathname === '/api/revisions') {
        payload = { specialOptions: [], branches: [], commits: [] };
      } else if (url.pathname === '/api/comments-json') {
        payload = { version: 1, threads: [] };
      }
      return Promise.resolve({ ok: true, json: async () => payload } as Response);
    });
    const firstVisit = renderApp();
    await waitFor(() =>
      expect(vi.mocked(useDiffComments).mock.calls.at(-1)?.slice(0, 2)).toEqual([
        'before-commit',
        '.',
      ]),
    );
    firstVisit.unmount();
    resolvedBase = 'after-commit';
    renderApp();
    await waitFor(() =>
      expect(vi.mocked(useDiffComments).mock.calls.at(-1)?.slice(0, 2)).toEqual([
        'after-commit',
        '.',
      ]),
    );
    expect(new URLSearchParams(window.location.search).get('base')).toBe(base);
    expect(new URLSearchParams(window.location.search).get('baseMode')).toBe(mode ?? null);
  });

  it('keeps the launch comparison on refresh after another client changes the server selection', async () => {
    let defaultTarget = '.';
    vi.mocked(global.fetch).mockImplementation((input) => {
      const url = new URL(String(input), window.location.origin);
      let payload: unknown = {};
      if (url.pathname === '/api/diff') {
        const target = url.searchParams.get('target') ?? defaultTarget;
        payload = {
          ...mockDiffResponse,
          baseCommitish: target === '.' ? 'base-a' : 'base-b',
          targetCommitish: target,
          requestedBaseCommitish: 'HEAD',
          requestedTargetCommitish: target,
        };
      } else if (url.pathname === '/api/revisions') {
        payload = { specialOptions: [], branches: [], commits: [] };
      } else if (url.pathname === '/api/comments-json') {
        payload = { version: 1, threads: [] };
      }
      return Promise.resolve({ ok: true, json: async () => payload } as Response);
    });
    renderApp();
    await waitFor(() =>
      expect(vi.mocked(useDiffComments).mock.calls.at(-1)?.slice(0, 2)).toEqual(['base-a', '.']),
    );
    defaultTarget = 'other-client-tip';
    const refresh = vi.mocked(useFileWatch).mock.calls.at(-1)?.[0];
    await act(async () => refresh?.());
    expect(vi.mocked(useDiffComments).mock.calls.at(-1)?.slice(0, 2)).toEqual(['base-a', '.']);
  });

  it('restores the earlier comment context with browser Back and Forward', async () => {
    const reviewA = {
      ...mockDiffResponse,
      baseCommitish: 'base-a',
      targetCommitish: '.',
      requestedBaseCommitish: 'HEAD',
      requestedTargetCommitish: '.',
    };
    const reviewB = {
      ...mockDiffResponse,
      baseCommitish: 'base-b',
      targetCommitish: 'tip-b',
      requestedBaseCommitish: 'HEAD^',
      requestedTargetCommitish: 'HEAD',
    };
    vi.mocked(global.fetch).mockImplementation((input) => {
      const url = new URL(String(input), window.location.origin);
      let payload: unknown = {};
      if (url.pathname === '/api/diff') {
        payload = ['HEAD', 'tip-b'].includes(url.searchParams.get('target') ?? '')
          ? reviewB
          : reviewA;
      } else if (url.pathname === '/api/revisions') {
        payload = { specialOptions: [], branches: [], commits: [] };
      } else if (url.pathname === '/api/comments-json') {
        payload = { version: 0, threads: [] };
      }
      return Promise.resolve({ ok: true, json: async () => payload } as Response);
    });
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: /Revision menu:/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'HEAD' }));
    await waitFor(() =>
      expect(vi.mocked(useDiffComments).mock.calls.at(-1)?.slice(0, 2)).toEqual([
        'base-b',
        'tip-b',
      ]),
    );
    await act(async () => window.history.back());
    await waitFor(() =>
      expect(vi.mocked(useDiffComments).mock.calls.at(-1)?.slice(0, 2)).toEqual(['base-a', '.']),
    );
    await act(async () => window.history.forward());
    await waitFor(() =>
      expect(vi.mocked(useDiffComments).mock.calls.at(-1)?.slice(0, 2)).toEqual([
        'base-b',
        'tip-b',
      ]),
    );
  });

  it.each([undefined, 'merge-base'] as const)(
    'restores resolved history after refs advance (mode=%s)',
    async (baseMode) => {
      let refsMoved = false;
      const reviewA = {
        ...mockDiffResponse,
        baseCommitish: 'base-a',
        targetCommitish: '.',
        requestedBaseCommitish: 'HEAD',
        requestedTargetCommitish: '.',
        requestedBaseMode: baseMode,
      };
      const reviewB = {
        ...mockDiffResponse,
        baseCommitish: 'base-b',
        targetCommitish: 'tip-b',
        requestedBaseCommitish: 'HEAD^',
        requestedTargetCommitish: 'HEAD',
      };
      vi.mocked(global.fetch).mockImplementation((input) => {
        const url = new URL(String(input), window.location.origin);
        let payload: unknown = {};
        if (url.pathname === '/api/diff') {
          payload = ['HEAD', 'tip-b'].includes(url.searchParams.get('target') ?? '')
            ? {
                ...reviewB,
                targetCommitish:
                  refsMoved && url.searchParams.get('target') === 'HEAD' ? 'moved-tip' : 'tip-b',
              }
            : {
                ...reviewA,
                requestedBaseCommitish: url.searchParams.get('base') ?? 'HEAD',
                baseCommitish:
                  refsMoved &&
                  (url.searchParams.get('base') !== 'base-a' ||
                    (baseMode === 'merge-base' && url.searchParams.get('retainedReview') !== '1'))
                    ? 'moved-base'
                    : 'base-a',
              };
        } else if (url.pathname === '/api/revisions') {
          payload = { specialOptions: [], branches: [], commits: [] };
        } else if (url.pathname === '/api/comments-json') {
          payload = { version: 0, threads: [] };
        }
        return Promise.resolve({ ok: true, json: async () => payload } as Response);
      });
      renderApp();
      fireEvent.click(await screen.findByRole('button', { name: /Revision menu:/ }));
      fireEvent.click(await screen.findByRole('button', { name: 'HEAD' }));
      await waitFor(() =>
        expect(vi.mocked(useDiffComments).mock.calls.at(-1)?.slice(0, 2)).toEqual([
          'base-b',
          'tip-b',
        ]),
      );
      refsMoved = true;
      await act(async () => window.history.back());
      await waitFor(() =>
        expect(vi.mocked(useDiffComments).mock.calls.at(-1)?.slice(0, 2)).toEqual(['base-a', '.']),
      );
      expect(new URLSearchParams(window.location.search).get('base')).toBe('HEAD');
      await act(async () => window.history.forward());
      await waitFor(() =>
        expect(vi.mocked(useDiffComments).mock.calls.at(-1)?.slice(0, 2)).toEqual([
          'base-b',
          'tip-b',
        ]),
      );
    },
  );

  it.each([undefined, 'merge-base'] as const)(
    'preserves symbolic refs on refresh after history restoration (mode=%s)',
    async (baseMode) => {
      let refsMoved = false;
      const reviewA = {
        ...mockDiffResponse,
        baseCommitish: 'base-a',
        targetCommitish: '.',
        requestedBaseCommitish: 'HEAD',
        requestedTargetCommitish: '.',
        requestedBaseMode: baseMode,
      };
      const reviewB = {
        ...mockDiffResponse,
        baseCommitish: 'base-b',
        targetCommitish: 'tip-b',
        requestedBaseCommitish: 'HEAD^',
        requestedTargetCommitish: 'HEAD',
      };
      vi.mocked(global.fetch).mockImplementation((input) => {
        const url = new URL(String(input), window.location.origin);
        let payload: unknown = {};
        if (url.pathname === '/api/diff') {
          payload = ['HEAD', 'tip-b'].includes(url.searchParams.get('target') ?? '')
            ? {
                ...reviewB,
                targetCommitish:
                  refsMoved && url.searchParams.get('target') === 'HEAD' ? 'moved-tip' : 'tip-b',
              }
            : {
                ...reviewA,
                requestedBaseCommitish: url.searchParams.get('base') ?? 'HEAD',
                baseCommitish:
                  refsMoved &&
                  (url.searchParams.get('base') !== 'base-a' ||
                    (baseMode === 'merge-base' && url.searchParams.get('retainedReview') !== '1'))
                    ? 'moved-base'
                    : 'base-a',
              };
        } else if (url.pathname === '/api/revisions') {
          payload = { specialOptions: [], branches: [], commits: [] };
        } else if (url.pathname === '/api/comments-json') {
          payload = { version: 0, threads: [] };
        }
        return Promise.resolve({ ok: true, json: async () => payload } as Response);
      });
      const view = renderApp();
      fireEvent.click(await screen.findByRole('button', { name: /Revision menu:/ }));
      fireEvent.click(await screen.findByRole('button', { name: 'HEAD' }));
      await waitFor(() =>
        expect(vi.mocked(useDiffComments).mock.calls.at(-1)?.slice(0, 2)).toEqual([
          'base-b',
          'tip-b',
        ]),
      );
      refsMoved = true;
      await act(async () => window.history.back());
      await waitFor(() =>
        expect(vi.mocked(useDiffComments).mock.calls.at(-1)?.slice(0, 2)).toEqual(['base-a', '.']),
      );
      expect(new URLSearchParams(window.location.search).get('base')).toBe('HEAD');
      await openViewMenu();
      fireEvent.click(screen.getByRole('checkbox', { name: 'Ignore Whitespace' }));
      await waitFor(() => {
        const calls = vi
          .mocked(global.fetch)
          .mock.calls.filter(([url]) => String(url).startsWith('/api/diff'));
        expect(
          new URL(String(calls.at(-1)?.[0]), window.location.origin).searchParams.get(
            'ignoreWhitespace',
          ),
        ).toBe('false');
      });
      await waitFor(() =>
        expect(vi.mocked(useDiffComments).mock.calls.at(-1)?.slice(0, 2)).toEqual(['base-a', '.']),
      );
      expect(new URLSearchParams(window.location.search).get('base')).toBe('HEAD');
      view.unmount();
      renderApp();
      await waitFor(() =>
        expect(vi.mocked(useDiffComments).mock.calls.at(-1)?.slice(0, 2)).toEqual([
          'moved-base',
          '.',
        ]),
      );
    },
  );
});

describe('App Component - Retained conversation contexts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockComments = [];
  });

  it('reopens the saved resolved merge-base context after HEAD moves to another branch', async () => {
    const archived = [
      createMockThread({
        id: 'archived',
        filePath: 'test.ts',
        line: 1,
        body: 'Earlier branch conversation',
      }),
    ];
    vi.mocked(global.fetch).mockImplementation((input) => {
      const url = new URL(String(input), window.location.origin);
      let payload: unknown = {};
      if (url.pathname === '/api/diff') {
        const saved = url.searchParams.get('base') === 'saved-base';
        const mode = url.searchParams.get('baseMode') === 'merge-base' ? 'merge-base' : undefined;
        payload = {
          ...mockDiffResponse,
          baseCommitish: saved
            ? mode && url.searchParams.get('retainedReview') !== '1'
              ? 'recomputed-ancestor'
              : 'saved-base'
            : 'current-base',
          targetCommitish: url.searchParams.get('target') ?? '.',
          requestedBaseCommitish: url.searchParams.get('base') ?? 'HEAD',
          requestedTargetCommitish: url.searchParams.get('target') ?? '.',
          requestedBaseMode: mode,
        };
      } else if (url.pathname === '/api/revisions') {
        payload = { specialOptions: [], branches: [], commits: [] };
      } else if (url.pathname === '/api/conversation/snapshot') {
        payload = {
          reviews: [
            {
              selection: {
                baseCommitish: 'saved-base',
                targetCommitish: '.',
                baseMode: 'merge-base',
              },
              // A proposed commit message would replace the revision picker with tabs.
              summary: { commitMessage: '', rationale: 'Archived branch review' },
              threads: archived,
            },
          ],
        };
      } else if (url.pathname === '/api/comments-json') {
        payload = {
          version: 1,
          threads:
            url.searchParams.get('base') === 'saved-base' &&
            url.searchParams.get('baseMode') === 'merge-base'
              ? archived
              : [],
        };
      }
      return Promise.resolve({ ok: true, json: async () => payload } as Response);
    });
    const firstVisit = renderApp();
    fireEvent.click(await screen.findByRole('button', { name: /Revision menu:/ }));
    fireEvent.click(
      await screen.findByRole('button', { name: /Return to Archived branch review/ }),
    );
    await waitFor(() =>
      expect(vi.mocked(useDiffComments).mock.calls.at(-1)?.slice(0, 2)).toEqual([
        'saved-base',
        '.',
      ]),
    );
    expect(vi.mocked(useDiffComments).mock.calls.at(-1)?.[5]).toBe('merge-base');
    await waitFor(() => expect(mockReplaceThreads).toHaveBeenCalledWith(archived));
    expect(new URLSearchParams(window.location.search).get('retainedReview')).toBe('1');
    firstVisit.unmount();
    renderApp();
    await waitFor(() =>
      expect(vi.mocked(useDiffComments).mock.calls.at(-1)?.slice(0, 2)).toEqual([
        'saved-base',
        '.',
      ]),
    );
    expect(vi.mocked(useDiffComments).mock.calls.at(-1)?.[5]).toBe('merge-base');
    const request = vi
      .mocked(global.fetch)
      .mock.calls.filter(([url]) => String(url).startsWith('/api/diff'))
      .at(-1);
    expect(new URL(String(request?.[0]), window.location.origin).searchParams.get('baseMode')).toBe(
      'merge-base',
    );
    expect(
      new URL(String(request?.[0]), window.location.origin).searchParams.get('retainedReview'),
    ).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: /Revision menu:/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'HEAD' }));
    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).get('retainedReview')).toBeNull(),
    );
  });

  it('can reopen a server-retained review that predates browser history', async () => {
    vi.mocked(global.fetch).mockImplementation((input) => {
      const url = new URL(String(input), window.location.origin);
      let payload: unknown = {};
      if (url.pathname === '/api/diff') {
        payload = { ...mockDiffResponse, baseCommitish: 'base-b', targetCommitish: 'tip-b' };
      } else if (url.pathname === '/api/revisions') {
        payload = { specialOptions: [], branches: [], commits: [] };
      } else if (url.pathname === '/api/conversation/snapshot') {
        payload = {
          reviews: [
            {
              selection: { baseCommitish: 'base-a', targetCommitish: 'tip-a' },
              // A proposed commit message would replace the revision picker with tabs.
              summary: { commitMessage: '', rationale: 'Earlier review' },
              threads: [{}],
            },
            {
              selection: { baseCommitish: 'empty-base', targetCommitish: 'empty-tip' },
              summary: { commitMessage: '', rationale: '' },
              threads: [],
            },
            {
              selection: { baseCommitish: 'why-base', targetCommitish: 'why-tip' },
              summary: { commitMessage: '', rationale: 'Retained rationale' },
              threads: [],
            },
          ],
        };
      }
      return Promise.resolve({ ok: true, json: async () => payload } as Response);
    });
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: /Revision menu:/ }));
    expect(
      await screen.findByRole('button', { name: /Return to Retained rationale/ }),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: /Return to empty-base/ })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /Return to Earlier review/ }));
    await waitFor(() => {
      const calls = vi
        .mocked(global.fetch)
        .mock.calls.filter(([url]) => String(url).startsWith('/api/diff'));
      const params = new URL(String(calls.at(-1)?.[0]), window.location.origin).searchParams;
      expect(params.get('base')).toBe('base-a');
      expect(params.get('target')).toBe('tip-a');
    });
  });

  it.each([false, true])(
    'ignores a delayed comment refresh after switching reviews (return=%s)',
    async (returnToOriginal) => {
      let delayRefresh = false;
      let completeRefresh: ((response: Response) => void) | undefined;
      const oldThreads = [
        createMockThread({ id: 'old', filePath: 'test.ts', line: 1, body: 'Late old context' }),
      ];
      vi.mocked(global.fetch).mockImplementation((input) => {
        const url = new URL(String(input), window.location.origin);
        let payload: unknown = {};
        if (url.pathname === '/api/diff') {
          const other = ['HEAD', 'tip-b'].includes(url.searchParams.get('target') ?? '');
          payload = {
            ...mockDiffResponse,
            baseCommitish: other ? 'base-b' : 'base-a',
            targetCommitish: other ? 'tip-b' : '.',
            requestedBaseCommitish: other ? 'HEAD^' : 'HEAD',
            requestedTargetCommitish: other ? 'HEAD' : '.',
          };
        } else if (url.pathname === '/api/revisions') {
          payload = { specialOptions: [], branches: [], commits: [] };
        } else if (url.pathname === '/api/comments-json') {
          if (delayRefresh && url.searchParams.get('target') === '.') {
            delayRefresh = false;
            return new Promise<Response>((resolve) => {
              completeRefresh = resolve;
            });
          }
          payload = { version: 1, threads: [] };
        }
        return Promise.resolve({ ok: true, json: async () => payload } as Response);
      });
      renderApp();
      await waitFor(() => expect(mockReplaceThreads).toHaveBeenCalled());
      const refresh = vi.mocked(useFileWatch).mock.calls.at(-1)?.[1];
      if (!refresh) throw new Error('Missing comment refresh handler');
      delayRefresh = true;
      let pending: void | Promise<void>;
      act(() => {
        pending = refresh();
      });
      fireEvent.click(screen.getByRole('button', { name: /Revision menu:/ }));
      fireEvent.click(await screen.findByRole('button', { name: 'HEAD' }));
      await waitFor(() =>
        expect(vi.mocked(useDiffComments).mock.calls.at(-1)?.slice(0, 2)).toEqual([
          'base-b',
          'tip-b',
        ]),
      );
      if (returnToOriginal) {
        await act(async () => window.history.back());
        await waitFor(() =>
          expect(vi.mocked(useDiffComments).mock.calls.at(-1)?.slice(0, 2)).toEqual([
            'base-a',
            '.',
          ]),
        );
      }
      mockReplaceThreads.mockClear();
      await act(async () => {
        completeRefresh?.({
          ok: true,
          json: async () => ({ version: 99, threads: oldThreads }),
        } as Response);
        await pending;
      });
      expect(mockReplaceThreads).not.toHaveBeenCalledWith(oldThreads);
    },
  );

  it.each([false, true])(
    'ignores a delayed comment save after switching reviews (return=%s)',
    async (returnToOriginal) => {
      const oldThreads = [
        createMockThread({ id: 'old-save', filePath: 'test.ts', line: 1, body: 'Old save' }),
      ];
      mockComments = oldThreads;
      let completeSave: ((response: Response) => void) | undefined;
      const posts: Array<{ target: string | null; baseVersion?: number }> = [];
      vi.mocked(global.fetch).mockImplementation((input, init) => {
        const url = new URL(String(input), window.location.origin);
        let payload: unknown = {};
        if (url.pathname === '/api/diff') {
          const other = ['HEAD', 'tip-b'].includes(url.searchParams.get('target') ?? '');
          payload = {
            ...mockDiffResponse,
            baseCommitish: other ? 'base-b' : 'base-a',
            targetCommitish: other ? 'tip-b' : '.',
            requestedBaseCommitish: other ? 'HEAD^' : 'HEAD',
            requestedTargetCommitish: other ? 'HEAD' : '.',
          };
        } else if (url.pathname === '/api/revisions') {
          payload = { specialOptions: [], branches: [], commits: [] };
        } else if (url.pathname === '/api/comments-json') {
          payload = { version: 7, threads: [] };
        } else if (url.pathname === '/api/comments' && init?.method === 'POST') {
          const body = JSON.parse(String(init.body)) as { baseVersion?: number };
          posts.push({ target: url.searchParams.get('target'), ...body });
          if (!completeSave) {
            return new Promise<Response>((resolve) => {
              completeSave = resolve;
            });
          }
          payload = { version: 8, threads: [] };
        }
        return Promise.resolve({ ok: true, json: async () => payload } as Response);
      });
      const view = renderApp();
      await waitFor(() => expect(completeSave).toBeDefined());
      mockComments = [];
      fireEvent.click(screen.getByRole('button', { name: /Revision menu:/ }));
      fireEvent.click(await screen.findByRole('button', { name: 'HEAD' }));
      await waitFor(() =>
        expect(vi.mocked(useDiffComments).mock.calls.at(-1)?.slice(0, 2)).toEqual([
          'base-b',
          'tip-b',
        ]),
      );
      if (returnToOriginal) {
        await act(async () => window.history.back());
        await waitFor(() =>
          expect(vi.mocked(useDiffComments).mock.calls.at(-1)?.slice(0, 2)).toEqual([
            'base-a',
            '.',
          ]),
        );
      }
      mockReplaceThreads.mockClear();
      await act(async () => {
        completeSave?.({
          ok: true,
          json: async () => ({ merged: true, version: 99, threads: oldThreads }),
        } as Response);
      });
      expect(mockReplaceThreads).not.toHaveBeenCalledWith(oldThreads);
      posts.length = 0;
      mockComments = [
        createMockThread({ id: 'new', filePath: 'test.ts', line: 2, body: 'Current review' }),
      ];
      view.rerender(
        <HotkeysProvider initiallyActiveScopes={['navigation']}>
          <App />
        </HotkeysProvider>,
      );
      await waitFor(() => expect(posts.length).toBeGreaterThan(0));
      expect(posts.at(-1)?.target).toBe(returnToOriginal ? '.' : 'tip-b');
      expect(posts.at(-1)?.baseVersion).toBe(7);
    },
  );
});

describe('App Component - Custom tab title', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockComments = [];
    mockConfirm.mockReturnValue(false);
  });

  it('sets document.title from the diff response when --title is provided', async () => {
    mockFetch({
      ...mockDiffResponse,
      title: 'DEV-1234 review',
      reviewContext: {
        source: 'git',
        repositoryName: 'example-project',
        repositoryPath: '/work/repo',
        workingDirectory: '/work/repo',
        hostname: 'host',
      },
    });

    renderApp();

    await waitFor(() => {
      expect(document.title).toBe('DEV-1234 review');
    });
  });
});

describe('App Component - Committed review summaries', () => {
  it.each([
    { committed: true, label: 'Commit message' },
    { committed: false, label: 'Proposed commit message' },
  ])('labels the summary as $label and displays its full message', async ({ committed, label }) => {
    const message =
      'fix: preserve café context\n\nKeep the explanation and trailers.\n\nRefs: #123\n';
    mockComments = [];
    mockFetch({
      ...mockDiffResponse,
      targetCommitMessage: committed ? message : undefined,
    });
    const fallback = vi.mocked(global.fetch).getMockImplementation()!;
    vi.mocked(global.fetch).mockImplementation((input, init) =>
      String(input).startsWith('/api/review-summary')
        ? Promise.resolve({
            ok: true,
            json: async () => ({ commitMessage: message, rationale: '', version: 1 }),
          } as Response)
        : fallback(input, init),
    );

    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: /Change summary/ }));

    await waitFor(() => expect(screen.getByLabelText(label)).toHaveValue(message));
    expect(
      screen.queryByLabelText(committed ? 'Proposed commit message' : 'Commit message'),
    ).toBeNull();
  });
});

describe('sidebar comment jumps', () => {
  it('opens a viewed file and focuses its first displayed message, even if that thread is resolved', async () => {
    mockHasLoadedInitialViewedFiles = true;
    mockViewedFiles = new Set(['test.ts']);
    const first = createMockThread({
      id: 'first-message',
      filePath: 'test.ts',
      line: 1,
      body: 'First message',
    });
    first.resolution = { resolved: true, updatedAt: first.updatedAt };
    mockComments = [
      createMockThread({
        id: 'later-message',
        filePath: 'test.ts',
        line: 2,
        body: 'Later message',
      }),
      first,
    ];
    mockFetch({
      ...mockDiffResponse,
      files: [
        {
          ...mockDiffResponse.files[0]!,
          chunks: [
            {
              header: '@@ -0,0 +1,2 @@',
              oldStart: 0,
              oldLines: 0,
              newStart: 1,
              newLines: 2,
              lines: [
                { type: 'add', content: 'line one', newLineNumber: 1 },
                { type: 'add', content: 'line two', newLineNumber: 2 },
              ],
            },
          ],
        },
      ],
    });
    renderApp();
    await screen.findByTitle('Expand file (Alt+Click to expand all)');
    fireEvent.click(screen.getByRole('button', { name: 'Jump to first comment in test.ts' }));
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute('id', 'comment-thread-first-message'),
    );
    expect(screen.getByTitle('Collapse file (Alt+Click to collapse all)')).toBeInTheDocument();
    expect(
      document
        .getElementById('comment-thread-first-message')
        ?.querySelector('button[aria-expanded]'),
    ).toHaveAttribute('aria-expanded', 'true');
    expect(mockViewedFiles.has('test.ts')).toBe(true);
    expect(mockToggleFileViewed).not.toHaveBeenCalled();
  });
});
