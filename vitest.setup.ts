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
    if (url.startsWith('/api/approval')) {
      if (init?.method === 'PUT')
        verdicts.set(url, (JSON.parse(String(init.body)) as { verdict: string }).verdict);
      if (init?.method === 'DELETE') verdicts.delete(url);
      const verdict = verdicts.get(url);
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
