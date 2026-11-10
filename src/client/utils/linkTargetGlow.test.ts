import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FADE_MS,
  HOLD_MS,
  SCROLL_END_FALLBACK_MS,
  glowLinkTarget,
  whenScrollEnds,
} from './linkTargetGlow';

const glowing = (card: HTMLElement) => card.classList.contains('comment-link-glow');
const fading = (card: HTMLElement) => card.classList.contains('comment-link-glow-fade');

describe('glowLinkTarget', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('glows at once, holds while the view scrolls, and fades after the scroll ends', () => {
    const card = document.createElement('div');
    const container = document.createElement('main');
    glowLinkTarget(card, container);
    expect(glowing(card)).toBe(true);
    // A long smooth scroll: still glowing just before the fallback would end it.
    vi.advanceTimersByTime(SCROLL_END_FALLBACK_MS - 1);
    expect(glowing(card)).toBe(true);
    container.dispatchEvent(new Event('scrollend'));
    expect(glowing(card)).toBe(false);
    expect(fading(card)).toBe(true);
    vi.advanceTimersByTime(FADE_MS);
    expect(fading(card)).toBe(false);
  });

  it('holds only while it comes up when the view did not scroll', () => {
    // The fade opens with the arrival throb, so it should follow the glow almost at once.
    expect(HOLD_MS).toBeLessThanOrEqual(300);
  });

  it('holds briefly and fades when the view did not scroll', () => {
    const card = document.createElement('div');
    glowLinkTarget(card, null);
    vi.advanceTimersByTime(HOLD_MS - 1);
    expect(glowing(card)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(fading(card)).toBe(true);
    vi.advanceTimersByTime(FADE_MS);
    expect(card.className).toBe('');
  });

  it('keeps a later glow when an earlier jump to the same element finishes scrolling', () => {
    const card = document.createElement('div');
    const first = document.createElement('main');
    const second = document.createElement('main');
    glowLinkTarget(card, first);
    glowLinkTarget(card, second);
    first.dispatchEvent(new Event('scrollend'));
    expect(glowing(card)).toBe(true);
    second.dispatchEvent(new Event('scrollend'));
    expect(fading(card)).toBe(true);
  });

  it('starts over when the same element is linked again', () => {
    const card = document.createElement('div');
    glowLinkTarget(card, null);
    vi.advanceTimersByTime(HOLD_MS + FADE_MS - 1);
    glowLinkTarget(card, null);
    expect(glowing(card)).toBe(true);
    expect(fading(card)).toBe(false);
    vi.advanceTimersByTime(HOLD_MS - 1);
    expect(glowing(card)).toBe(true);
  });
});

describe('whenScrollEnds', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs once the container reports the end of its scroll', () => {
    const container = document.createElement('main');
    const done = vi.fn();
    whenScrollEnds(container, done);
    expect(done).not.toHaveBeenCalled();
    container.dispatchEvent(new Event('scrollend'));
    vi.advanceTimersByTime(SCROLL_END_FALLBACK_MS);
    container.dispatchEvent(new Event('scrollend'));
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('runs anyway in a browser that never reports it', () => {
    const container = document.createElement('main');
    const done = vi.fn();
    whenScrollEnds(container, done);
    vi.advanceTimersByTime(SCROLL_END_FALLBACK_MS - 1);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(done).toHaveBeenCalledTimes(1);
  });
});
