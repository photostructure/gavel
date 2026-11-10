const GLOW_CLASS = 'comment-link-glow';
const FADE_CLASS = 'comment-link-glow-fade';
/** How long the glow holds when the view did not scroll: the time it takes to come up. */
export const HOLD_MS = 250;
/** The arrival throb and the fade after it; comment-link-glow-fade in global.css matches it. */
export const FADE_MS = 2000;
/** How long to wait for a smooth scroll where the browser does not fire scrollend. */
export const SCROLL_END_FALLBACK_MS = 1000;

const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>();
// Counts each element's glows, so a scroll that ends after a later glow began leaves it alone.
const generations = new WeakMap<Element, number>();

/** Runs `callback` once `container`'s smooth scroll has ended. */
export function whenScrollEnds(container: HTMLElement, callback: () => void): void {
  const done = () => {
    clearTimeout(fallback);
    container.removeEventListener('scrollend', done);
    callback();
  };
  const fallback = setTimeout(done, SCROLL_END_FALLBACK_MS);
  container.addEventListener('scrollend', done);
}

function fade(element: HTMLElement): void {
  element.classList.replace(GLOW_CLASS, FADE_CLASS);
  timers.set(
    element,
    setTimeout(() => element.classList.remove(FADE_CLASS), FADE_MS),
  );
}

/**
 * Rings the element a comment link led to, so the reader sees where they landed. The glow
 * starts at once and holds while `scrolling` (the container of a smooth scroll, or null when
 * the view did not move) scrolls to it, then throbs once on arrival and fades.
 */
export function glowLinkTarget(element: HTMLElement, scrolling: HTMLElement | null): void {
  clearTimeout(timers.get(element));
  const generation = (generations.get(element) ?? 0) + 1;
  generations.set(element, generation);
  element.classList.remove(GLOW_CLASS, FADE_CLASS);
  // Reading layout between removing and adding the class restarts the animation.
  void element.offsetWidth;
  element.classList.add(GLOW_CLASS);
  if (scrolling) {
    whenScrollEnds(scrolling, () => {
      if (generations.get(element) === generation) fade(element);
    });
  } else {
    timers.set(
      element,
      setTimeout(() => fade(element), HOLD_MS),
    );
  }
}
