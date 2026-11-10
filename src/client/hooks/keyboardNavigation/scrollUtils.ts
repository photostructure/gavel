import { NAVIGATION_SELECTORS } from '../../constants/navigation';

import { SCROLL_CONSTANTS } from './types';

/**
 * Smart scroll implementation inspired by Gerrit
 * Only scrolls when necessary to improve user experience
 */
export function createScrollToElement() {
  // 'smooth' animates the scroll, so a reader who followed a link sees the view move. Returns
  // whether the view moves, so a caller can wait for a smooth scroll to end.
  return (elementId: string, behavior: ScrollBehavior = 'auto'): boolean => {
    const element = document.getElementById(elementId);
    if (!element) return false;

    // The main scrollable container is always the same in this app
    const scrollContainer = document.querySelector(
      NAVIGATION_SELECTORS.SCROLL_CONTAINER,
    ) as HTMLElement | null;
    if (!scrollContainer) {
      throw new Error(`Scrollable container (${NAVIGATION_SELECTORS.SCROLL_CONTAINER}) not found`);
    }

    const rect = element.getBoundingClientRect();
    const containerRect = scrollContainer.getBoundingClientRect();
    const viewportHeight = scrollContainer.clientHeight;
    const scrollTop = scrollContainer.scrollTop;
    const scrollToTop = (target: number) => {
      // The browser stops at the end of the content, and does not move to where it already is.
      const top = Math.min(Math.max(0, target), scrollContainer.scrollHeight - viewportHeight);
      if (Math.round(top) === Math.round(scrollTop)) return false;
      if (behavior === 'auto') scrollContainer.scrollTop = top;
      else scrollContainer.scrollTo({ top, behavior });
      return true;
    };

    // Check if element is visible within the container's viewport
    const visibleTop = Math.max(containerRect.top, 0);
    const visibleBottom = Math.min(containerRect.bottom, window.innerHeight);
    const isVisible = rect.top >= visibleTop && rect.bottom <= visibleBottom;

    // If element is not visible, always scroll
    if (!isVisible) {
      const offsetTop = calculateOffsetTop(element, scrollContainer);
      const targetScrollTop = offsetTop - viewportHeight * SCROLL_CONSTANTS.VIEWPORT_OFFSET_RATIO;
      return scrollToTop(targetScrollTop);
    }

    // Element is visible - only scroll if bottom edge is hidden AND we would scroll down
    const isBottomHidden = rect.bottom > Math.min(containerRect.bottom, window.innerHeight);
    const elementPosInContainer = element.offsetTop - scrollContainer.offsetTop;
    const targetScrollTop =
      elementPosInContainer - viewportHeight * SCROLL_CONSTANTS.VIEWPORT_OFFSET_RATIO;
    const wouldScrollDown = targetScrollTop > scrollTop;

    return isBottomHidden && wouldScrollDown && scrollToTop(targetScrollTop);
  };
}

/**
 * Calculates the offset of an element relative to its scroll container
 */
function calculateOffsetTop(element: HTMLElement, container: HTMLElement): number {
  let currentElement: HTMLElement | null = element;
  let offsetTop = 0;

  // Walk up the DOM tree accumulating offsets until we reach the container
  while (currentElement && currentElement !== container && currentElement.offsetParent) {
    offsetTop += currentElement.offsetTop;
    currentElement = currentElement.offsetParent as HTMLElement;
  }

  // Add final offset if we haven't reached the container
  if (currentElement && currentElement !== container) {
    offsetTop += currentElement.offsetTop;
  }

  return offsetTop;
}

/** How a jump from a link scrolls: animated, unless the reader asks for reduced motion. */
export function linkScrollBehavior(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}
