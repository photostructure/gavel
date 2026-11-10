import { afterEach, describe, expect, it, vi } from 'vitest';

import { NAVIGATION_SELECTORS } from '../../constants/navigation';

import { createScrollToElement, linkScrollBehavior } from './scrollUtils';

// A 600px-tall scroll container holding a target 2000px down, below the viewport.
function layout() {
  const container = document.createElement('main');
  container.className = 'overflow-y-auto';
  expect(container.matches(NAVIGATION_SELECTORS.SCROLL_CONTAINER)).toBe(true);
  const target = document.createElement('div');
  target.id = 'target';
  container.append(target);
  document.body.append(container);
  Object.defineProperty(container, 'clientHeight', { value: 600 });
  Object.defineProperty(container, 'scrollHeight', { value: 5000 });
  Object.defineProperty(target, 'offsetTop', { value: 2000 });
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 600));
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 2000, 800, 40));
  const scrollTo = vi.spyOn(container, 'scrollTo').mockImplementation(() => {});
  return { container, scrollTo };
}

describe('createScrollToElement', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('jumps to put the element a third of the way down by default', () => {
    const { container, scrollTo } = layout();
    expect(createScrollToElement()('target')).toBe(true);
    expect(container.scrollTop).toBe(1800);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('reports that it left an element in full view alone', () => {
    const { scrollTo } = layout();
    vi.spyOn(document.getElementById('target')!, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 100, 800, 40),
    );
    expect(createScrollToElement()('target', 'smooth')).toBe(false);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('animates the same scroll when asked to', () => {
    const { container, scrollTo } = layout();
    createScrollToElement()('target', 'smooth');
    expect(scrollTo).toHaveBeenCalledWith({ top: 1800, behavior: 'smooth' });
    expect(container.scrollTop).toBe(0);
  });
});

describe('linkScrollBehavior', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    [false, 'smooth'],
    [true, 'auto'],
  ])('animates unless the reader asks for reduced motion (reduce: %s)', (reduce, behavior) => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query) =>
        ({ matches: reduce && query === '(prefers-reduced-motion: reduce)' }) as MediaQueryList,
    );
    expect(linkScrollBehavior()).toBe(behavior);
  });
});
