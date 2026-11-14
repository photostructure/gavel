import { useEffect, useState } from 'react';

/** How long About and Conversation take to slide out; the .slide-over rules in global.css match it. */
export const SLIDE_OVER_MS = 300;

/**
 * Whether a slide-over panel should render: while it is open, and for SLIDE_OVER_MS after it
 * closes so it can slide out. `openings` counts the times it opened; use it as the panel's key
 * so reopening during the slide out mounts fresh contents, as reopening after it does.
 */
export function useSlideOver(isOpen: boolean): { rendered: boolean; openings: number } {
  const [wasOpen, setWasOpen] = useState(isOpen);
  const [closing, setClosing] = useState(false);
  const [openings, setOpenings] = useState(0);
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    setClosing(!isOpen);
    if (isOpen) setOpenings((count) => count + 1);
  }
  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => setClosing(false), SLIDE_OVER_MS);
    return () => clearTimeout(timer);
  }, [closing]);
  return { rendered: isOpen || closing, openings };
}
