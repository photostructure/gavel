import { useCallback, useEffect, useRef, useState, type RefObject, type UIEvent } from 'react';

import { type DiffFile } from '../../types/diff';

// The container's children with a data-file-path are the files, top to bottom,
// so the first one whose bottom edge is below the container's top edge is the
// one at the top.
function findTopFilePath(container: HTMLElement): string | null {
  const files = Array.from(container.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && 'filePath' in child.dataset,
  );
  const containerTop = container.getBoundingClientRect().top;
  let low = 0;
  let high = files.length - 1;
  let found: string | null = null;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const file = files[mid];
    if (!file) throw new Error(`findTopFilePath: no file element at index ${mid}`);
    if (file.getBoundingClientRect().bottom > containerTop) {
      found = file.dataset.filePath ?? null;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return found;
}

type TopVisibleFile = {
  topFilePath: string | null;
  onScroll: (event: UIEvent<HTMLElement>) => void;
};

/**
 * Tracks which file sits at the top edge of the diff scroll container: measured
 * when `files` changes, then once per animation frame while it scrolls.
 */
export function useTopVisibleFile(
  containerRef: RefObject<HTMLElement | null>,
  files: readonly DiffFile[],
): TopVisibleFile {
  const [topFilePath, setTopFilePath] = useState<string | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    // The container renders only once a diff has loaded.
    const container = containerRef.current;
    if (!container) return;
    setTopFilePath(findTopFilePath(container));
  }, [containerRef, files]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const onScroll = useCallback((event: UIEvent<HTMLElement>) => {
    if (frameRef.current !== null) return;
    const container = event.currentTarget;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setTopFilePath(findTopFilePath(container));
    });
  }, []);

  return { topFilePath, onScroll };
}
