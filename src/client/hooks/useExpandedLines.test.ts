import { act, render, renderHook, waitFor } from '@testing-library/react';
import { createElement, useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DiffFile } from '../../types/diff';

import { useExpandedLines } from './useExpandedLines';

function createMockDiffFile(): DiffFile {
  return {
    path: 'src/app.ts',
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
          {
            type: 'delete',
            content: 'old changed line',
            oldLineNumber: 2,
          },
          {
            type: 'add',
            content: 'new changed line',
            newLineNumber: 2,
          },
        ],
      },
    ],
  };
}

describe('useExpandedLines', () => {
  it("never shows another diff's expanded lines on a named review's first render", async () => {
    const file = createMockDiffFile();
    const observed: string[][] = [];
    const { result, rerender } = renderHook(
      ({ frozen }) => {
        const api = useExpandedLines({
          baseCommitish: 'base-a',
          targetCommitish: 'target',
          diffIdentity: frozen ? 'capture' : 'ordinary',
          capture: frozen ? { name: 'task', version: 1 } : undefined,
        });
        if (frozen)
          observed.push(
            api.getMergedChunks(file).flatMap((chunk) => chunk.lines.map((line) => line.content)),
          );
        return api;
      },
      { initialProps: { frozen: false } },
    );
    await act(async () => result.current.expandLines(file, 0, 'up', 1));
    expect(
      result.current
        .getMergedChunks(file)
        .flatMap((chunk) => chunk.lines.map((line) => line.content)),
    ).toContain('base a line 1');
    rerender({ frozen: true });
    expect(observed.flat()).not.toContain('base a line 1');
    expect(observed.flat()).not.toContain('target line 1');
  });

  it("loads a named review's sides from its capture, not from refs", async () => {
    const file = createMockDiffFile();
    const { result } = renderHook(() =>
      useExpandedLines({
        baseCommitish: 'base-a',
        targetCommitish: '.',
        capture: { name: 'task', version: 3 },
      }),
    );
    expect(result.current.getMergedChunks(file)[0]?.hiddenLinesAfter).toBe(-1);
    await act(async () => result.current.prefetchFileContent(file));
    expect(result.current.getMergedChunks(file)[0]?.hiddenLinesAfter).toBe(1);
    await act(async () => result.current.expandAllLines(file));
    expect(
      result.current
        .getMergedChunks(file)
        .flatMap((chunk) => chunk.lines.map((line) => line.content)),
    ).toEqual(['captured line 1', 'old changed line', 'new changed line', 'captured line 3']);
    expect(vi.mocked(fetch).mock.calls.map(([input]) => String(input))).toEqual([
      '/api/blob/src%2Fapp.ts?review=task&version=3&side=old',
      '/api/blob/src%2Fapp.ts?review=task&version=3&side=new',
    ]);
  });

  it('marks a file whose named-review side cannot load, instead of showing blank lines', async () => {
    const file = createMockDiffFile();
    const { result } = renderHook(() =>
      useExpandedLines({ targetCommitish: '.', capture: { name: 'missing', version: 1 } }),
    );
    expect(result.current.hasContextLoadFailed(file)).toBe(false);
    await act(async () => result.current.expandLines(file, 0, 'up', 1));
    expect(result.current.hasContextLoadFailed(file)).toBe(true);
    expect(result.current.getMergedChunks(file)[0]?.lines).toEqual(file.chunks[0]?.lines);
  });

  it('keeps a prefetch that a child starts in the render that announces a new capture', async () => {
    // Reported by the Codex reviewer: child effects run before the hook's reset, so a
    // generation counter bumped by that reset dropped the new capture's prefetch.
    const file = createMockDiffFile();
    let latest: ReturnType<typeof useExpandedLines> | undefined;
    function Child({
      api,
      version,
    }: {
      api: ReturnType<typeof useExpandedLines>;
      version: number;
    }) {
      const { prefetchFileContent } = api;
      useEffect(() => {
        void prefetchFileContent(file);
      }, [prefetchFileContent, version]);
      return null;
    }
    function Parent({ version }: { version: number }) {
      const api = useExpandedLines({
        baseCommitish: 'base-a',
        targetCommitish: '.',
        diffIdentity: version,
        capture: { name: 'task', version },
      });
      useEffect(() => {
        latest = api;
      });
      return createElement(Child, { api, version });
    }
    const view = render(createElement(Parent, { version: 1 }));
    await waitFor(() => expect(latest?.getMergedChunks(file)[0]?.hiddenLinesAfter).toBe(1));
    view.rerender(createElement(Parent, { version: 2 }));
    await waitFor(() => expect(latest?.getMergedChunks(file)[0]?.hiddenLinesAfter).toBe(1));
  });

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(global.fetch).mockImplementation((input: string | URL | Request) => {
      const rawUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(rawUrl, 'http://localhost');
      const ref = url.searchParams.get('ref');
      const review = url.searchParams.get('review');

      const contentByRef: Record<string, string> = {
        'base-a': 'base a line 1\nold changed line\n',
        'base-b': 'base b line 1\nold changed line\n',
        target: 'target line 1\nnew changed line\n',
      };
      const contentBySide: Record<string, string> = {
        old: 'captured line 1\nold changed line\ncaptured line 3\n',
        new: 'captured line 1\nnew changed line\ncaptured line 3\n',
      };
      const body =
        review === 'task'
          ? contentBySide[url.searchParams.get('side') ?? '']
          : ref
            ? contentByRef[ref]
            : undefined;

      if (!body) {
        return Promise.resolve({
          ok: false,
          statusText: `missing fixture for ${rawUrl}`,
          text: async () => '',
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        text: async () => body,
      } as Response);
    });
  });

  it('clears expanded state and refetches content when the revision changes', async () => {
    const file = createMockDiffFile();
    const { result, rerender } = renderHook(
      ({ baseCommitish, targetCommitish, diffIdentity }) =>
        useExpandedLines({
          baseCommitish,
          targetCommitish,
          diffIdentity,
        }),
      {
        initialProps: {
          baseCommitish: 'base-a',
          targetCommitish: 'target',
          diffIdentity: 'diff-a',
        },
      },
    );

    await act(async () => {
      await result.current.expandLines(file, 0, 'up', 1);
    });

    expect(result.current.getMergedChunks(file)[0]?.lines[0]?.content).toBe('base a line 1');

    rerender({
      baseCommitish: 'base-b',
      targetCommitish: 'target',
      diffIdentity: 'diff-b',
    });

    await waitFor(() => {
      expect(result.current.expandedState).toEqual({});
    });

    await act(async () => {
      await result.current.expandLines(file, 0, 'up', 1);
    });

    expect(result.current.getMergedChunks(file)[0]?.lines[0]?.content).toBe('base b line 1');
  });

  it('clears expanded state and refetches content when the diff identity changes', async () => {
    const file = createMockDiffFile();
    let baseAContent = 'base a line 1\nold changed line\n';

    vi.mocked(global.fetch).mockImplementation((input: string | URL | Request) => {
      const rawUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(rawUrl, 'http://localhost');
      const ref = url.searchParams.get('ref');

      const contentByRef: Record<string, string> = {
        'base-a': baseAContent,
        target: 'target line 1\nnew changed line\n',
      };
      const body = ref ? contentByRef[ref] : undefined;

      if (!body) {
        return Promise.resolve({
          ok: false,
          statusText: `missing fixture for ${rawUrl}`,
          text: async () => '',
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        text: async () => body,
      } as Response);
    });

    const { result, rerender } = renderHook(
      ({ diffIdentity }) =>
        useExpandedLines({
          baseCommitish: 'base-a',
          targetCommitish: 'target',
          diffIdentity,
        }),
      {
        initialProps: {
          diffIdentity: 'diff-a',
        },
      },
    );

    await act(async () => {
      await result.current.expandLines(file, 0, 'up', 1);
    });

    expect(result.current.getMergedChunks(file)[0]?.lines[0]?.content).toBe('base a line 1');

    baseAContent = 'base a rewritten line 1\nold changed line\n';

    rerender({
      diffIdentity: 'diff-b',
    });

    await waitFor(() => {
      expect(result.current.expandedState).toEqual({});
    });

    await act(async () => {
      await result.current.expandLines(file, 0, 'up', 1);
    });

    expect(result.current.getMergedChunks(file)[0]?.lines[0]?.content).toBe(
      'base a rewritten line 1',
    );
  });

  it('does not request unavailable blob data for stdin diffs', async () => {
    const file = createMockDiffFile();
    const { result } = renderHook(() =>
      useExpandedLines({
        baseCommitish: 'stdin',
        targetCommitish: 'stdin',
        diffIdentity: 'stdin-diff',
      }),
    );

    await act(async () => {
      await result.current.prefetchFileContent(file);
      await result.current.expandLines(file, 0, 'up', 1);
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.current.expandedState).toEqual({});
  });

  it('expands every hidden line of a file and collapses them again', async () => {
    const fileLines = ['line 1', 'line 2', 'line 3', 'line 4', 'line 5', 'line 6', 'line 7'];
    vi.mocked(global.fetch).mockImplementation(
      async () => ({ ok: true, text: async () => `${fileLines.join('\n')}\n` }) as Response,
    );
    const changed = (line: number) => ({
      header: `@@ -${line} +${line} @@`,
      oldStart: line,
      oldLines: 1,
      newStart: line,
      newLines: 1,
      lines: [
        { type: 'delete' as const, content: `old ${line}`, oldLineNumber: line },
        { type: 'add' as const, content: `line ${line}`, newLineNumber: line },
      ],
    });
    const file: DiffFile = {
      path: 'src/app.ts',
      status: 'modified',
      additions: 2,
      deletions: 2,
      chunks: [changed(3), changed(5)],
    };
    const { result } = renderHook(() =>
      useExpandedLines({ baseCommitish: 'base', targetCommitish: 'target' }),
    );

    await act(async () => {
      await result.current.expandAllLines(file);
    });

    const merged = result.current.getMergedChunks(file);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.hiddenLinesBefore).toBe(0);
    expect(merged[0]?.hiddenLinesAfter).toBe(0);
    expect(merged[0]?.lines.map((line) => line.newLineNumber ?? line.oldLineNumber)).toEqual([
      1, 2, 3, 3, 4, 5, 5, 6, 7,
    ]);

    act(() => {
      result.current.collapseExpandedLines(file);
    });

    const collapsed = result.current.getMergedChunks(file);
    expect(collapsed).toHaveLength(2);
    expect(collapsed[0]?.hiddenLinesBefore).toBe(2);
    expect(collapsed[1]?.hiddenLinesAfter).toBe(2);
  });
});
