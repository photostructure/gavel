import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';

import type { DiffResponse } from '../../types/diff';
import { getFileElementId } from '../utils/domUtils';

import { useLazyDiffRendering } from './useLazyDiffRendering';

function renderLazyDiffRendering(container: HTMLElement | null) {
  return renderHook(() =>
    useLazyDiffRendering({
      diffData: null,
      diffScrollContainerRef: { current: container },
      setDiffData: () => {},
    }),
  );
}

function stubRect(element: HTMLElement, top: number) {
  element.getBoundingClientRect = () =>
    ({
      top,
      bottom: top + 100,
      left: 0,
      right: 0,
      width: 0,
      height: 100,
    }) as DOMRect;
}

describe('useLazyDiffRendering', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  function captured(name: string, version = 1): DiffResponse {
    return {
      commit: `Review: ${name}`,
      requestedBaseCommitish: 'base',
      requestedTargetCommitish: '.',
      targetCommitish: '.',
      capture: {
        name,
        version,
        patchDigest: String(version).repeat(64),
        baseCommit: 'base',
        repositoryId: 'repo',
      },
      files: [
        {
          path: `${name}-${version}.ts`,
          status: 'modified',
          additions: 1,
          deletions: 1,
          chunks: [],
          isGenerated: false,
        },
      ],
    };
  }

  it('does not query the mutable worktree for captured generated-file status', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    renderHook(() =>
      useLazyDiffRendering({
        diffData: captured('alpha'),
        diffScrollContainerRef: { current: null },
        setDiffData: vi.fn(),
      }),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('starts rendering the new capture files when named tasks or versions change', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const { result, rerender } = renderHook(
      ({ data }: { data: DiffResponse }) =>
        useLazyDiffRendering({
          diffData: data,
          diffScrollContainerRef: { current: null },
          setDiffData: vi.fn(),
        }),
      { initialProps: { data: captured('alpha') } },
    );
    expect([...result.current.renderedFilePaths]).toEqual(['alpha-1.ts']);
    rerender({ data: captured('beta') });
    expect([...result.current.renderedFilePaths]).toEqual(['beta-1.ts']);
    rerender({ data: captured('beta', 2) });
    expect([...result.current.renderedFilePaths]).toEqual(['beta-2.ts']);
  });

  it('ignores an ordinary comparison response after switching to a capture with the same Git refs', async () => {
    let finish:
      | ((response: { ok: boolean; json: () => Promise<{ isGenerated: boolean }> }) => void)
      | undefined;
    const fetch = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const named = captured('alpha');
    const ordinary: DiffResponse = { ...named, capture: undefined };
    let current: DiffResponse | null = ordinary;
    const setDiffData = vi.fn((update: React.SetStateAction<DiffResponse | null>) => {
      current = typeof update === 'function' ? update(current) : update;
    });
    const { rerender } = renderHook(
      ({ data }: { data: DiffResponse }) =>
        useLazyDiffRendering({
          diffData: data,
          diffScrollContainerRef: { current: null },
          setDiffData,
        }),
      { initialProps: { data: ordinary } },
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    current = named;
    rerender({ data: named });
    await act(async () => {
      finish?.({ ok: true, json: async () => ({ isGenerated: true }) });
    });
    expect(current).toBe(named);
    expect(current?.files[0]?.isGenerated).toBe(false);
  });

  describe('isFileScrolledPastContainerTop', () => {
    const filePath = 'src/example.ts';

    function setup(containerTop: number, targetTop: number) {
      const container = document.createElement('div');
      stubRect(container, containerTop);
      const target = document.createElement('div');
      target.id = getFileElementId(filePath);
      stubRect(target, targetTop);
      document.body.appendChild(target);

      return renderLazyDiffRendering(container);
    }

    it('returns true when the file header is scrolled above the container top', () => {
      const { result } = setup(50, 20);
      expect(result.current.isFileScrolledPastContainerTop(filePath)).toBe(true);
    });

    it('returns false when the file header is visible below the container top', () => {
      const { result } = setup(50, 120);
      expect(result.current.isFileScrolledPastContainerTop(filePath)).toBe(false);
    });

    it('returns false when the file header is aligned with the container top', () => {
      const { result } = setup(50, 50);
      expect(result.current.isFileScrolledPastContainerTop(filePath)).toBe(false);
    });

    it('returns false when the scroll container is not available', () => {
      const target = document.createElement('div');
      target.id = getFileElementId(filePath);
      stubRect(target, 0);
      document.body.appendChild(target);

      const { result } = renderLazyDiffRendering(null);
      expect(result.current.isFileScrolledPastContainerTop(filePath)).toBe(false);
    });

    it('returns false when the file element does not exist', () => {
      const container = document.createElement('div');
      stubRect(container, 0);

      const { result } = renderLazyDiffRendering(container);
      expect(result.current.isFileScrolledPastContainerTop('missing/file.ts')).toBe(false);
    });
  });

  describe('scrollFileIntoDiffContainer', () => {
    const diffData: DiffResponse = {
      commit: 'abc123',
      baseCommitish: 'HEAD^',
      targetCommitish: 'HEAD',
      files: Array.from({ length: 20 }, (_, i) => ({
        path: `file-${i}.ts`,
        status: 'modified' as const,
        additions: 1,
        deletions: 0,
        chunks: [],
      })),
      ignoreWhitespace: false,
      isEmpty: false,
    };

    function jumpToLastFile() {
      const { result } = renderHook(() =>
        useLazyDiffRendering({
          diffData,
          diffScrollContainerRef: { current: document.createElement('div') },
          setDiffData: () => {},
        }),
      );
      act(() => {
        result.current.scrollFileIntoDiffContainer('file-19.ts');
      });
      return result.current.renderedFilePaths;
    }

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('waits for lazy rendering and jumps to the first live thread below the sticky header', () => {
      vi.useFakeTimers();
      try {
        vi.stubGlobal('CSS', { supports: () => true });
        const frames: FrameRequestCallback[] = [];
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
          frames.push(callback),
        );
        const container = document.createElement('main');
        container.scrollTop = 200;
        const scrollTo = vi.fn();
        container.scrollTo = scrollTo;
        stubRect(container, 100);
        const file = document.createElement('div');
        file.id = getFileElementId('file-19.ts');
        file.dataset.rendered = 'false';
        const header = document.createElement('div');
        header.dataset.diffViewerHeader = 'true';
        header.getBoundingClientRect = () => ({ height: 80 }) as DOMRect;
        file.append(header);
        const deleted = document.createElement('div');
        deleted.dataset.commentThreadId = 'deleted';
        deleted.dataset.commentDeleted = 'true';
        file.append(deleted);
        const first = document.createElement('div');
        first.dataset.commentThreadId = 'first';
        first.tabIndex = -1;
        stubRect(first, 600);
        const second = document.createElement('div');
        second.dataset.commentThreadId = 'second';
        second.tabIndex = -1;
        stubRect(second, 900);
        file.append(first, second);
        container.append(file);
        document.body.append(container);
        const { result, unmount } = renderHook(() =>
          useLazyDiffRendering({
            diffData,
            diffScrollContainerRef: { current: container },
            setDiffData: () => {},
          }),
        );
        act(() => result.current.scrollFileIntoDiffContainer('file-19.ts', 'first-comment'));
        act(() => frames.shift()!(0));
        expect(scrollTo).not.toHaveBeenCalled();
        file.dataset.rendered = 'true';
        act(() => frames.shift()!(0));
        expect(first).toHaveFocus();
        expect(scrollTo).toHaveBeenLastCalledWith({ top: 608 });
        unmount();
        vi.clearAllTimers();
      } finally {
        vi.useRealTimers();
      }
    });

    // "Go to line" on a draft cancels the file scroll once the line appears, so the
    // 180 ms correction cannot pull the view back to the file header.
    it('cancels a pending file scroll and its later correction', () => {
      vi.useFakeTimers();
      try {
        vi.stubGlobal('CSS', { supports: () => true });
        const frames: FrameRequestCallback[] = [];
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
          frames.push(callback),
        );
        const container = document.createElement('main');
        const scrollTo = vi.fn();
        container.scrollTo = scrollTo;
        stubRect(container, 100);
        const file = document.createElement('div');
        file.id = getFileElementId('file-19.ts');
        file.dataset.rendered = 'true';
        stubRect(file, 500);
        container.append(file);
        document.body.append(container);
        const { result, unmount } = renderHook(() =>
          useLazyDiffRendering({
            diffData,
            diffScrollContainerRef: { current: container },
            setDiffData: () => {},
          }),
        );
        act(() => result.current.scrollFileIntoDiffContainer('file-19.ts'));
        act(() => frames.shift()!(0));
        expect(scrollTo).toHaveBeenCalledOnce();
        act(() => result.current.cancelFileScroll());
        act(() => vi.advanceTimersByTime(500));
        expect(scrollTo).toHaveBeenCalledOnce();
        unmount();
        container.remove();
      } finally {
        vi.useRealTimers();
      }
    });

    it('renders only the target file when the browser supports scroll anchoring', () => {
      vi.stubGlobal('CSS', { supports: () => true });

      const renderedFilePaths = jumpToLastFile();
      expect(renderedFilePaths.has('file-19.ts')).toBe(true);
      expect(renderedFilePaths.has('file-10.ts')).toBe(false);
    });

    it('renders every file above the target when the browser lacks scroll anchoring', () => {
      vi.stubGlobal('CSS', { supports: () => false });

      const renderedFilePaths = jumpToLastFile();
      expect(renderedFilePaths.size).toBe(20);
    });
  });
});
