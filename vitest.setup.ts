import { tmpdir } from 'node:os';
import { join } from 'node:path';

import '@testing-library/jest-dom';
import { vi } from 'vitest';
import { Agent, setGlobalDispatcher } from 'undici';

// Disable keep-alive for tests to prevent ECONNRESET errors
// Use pipelining=0 instead of keepAlive=false for this version of undici
setGlobalDispatcher(new Agent({ pipelining: 0 }));

// Keep servers under test away from the developer's ~/.gavel/config.json. Nothing
// creates this directory; tests that save settings point GAVEL_CONFIG_DIR at their own.
process.env.GAVEL_CONFIG_DIR = join(tmpdir(), `gavel-test-config-${process.pid}`);

// Tests often run inside a Claude Code session. Without these, servers and CLIs under test
// cannot register with that session or send its inbox their test reviews' activity.
delete process.env.CLAUDE_CODE_MESSAGING_SOCKET;
delete process.env.CLAUDE_CODE_MESSAGING_TOKEN;

// Mock fetch globally for component tests, but not for server integration tests
if (!process.env.VITEST_SERVER_TEST) {
  global.fetch = vi.fn();
}

// Mock console.error to suppress error logs during tests
global.console.error = vi.fn();

// Mock window.getComputedStyle
Object.defineProperty(window, 'getComputedStyle', {
  value: () => ({
    getPropertyValue: () => '',
  }),
});

// Global test utilities
export const mockFetch = (response: any, revisionsResponse?: any) => {
  const verdicts = new Map<string, string>();
  (global.fetch as any).mockImplementation((url: string, init?: RequestInit) => {
    if (url.startsWith('/api/review-summary')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ commitMessage: '', rationale: '', version: 0 }),
      });
    }
    // Verdicts are keyed by the review's query, which /api/approval and /api/review-ops share.
    const query = url.slice(url.indexOf('?'));
    if (url.startsWith('/api/review-ops')) {
      const { ops } = JSON.parse(String(init?.body)) as {
        ops: Array<{ id: string; type: string; verdict?: string }>;
      };
      for (const op of ops) {
        if (op.type !== 'verdict.set') continue;
        if (op.verdict === 'clear') verdicts.delete(query);
        else verdicts.set(query, op.verdict!);
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          version: 1,
          cursor: 'test:1',
          results: ops.map(({ id }) => ({ id, status: 'applied' })),
          threads: [],
        }),
      });
    }
    if (url.startsWith('/api/comments-json')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ version: 1, cursor: 'test:1', threads: [] }),
      });
    }
    if (url.startsWith('/api/approval')) {
      const verdict = verdicts.get(query);
      return Promise.resolve({
        ok: true,
        json: async () => (verdict ? { verdict } : {}),
      });
    }
    // Handle /api/revisions endpoint
    if (url.includes('/api/revisions')) {
      return Promise.resolve({
        ok: revisionsResponse !== null,
        json: async () =>
          revisionsResponse ?? {
            specialOptions: [],
            branches: [],
            commits: [],
          },
      });
    }
    // Default: /api/diff and others
    return Promise.resolve({
      ok: true,
      json: async () => response,
      blob: async () => ({ size: 1024 }),
    });
  });
};

export const mockFetchError = (error: string) => {
  (global.fetch as any).mockRejectedValue(new Error(error));
};
