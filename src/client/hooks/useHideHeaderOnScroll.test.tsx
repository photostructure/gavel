import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MEDIA_QUERIES } from '../constants/breakpoints';

import { useHideHeaderOnScroll } from './useHideHeaderOnScroll';

const HEADER_HEIGHT = 120;
const CONTENT_HEIGHT = 5000;
const VIEWPORT_HEIGHT = 300;

function Layout() {
  const { headerHidden, headerRef, onScroll, revealHeader } = useHideHeaderOnScroll();
  return (
    <>
      <div
        ref={headerRef}
        data-testid="header"
        data-hidden={headerHidden ? 'true' : 'false'}
        onFocusCapture={revealHeader}
      >
        <button type="button">Settings</button>
      </div>
      <main data-testid="main" onScroll={onScroll} />
    </>
  );
}

function stubAutoHideQuery(initiallyMatches: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: initiallyMatches,
    addEventListener: (_type: 'change', listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: 'change', listener: () => void) => listeners.delete(listener),
  };
  vi.spyOn(window, 'matchMedia').mockImplementation((media) => {
    expect(media).toBe(MEDIA_QUERIES.autoHideHeader);
    return query as unknown as MediaQueryList;
  });
  return (matches: boolean) => {
    query.matches = matches;
    act(() => listeners.forEach((listener) => listener()));
  };
}

function renderLayout() {
  render(<Layout />);
  const header = screen.getByTestId('header');
  const main = screen.getByTestId('main');
  Object.defineProperty(header, 'offsetHeight', { value: HEADER_HEIGHT });
  Object.defineProperty(main, 'scrollHeight', { value: CONTENT_HEIGHT });
  Object.defineProperty(main, 'clientHeight', { value: VIEWPORT_HEIGHT });
  const scrollTo = (top: number) => {
    Object.defineProperty(main, 'scrollTop', { value: top, configurable: true });
    fireEvent.scroll(main);
  };
  return { header, scrollTo };
}

describe('useHideHeaderOnScroll', () => {
  afterEach(() => vi.restoreAllMocks());

  it('hides the header while the diff scrolls down and shows it on scroll up', () => {
    stubAutoHideQuery(true);
    const { header, scrollTo } = renderLayout();

    scrollTo(200);
    expect(header).toHaveAttribute('data-hidden', 'true');
    scrollTo(150);
    expect(header).toHaveAttribute('data-hidden', 'false');
  });

  it('keeps the header with a mouse in a window taller than a landscape phone', () => {
    stubAutoHideQuery(false);
    const { header, scrollTo } = renderLayout();

    scrollTo(200);
    expect(header).toHaveAttribute('data-hidden', 'false');
  });

  it('ignores scroll movement smaller than 8px until it adds up', () => {
    stubAutoHideQuery(true);
    const { header, scrollTo } = renderLayout();

    scrollTo(5);
    expect(header).toHaveAttribute('data-hidden', 'false');
    scrollTo(10);
    expect(header).toHaveAttribute('data-hidden', 'true');
    scrollTo(5);
    expect(header).toHaveAttribute('data-hidden', 'true');
  });

  // Hiding the header makes the scroll area taller. Within one header height of the end,
  // the browser would pull scrollTop back, which reads as an upward scroll and shows it again.
  it('keeps the header when hiding it would pull the scroll position back from the end', () => {
    stubAutoHideQuery(true);
    const { header, scrollTo } = renderLayout();

    scrollTo(CONTENT_HEIGHT - VIEWPORT_HEIGHT - HEADER_HEIGHT + 1);
    expect(header).toHaveAttribute('data-hidden', 'false');
  });

  // WebKit reports scrollTop past either end while rubber-banding
  // (https://bugs.webkit.org/show_bug.cgi?id=198597); the spring back is not a scroll down.
  it('keeps the header when the diff springs back from overscrolling the top', () => {
    stubAutoHideQuery(true);
    const { header, scrollTo } = renderLayout();

    scrollTo(-40);
    scrollTo(0);
    expect(header).toHaveAttribute('data-hidden', 'false');
  });

  it('throws when the header ref is not attached', () => {
    stubAutoHideQuery(true);
    function Unattached() {
      const { onScroll } = useHideHeaderOnScroll();
      return <main data-testid="main" onScroll={onScroll} />;
    }
    render(<Unattached />);
    const main = screen.getByTestId('main');
    Object.defineProperty(main, 'scrollHeight', { value: CONTENT_HEIGHT });
    Object.defineProperty(main, 'clientHeight', { value: VIEWPORT_HEIGHT });
    Object.defineProperty(main, 'scrollTop', { value: 200 });
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => {
      errors.push(event.error);
      event.preventDefault();
    };
    window.addEventListener('error', onError);
    try {
      fireEvent.scroll(main);
    } catch (error) {
      errors.push(error);
    } finally {
      window.removeEventListener('error', onError);
    }
    expect(errors).toEqual([new Error('useHideHeaderOnScroll: headerRef is not attached')]);
  });

  it('shows the header when keyboard focus moves into it', () => {
    stubAutoHideQuery(true);
    const { header, scrollTo } = renderLayout();

    scrollTo(200);
    expect(header).toHaveAttribute('data-hidden', 'true');
    act(() => screen.getByRole('button', { name: 'Settings' }).focus());
    expect(header).toHaveAttribute('data-hidden', 'false');
  });

  it('shows the header when the device or window stops matching the auto-hide query', () => {
    const setMatches = stubAutoHideQuery(true);
    const { header, scrollTo } = renderLayout();

    scrollTo(200);
    expect(header).toHaveAttribute('data-hidden', 'true');
    setMatches(false);
    expect(header).toHaveAttribute('data-hidden', 'false');
    setMatches(true);
    expect(header).toHaveAttribute('data-hidden', 'false');
  });
});
