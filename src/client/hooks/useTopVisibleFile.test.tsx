import { act, fireEvent, render, screen } from '@testing-library/react';
import { Profiler, useRef } from 'react';
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

// App puts the change summary above the files, as a sibling with data-review-summary.
const SUMMARY_HEIGHT = 200;

// Counts Layout commits (through Profiler), so a test can tell an unchanged measurement from a
// re-render.
let renders = 0;

function Layout({ withSummary }: { withSummary: boolean }) {
  const containerRef = useRef<HTMLElement | null>(null);
  const { topFilePath, summaryAtTop, onScroll } = useTopVisibleFile(containerRef, FILES);
  return (
    <>
      <output data-testid="top">{topFilePath ?? 'none'}</output>
      <output data-testid="summary">{String(summaryAtTop)}</output>
      <main ref={containerRef} data-testid="main" onScroll={onScroll}>
        {withSummary && <section data-review-summary="" />}
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

function renderLayout(withSummary = false) {
  let scrollTop = 0;
  const filesTop = CONTAINER_TOP + (withSummary ? SUMMARY_HEIGHT + FILE_MARGIN : 0);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.dataset.testid === 'main') return rect(CONTAINER_TOP, 600);
    if ('reviewSummary' in this.dataset) return rect(CONTAINER_TOP - scrollTop, SUMMARY_HEIGHT);
    const index = PATHS.indexOf(this.dataset.filePath ?? '');
    const offset = FILE_HEIGHTS.slice(0, index).reduce((sum, h) => sum + h + FILE_MARGIN, 0);
    return rect(filesTop + offset - scrollTop, FILE_HEIGHTS[index] ?? 0);
  });
  render(
    <Profiler
      id="layout"
      onRender={() => {
        renders += 1;
      }}
    >
      <Layout withSummary={withSummary} />
    </Profiler>,
  );
  const main = screen.getByTestId('main');
  const scrollTo = async (top: number) => {
    scrollTop = top;
    fireEvent.scroll(main);
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  };
  return {
    scrollTo,
    top: () => screen.getByTestId('top').textContent,
    summaryAtTop: () => screen.getByTestId('summary').textContent,
  };
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

describe('useTopVisibleFile with a change summary', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reports the summary while it spans the top edge, then the file below it', async () => {
    const { scrollTo, summaryAtTop, top } = renderLayout(true);
    expect(summaryAtTop()).toBe('true');

    // The summary spans 100–300 before scrolling; at 210 it ends at 90, above the top at 100.
    await scrollTo(210);
    expect(summaryAtTop()).toBe('false');
    expect(top()).toBe('src/file-0.ts');

    await scrollTo(0);
    expect(summaryAtTop()).toBe('true');
  });

  it('reports no summary when the diff has none', () => {
    const { summaryAtTop } = renderLayout();
    expect(summaryAtTop()).toBe('false');
  });
});

// App re-renders, and with it the file list, whenever this hook's state changes; a scroll that
// leaves the top item where it was must not change it.
it('does not re-render on scroll frames that leave the top item unchanged', async () => {
  const { scrollTo } = renderLayout(true);
  const before = renders;

  for (const top of [1, 2, 3, 4, 5]) await scrollTo(top);

  // React may render once more before it starts bailing out of identical state.
  expect(renders - before).toBeLessThanOrEqual(1);
  vi.restoreAllMocks();
});
