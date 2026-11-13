import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useCursorFile } from './useCursorFile';

const CONTAINER_TOP = 100;
const CONTAINER_HEIGHT = 600;
const FILE_HEIGHT = 400;
const PATHS = ['src/file-0.ts', 'src/file-1.ts', 'src/file-2.ts'];

// App renders the diff container only once loading ends, after the hook's first render.
function Layout({
  loading = false,
  cursorFile = null,
}: {
  loading?: boolean;
  cursorFile?: string | null;
}) {
  const containerRef = useRef<HTMLElement | null>(null);
  const shown = useCursorFile(containerRef, cursorFile, !loading);
  return (
    <>
      <output data-testid="shown">{shown.path ?? 'none'}</output>
      {!loading && (
        <main ref={containerRef} data-testid="main" onScroll={shown.onScroll}>
          {PATHS.map((path) => (
            <div key={path} data-file-path={path} />
          ))}
        </main>
      )}
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

// Files are FILE_HEIGHT tall and stack from the container's top; the container shows 100-700.
function renderLayout(cursorFile: string | null = null) {
  let scrollTop = 0;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.dataset.testid === 'main') return rect(CONTAINER_TOP, CONTAINER_HEIGHT);
    const index = PATHS.indexOf(this.dataset.filePath ?? '');
    return rect(CONTAINER_TOP + index * FILE_HEIGHT - scrollTop, FILE_HEIGHT);
  });
  const view = render(<Layout loading cursorFile={cursorFile} />);
  view.rerender(<Layout cursorFile={cursorFile} />);
  const scrollTo = async (top: number) => {
    scrollTop = top;
    fireEvent.scroll(screen.getByTestId('main'));
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  };
  return {
    scrollTo,
    moveCursor: (file: string | null) => view.rerender(<Layout cursorFile={file} />),
    shown: () => screen.getByTestId('shown').textContent,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('useCursorFile', () => {
  it('names nothing without a cursor', () => {
    const { shown } = renderLayout();

    expect(shown()).toBe('none');
  });

  it("names the cursor's file once the diff container renders", () => {
    const { shown } = renderLayout('src/file-1.ts');

    expect(shown()).toBe('src/file-1.ts');
  });

  it('follows the cursor to another file', () => {
    const { shown, moveCursor } = renderLayout('src/file-0.ts');

    moveCursor('src/file-1.ts');

    expect(shown()).toBe('src/file-1.ts');
  });

  it("lets go while the cursor's file is scrolled out of view, and returns with it", async () => {
    const { shown, scrollTo } = renderLayout('src/file-1.ts');

    // file-1 spans 500-900; at scrollTop 850 it ends at 50, above the container's top at 100.
    await scrollTo(850);
    expect(shown()).toBe('none');

    await scrollTo(0);
    expect(shown()).toBe('src/file-1.ts');
  });
});
