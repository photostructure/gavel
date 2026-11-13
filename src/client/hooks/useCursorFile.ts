import { useCallback, useEffect, useRef, useState, type RefObject, type UIEvent } from 'react';

function isOnScreen(container: HTMLElement, path: string): boolean {
  // The container's children with a data-file-path are the files.
  const section = Array.from(container.children).find(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.dataset.filePath === path,
  );
  if (!section) return false;
  const view = container.getBoundingClientRect();
  const box = section.getBoundingClientRect();
  return box.bottom > view.top && box.top < view.bottom;
}

type CursorFile = {
  path: string | null;
  onScroll: (event: UIEvent<HTMLElement>) => void;
};

/**
 * The file that holds gavel's line cursor, while that file is on screen in the diff scroll
 * container; null otherwise, so the caller can fall back to the file at the top of the screen.
 * The cursor is the one record of where you are: line clicks, j/k, `.`, comment links, and
 * clicks into comments all move it. Measured when the cursor changes file, then once per
 * animation frame while the container scrolls; `onScroll` goes on the container.
 */
export function useCursorFile(
  containerRef: RefObject<HTMLElement | null>,
  cursorFilePath: string | null,
  // App renders the container only while it is not loading, and loads again on a review switch.
  containerShown: boolean,
): CursorFile {
  const [path, setPath] = useState<string | null>(null);
  const cursorFileRef = useRef(cursorFilePath);
  const frameRef = useRef<number | null>(null);

  const measure = useCallback((container: HTMLElement) => {
    const cursorFile = cursorFileRef.current;
    setPath(cursorFile !== null && isOnScreen(container, cursorFile) ? cursorFile : null);
  }, []);

  useEffect(() => {
    cursorFileRef.current = cursorFilePath;
    const container = containerRef.current;
    if (containerShown && container) measure(container);
    else setPath(null);
  }, [containerRef, containerShown, cursorFilePath, measure]);

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
        measure(container);
      });
    },
    [measure],
  );

  return { path, onScroll };
}
