import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SLIDE_OVER_MS, useSlideOver } from './useSlideOver';

describe('keeping a slide-over panel rendered while it slides out', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const mount = (isOpen: boolean) =>
    renderHook(({ isOpen }) => useSlideOver(isOpen).rendered, { initialProps: { isOpen } });

  it('renders nothing for a panel that starts closed', () => {
    expect(mount(false).result.current).toBe(false);
  });

  it('keeps a closed panel rendered until its slide out ends', () => {
    const { result, rerender } = mount(true);
    rerender({ isOpen: false });
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(SLIDE_OVER_MS - 1));
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(false);
  });

  it('stays rendered, with a new key, when the panel reopens during its slide out', () => {
    const { result, rerender } = renderHook(({ isOpen }) => useSlideOver(isOpen), {
      initialProps: { isOpen: true },
    });
    const firstOpening = result.current.openings;
    rerender({ isOpen: false });
    act(() => vi.advanceTimersByTime(SLIDE_OVER_MS / 2));
    rerender({ isOpen: true });
    act(() => vi.advanceTimersByTime(SLIDE_OVER_MS));
    expect(result.current.rendered).toBe(true);
    expect(result.current.openings).not.toBe(firstOpening);
  });
});
