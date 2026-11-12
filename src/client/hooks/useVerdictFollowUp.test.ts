import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReviewApproval } from '../../types/conversation';
import type { DiffSelection } from '../../types/diff';
import { createDiffSelection } from '../../utils/diffSelection';
import { copyTextToClipboard } from '../utils/clipboard';

import { useVerdictFollowUp } from './useVerdictFollowUp';

vi.mock('../utils/clipboard', () => ({ copyTextToClipboard: vi.fn() }));

const review = (name: string, approval: ReviewApproval = {}) => ({
  selection: createDiffSelection('base', '.', undefined, name),
  name,
  approval,
});
const approved: ReviewApproval = { verdict: 'approve' };

function pendingCopy() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

type Props = {
  reviews: ReturnType<typeof review>[];
  current: DiffSelection | null;
  // Omitted: the open review has a verdict, as it does right after one saves.
  currentHasVerdict?: boolean;
  requiresResume?: boolean;
};

describe('verdict follow-up', () => {
  let onSwitch: ReturnType<typeof vi.fn<(selection: DiffSelection) => void>>;
  let close: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(copyTextToClipboard).mockReset().mockResolvedValue(undefined);
    onSwitch = vi.fn<(selection: DiffSelection) => void>();
    close = vi.fn<() => void>();
    vi.spyOn(window, 'close').mockImplementation(close);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const render = (initial: Props) =>
    renderHook(
      ({ reviews, current, currentHasVerdict = true, requiresResume = false }: Props) =>
        useVerdictFollowUp({ reviews, current, currentHasVerdict, requiresResume, onSwitch }),
      { initialProps: initial },
    );

  it('does nothing until a verdict starts it', () => {
    const queue = [review('a'), review('b')];
    const { result } = render({ reviews: queue, current: queue[0]!.selection });
    expect(result.current.step).toBeNull();
  });

  it('counts down 10 seconds, then switches to the next review without a verdict', () => {
    const queue = [review('a'), review('b', approved), review('c')];
    const { result } = render({ reviews: queue, current: queue[0]!.selection });
    act(() => result.current.start());
    expect(result.current.step).toMatchObject({ kind: 'switch', name: 'c', seconds: 10 });
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current.step).toMatchObject({ kind: 'switch', name: 'c', seconds: 9 });
    act(() => void vi.advanceTimersByTime(9000));
    expect(onSwitch).toHaveBeenCalledExactlyOnceWith(queue[2]!.selection);
    expect(result.current.step).toBeNull();
  });

  // The notice restarts its time-remaining bar when this changes.
  it('keeps a deadline through the ticks of a countdown and moves it for a new one', () => {
    const queue = [review('a'), review('b')];
    const { result } = render({ reviews: queue, current: queue[0]!.selection });
    const started = Date.now();
    act(() => result.current.start());
    expect(result.current.step).toMatchObject({ deadline: started + 10_000 });
    act(() => void vi.advanceTimersByTime(2000));
    expect(result.current.step).toMatchObject({ deadline: started + 10_000 });
    act(() => result.current.start());
    expect(result.current.step).toMatchObject({ deadline: started + 12_000, seconds: 10 });
  });

  it('counts down 10 seconds when every other review has a verdict, then closes the tab', () => {
    const queue = [review('a'), review('b', approved)];
    const { result } = render({ reviews: queue, current: queue[0]!.selection });
    act(() => result.current.start());
    expect(result.current.step).toMatchObject({ kind: 'close', reviews: 2, seconds: 10 });
    act(() => void vi.advanceTimersByTime(10_000));
    expect(close).toHaveBeenCalledOnce();
    // The browser ignores close() for a tab a script did not open and that has history.
    expect(result.current.step).toEqual({ kind: 'closable', reviews: 2 });
  });

  it('switches right away on Switch now, without waiting out the countdown', () => {
    const queue = [review('a'), review('b')];
    const { result } = render({ reviews: queue, current: queue[0]!.selection });
    act(() => result.current.start());
    act(() => result.current.proceed());
    expect(onSwitch).toHaveBeenCalledExactlyOnceWith(queue[1]!.selection);
    expect(result.current.step).toBeNull();
    act(() => void vi.advanceTimersByTime(20_000));
    expect(onSwitch).toHaveBeenCalledOnce();
  });

  it('closes right away on Close now once every review has a verdict', () => {
    const queue = [review('a')];
    const { result } = render({ reviews: queue, current: queue[0]!.selection });
    act(() => result.current.start());
    act(() => result.current.proceed());
    expect(close).toHaveBeenCalledOnce();
    expect(result.current.step).toEqual({ kind: 'closable', reviews: 1 });
    act(() => void vi.advanceTimersByTime(20_000));
    expect(close).toHaveBeenCalledOnce();
  });

  it('waits for an explicit resume copy and closes only after the clipboard succeeds', async () => {
    const queue = [review('a')];
    const copied = pendingCopy();
    vi.mocked(copyTextToClipboard).mockReturnValueOnce(copied.promise);
    const { result } = render({
      reviews: queue,
      current: queue[0]!.selection,
      requiresResume: true,
    });
    act(() => result.current.start());
    expect(result.current.step).toEqual({ kind: 'resume', reviews: 1, status: 'ready' });
    act(() => void vi.advanceTimersByTime(60_000));
    expect(close).not.toHaveBeenCalled();
    expect(copyTextToClipboard).not.toHaveBeenCalled();
    act(() => result.current.proceed());
    expect(result.current.step).toMatchObject({ kind: 'resume', status: 'copying' });
    expect(close).not.toHaveBeenCalled();
    await act(async () => copied.resolve());
    expect(close).toHaveBeenCalledOnce();
    expect(result.current.step).toEqual({ kind: 'closable', reviews: 1, promptCopied: true });
    expect(copyTextToClipboard).toHaveBeenCalledWith(
      expect.stringContaining('Please read my latest gavel comments and verdicts'),
    );
  });

  it('keeps the tab open on clipboard failure and allows retry', async () => {
    vi.mocked(copyTextToClipboard).mockRejectedValueOnce(new Error('denied'));
    const queue = [review('a')];
    const { result } = render({
      reviews: queue,
      current: queue[0]!.selection,
      requiresResume: true,
    });
    act(() => result.current.start());
    await act(async () => result.current.proceed());
    expect(result.current.step).toMatchObject({ kind: 'resume', status: 'error' });
    expect(close).not.toHaveBeenCalled();
    await act(async () => result.current.proceed());
    expect(close).toHaveBeenCalledOnce();
  });

  it.each(['cancel', 'new review', 'recapture', 'navigation', 'unmount'] as const)(
    'does not close after a pending copy is superseded by %s',
    async (change) => {
      const copied = pendingCopy();
      vi.mocked(copyTextToClipboard).mockReturnValueOnce(copied.promise);
      const queue = [review('a')];
      const props = { reviews: queue, current: queue[0]!.selection, requiresResume: true };
      const { result, rerender, unmount } = render(props);
      act(() => result.current.start());
      act(() => result.current.proceed());
      if (change === 'cancel') act(() => result.current.cancel());
      else if (change === 'new review') {
        rerender({ ...props, reviews: [...queue, review('b')] });
        expect(result.current.step).toMatchObject({ kind: 'switch', name: 'b' });
      } else if (change === 'recapture') rerender({ ...props, currentHasVerdict: false });
      else if (change === 'navigation') rerender({ ...props, current: review('b').selection });
      else unmount();
      await act(async () => copied.resolve());
      expect(close).not.toHaveBeenCalled();
    },
  );

  it('hands off to Codex when the next review receives a verdict elsewhere', () => {
    const queue = [review('a'), review('b')];
    const props = { reviews: queue, current: queue[0]!.selection, requiresResume: true };
    const { result, rerender } = render(props);
    act(() => result.current.start());
    expect(result.current.step).toMatchObject({ kind: 'switch', name: 'b' });
    rerender({ ...props, reviews: [queue[0]!, review('b', approved)] });
    expect(result.current.step).toMatchObject({ kind: 'resume', status: 'ready' });
    act(() => void vi.advanceTimersByTime(20_000));
    expect(close).not.toHaveBeenCalled();
  });

  it('cancels the countdown', () => {
    const queue = [review('a'), review('b')];
    const { result } = render({ reviews: queue, current: queue[0]!.selection });
    act(() => result.current.start());
    act(() => result.current.cancel());
    act(() => void vi.advanceTimersByTime(20_000));
    expect(result.current.step).toBeNull();
    expect(onSwitch).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it('switches to a review that arrives while the tab is about to close', () => {
    const queue = [review('a')];
    const { result, rerender } = render({ reviews: queue, current: queue[0]!.selection });
    act(() => result.current.start());
    expect(result.current.step?.kind).toBe('close');
    const grown = [...queue, review('b')];
    rerender({ reviews: grown, current: queue[0]!.selection });
    expect(result.current.step).toMatchObject({ kind: 'switch', name: 'b', seconds: 10 });
    expect(result.current.pulse).toBeGreaterThan(0);
    act(() => void vi.advanceTimersByTime(10_000));
    expect(onSwitch).toHaveBeenCalledExactlyOnceWith(grown[1]!.selection);
    expect(close).not.toHaveBeenCalled();
  });

  it('switches to a review that arrives after the tab failed to close', () => {
    const queue = [review('a')];
    const { result, rerender } = render({ reviews: queue, current: queue[0]!.selection });
    act(() => result.current.start());
    act(() => void vi.advanceTimersByTime(10_000));
    expect(result.current.step?.kind).toBe('closable');
    rerender({ reviews: [...queue, review('b')], current: queue[0]!.selection });
    expect(result.current.step).toMatchObject({ kind: 'switch', name: 'b', seconds: 10 });
    expect(result.current.pulse).toBeGreaterThan(0);
  });

  // The hook runs in App, so each tick re-renders the whole page; the label changes once a second.
  it('re-renders once a second while counting down', () => {
    const queue = [review('a'), review('b')];
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useVerdictFollowUp({
        reviews: queue,
        current: queue[0]!.selection,
        currentHasVerdict: true,
        onSwitch,
      });
    });
    act(() => result.current.start());
    const before = renders;
    // One act per 250ms, so React cannot batch several ticks into one render.
    for (let step = 0; step < 8; step++) act(() => void vi.advanceTimersByTime(250));
    expect(result.current.step).toMatchObject({ kind: 'switch', name: 'b', seconds: 8 });
    expect(renders - before).toBeLessThanOrEqual(2);
  });

  it('falls back to closing when the review it was about to open gets a verdict elsewhere', () => {
    const queue = [review('a'), review('b')];
    const { result, rerender } = render({ reviews: queue, current: queue[0]!.selection });
    act(() => result.current.start());
    rerender({ reviews: [queue[0]!, review('b', approved)], current: queue[0]!.selection });
    expect(result.current.step).toMatchObject({ kind: 'close', reviews: 2, seconds: 10 });
  });

  it('stops when the open review loses its verdict, so the tab never closes over it', () => {
    const queue = [review('a')];
    const { result, rerender } = render({ reviews: queue, current: queue[0]!.selection });
    act(() => result.current.start());
    expect(result.current.step?.kind).toBe('close');
    // The reviewer cleared the verdict from another tab.
    rerender({ reviews: queue, current: queue[0]!.selection, currentHasVerdict: false });
    expect(result.current.step).toBeNull();
    act(() => void vi.advanceTimersByTime(20_000));
    expect(close).not.toHaveBeenCalled();
  });

  it('stops when the reviewer opens another review', () => {
    const queue = [review('a'), review('b'), review('c')];
    const { result, rerender } = render({ reviews: queue, current: queue[0]!.selection });
    act(() => result.current.start());
    rerender({ reviews: queue, current: queue[2]!.selection });
    expect(result.current.step).toBeNull();
    act(() => void vi.advanceTimersByTime(20_000));
    expect(onSwitch).not.toHaveBeenCalled();
  });

  // A remounted tab bar (every review switch remounts it behind the loading screen) would
  // otherwise replay a pulse that is still above 0.
  it('stops pulsing once the animation ends, or once another review opens', () => {
    const queue = [review('a'), review('b'), review('c')];
    const { result, rerender } = render({ reviews: queue, current: queue[0]!.selection });
    act(() => result.current.pulseNow());
    expect(result.current.pulse).toBeGreaterThan(0);
    // 4 beats of 1.6s each (global.css), slowed from 0.8s at the maintainer's request.
    act(() => void vi.advanceTimersByTime(3200));
    expect(result.current.pulse).toBeGreaterThan(0);
    act(() => void vi.advanceTimersByTime(3200));
    expect(result.current.pulse).toBe(0);

    act(() => result.current.start());
    expect(result.current.pulse).toBeGreaterThan(0);
    rerender({ reviews: queue, current: queue[1]!.selection });
    expect(result.current.pulse).toBe(0);
  });

  it('pulses the reviews without a verdict when a countdown to another review starts', () => {
    const queue = [review('a'), review('b')];
    const { result } = render({ reviews: queue, current: queue[0]!.selection });
    const before = result.current.pulse;
    act(() => result.current.start());
    expect(result.current.pulse).toBe(before + 1);
    act(() => result.current.pulseNow());
    expect(result.current.pulse).toBe(before + 2);
  });
});
