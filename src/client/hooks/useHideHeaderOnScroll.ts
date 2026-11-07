import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import type { RefObject, UIEvent } from 'react';

import { MEDIA_QUERIES } from '../constants/breakpoints';

// Scroll movement below this is touch jitter or momentum noise; it accumulates until it counts.
const SCROLL_JITTER_PX = 8;

const subscribeToAutoHideQuery = (onChange: () => void) => {
  const query = window.matchMedia(MEDIA_QUERIES.autoHideHeader);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

const matchesAutoHideQuery = () => window.matchMedia(MEDIA_QUERIES.autoHideHeader).matches;

type HideHeaderOnScroll = {
  headerHidden: boolean;
  headerRef: RefObject<HTMLDivElement | null>;
  onScroll: (event: UIEvent<HTMLElement>) => void;
  revealHeader: () => void;
};

/**
 * On phones and tablets, and in windows no taller than a landscape phone, hides the review
 * header while the diff scrolls down and shows it again on scroll up, so the diff gets the
 * header's height.
 */
export function useHideHeaderOnScroll(): HideHeaderOnScroll {
  const enabled = useSyncExternalStore(subscribeToAutoHideQuery, matchesAutoHideQuery);
  const [hidden, setHidden] = useState(false);
  const [wasEnabled, setWasEnabled] = useState(enabled);
  if (enabled !== wasEnabled) {
    setWasEnabled(enabled);
    setHidden(false);
  }
  const headerRef = useRef<HTMLDivElement | null>(null);
  const lastScrollTop = useRef(0);

  const onScroll = useCallback(
    (event: UIEvent<HTMLElement>) => {
      const container = event.currentTarget;
      const maxScrollTop = container.scrollHeight - container.clientHeight;
      // WebKit reports positions past either end while rubber-banding; the spring back from
      // them is not a scroll in the other direction.
      const top = Math.min(Math.max(container.scrollTop, 0), maxScrollTop);
      const delta = top - lastScrollTop.current;
      if (Math.abs(delta) < SCROLL_JITTER_PX) return;
      lastScrollTop.current = top;
      if (!enabled) return;
      if (delta < 0) {
        setHidden(false);
        return;
      }
      // Hiding the header makes the container taller by its height. Closer than that to the
      // end, the browser pulls scrollTop back, which would read as an upward scroll.
      const remaining = maxScrollTop - top;
      const header = headerRef.current;
      if (!header) throw new Error('useHideHeaderOnScroll: headerRef is not attached');
      if (remaining > header.offsetHeight) setHidden(true);
    },
    [enabled],
  );

  const revealHeader = useCallback(() => setHidden(false), []);

  return { headerHidden: enabled && hidden, headerRef, onScroll, revealHeader };
}
