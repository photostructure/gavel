import { useCallback, useEffect, useRef, useState, type RefObject, type UIEvent } from 'react';

import { type DiffFile } from '../../types/diff';

type TopItem = {
  topFilePath: string | null;
  // The change summary sits above the files and still spans the container's top edge.
  summaryAtTop: boolean;
};

// The container's children with a data-file-path are the files, top to bottom,
// so the first one whose bottom edge is below the container's top edge is the
// one at the top. The change summary, with data-review-summary, comes before them.
function findTopItem(container: HTMLElement): TopItem {
  const children = Array.from(container.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );
  const files = children.filter((child) => 'filePath' in child.dataset);
  const summary = children.find((child) => 'reviewSummary' in child.dataset);
  const containerTop = container.getBoundingClientRect().top;
  let low = 0;
  let high = files.length - 1;
  let found: string | null = null;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const file = files[mid];
    if (!file) throw new Error(`findTopItem: no file element at index ${mid}`);
    if (file.getBoundingClientRect().bottom > containerTop) {
      found = file.dataset.filePath ?? null;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return {
    topFilePath: found,
    summaryAtTop: summary !== undefined && summary.getBoundingClientRect().bottom > containerTop,
  };
}

type TopVisibleFile = TopItem & {
  onScroll: (event: UIEvent<HTMLElement>) => void;
};

/**
 * Tracks which file sits at the top edge of the diff scroll container, and whether the change
 * summary above the files still does: measured when `files` changes, then once per animation
 * frame while it scrolls.
 */
export function useTopVisibleFile(
  containerRef: RefObject<HTMLElement | null>,
  files: readonly DiffFile[],
): TopVisibleFile {
  // Two primitives rather than one object, so a scroll frame that measures the same top item
  // sets identical state and React skips re-rendering App.
  const [topFilePath, setTopFilePath] = useState<string | null>(null);
  const [summaryAtTop, setSummaryAtTop] = useState(false);
  const frameRef = useRef<number | null>(null);

  const setTopItem = useCallback((item: TopItem) => {
    setTopFilePath(item.topFilePath);
    setSummaryAtTop(item.summaryAtTop);
  }, []);

  useEffect(() => {
    // The container renders only once a diff has loaded.
    const container = containerRef.current;
    if (!container) return;
    setTopItem(findTopItem(container));
  }, [containerRef, files, setTopItem]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const onScroll = useCallback(
    (event: UIEvent<HTMLElement>) => {
      if (frameRef.current !== null) return;
      const container = event.currentTarget;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        setTopItem(findTopItem(container));
      });
    },
    [setTopItem],
  );

  return { topFilePath, summaryAtTop, onScroll };
}
