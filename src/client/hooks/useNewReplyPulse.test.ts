import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UNREAD_PULSE_MS, useNewReplyPulse } from './useNewReplyPulse';

type Reply = { key: string; revision: string };
const update = (id: string, revision = 'r1'): Reply => ({ key: id, revision });

describe('pulsing the unread badge for new replies', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const mount = (all: Reply[], ready = true, unread = all) =>
    renderHook(({ all, unread, ready }) => useNewReplyPulse(all, unread, ready), {
      initialProps: { all, unread, ready },
    });

  it('stays quiet for the replies that exist when the page finishes loading', () => {
    const { result, rerender } = mount([update('early')], false);
    expect(result.current).toBe(0);
    const loaded = [update('early'), update('loaded')];
    rerender({ all: loaded, unread: loaded, ready: true });
    expect(result.current).toBe(0);
  });

  it('pulses for a reply this page has not seen', () => {
    const { result, rerender } = mount([update('a')]);
    const next = [update('a'), update('b')];
    rerender({ all: next, unread: next, ready: true });
    expect(result.current).toBeGreaterThan(0);
  });

  it('stays quiet when a known reply leaves the list and comes back', () => {
    const { result, rerender } = mount([update('a')]);
    rerender({ all: [], unread: [], ready: false });
    rerender({ all: [], unread: [], ready: true });
    rerender({ all: [update('a')], unread: [update('a')], ready: true });
    expect(result.current).toBe(0);
  });

  it('stays quiet when a reply read before the page loaded is marked unread', () => {
    const old = update('old');
    const { result, rerender } = mount([old], true, []);
    rerender({ all: [old], unread: [old], ready: true });
    expect(result.current).toBe(0);
  });

  it('stays quiet for a new reply another browser tab has already read', () => {
    const { result, rerender } = mount([update('a')]);
    rerender({ all: [update('a'), update('b')], unread: [update('a')], ready: true });
    expect(result.current).toBe(0);
  });

  it('pulses again for an edited reply', () => {
    const { result, rerender } = mount([update('a')]);
    rerender({ all: [update('a', 'r2')], unread: [update('a', 'r2')], ready: true });
    expect(result.current).toBeGreaterThan(0);
  });

  it('changes value for a second new reply mid-pulse, then ends so a remount cannot replay it', () => {
    const { result, rerender } = mount([update('a')]);
    const second = [update('a'), update('b')];
    rerender({ all: second, unread: second, ready: true });
    const first = result.current;
    const third = [...second, update('c')];
    rerender({ all: third, unread: third, ready: true });
    expect(result.current).not.toBe(first);
    act(() => void vi.advanceTimersByTime(UNREAD_PULSE_MS));
    expect(result.current).toBe(0);
  });
});
