import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type DiffFile } from '../../types/diff';

import { useTopVisibleFile } from './useTopVisibleFile';

const CONTAINER_TOP = 100;
const FILE_MARGIN = 24;

// Each file's height; files stack top to bottom with FILE_MARGIN between them.
const FILE_HEIGHTS = [300, 500, 200, 800];
const PATHS = FILE_HEIGHTS.map((_, index) => `src/file-${index}.ts`);
const FILES: DiffFile[] = PATHS.map((path) => ({
  path,
  status: 'modified',
  additions: 0,
  deletions: 0,
  chunks: [],
}));

function Layout() {
  const containerRef = useRef<HTMLElement | null>(null);
  const { topFilePath, onScroll } = useTopVisibleFile(containerRef, FILES);
  return (
    <>
      <output data-testid="top">{topFilePath ?? 'none'}</output>
      <main ref={containerRef} data-testid="main" onScroll={onScroll}>
        {PATHS.map((path) => (
          <div key={path} data-file-path={path} />
        ))}
      </main>
    </>
  );
}

function rect(top: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    height,
    left: 0,
    right: 0,
    width: 0,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

function renderLayout() {
  let scrollTop = 0;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.dataset.testid === 'main') return rect(CONTAINER_TOP, 600);
    const index = PATHS.indexOf(this.dataset.filePath ?? '');
    const offset = FILE_HEIGHTS.slice(0, index).reduce((sum, h) => sum + h + FILE_MARGIN, 0);
    return rect(CONTAINER_TOP + offset - scrollTop, FILE_HEIGHTS[index] ?? 0);
  });
  render(<Layout />);
  const main = screen.getByTestId('main');
  const scrollTo = async (top: number) => {
    scrollTop = top;
    fireEvent.scroll(main);
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  };
  return { scrollTo, top: () => screen.getByTestId('top').textContent };
}

describe('useTopVisibleFile', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reports the first file before any scroll', () => {
    const { top } = renderLayout();
    expect(top()).toBe('src/file-0.ts');
  });

  it('reports the file that spans the top edge of the scroll container', async () => {
    const { scrollTo, top } = renderLayout();

    await scrollTo(299);
    expect(top()).toBe('src/file-0.ts');

    // file-1 starts at 324; 310 is in the margin below file-0
    await scrollTo(310);
    expect(top()).toBe('src/file-1.ts');

    // file-2 spans 848–1048, file-3 starts at 1072
    await scrollTo(900);
    expect(top()).toBe('src/file-2.ts');

    await scrollTo(1060);
    expect(top()).toBe('src/file-3.ts');

    await scrollTo(0);
    expect(top()).toBe('src/file-0.ts');
  });
});
