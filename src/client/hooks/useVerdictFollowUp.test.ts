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

  // The reviewer may be reading the conversation, so only their click moves on.
  it('offers the next review without a verdict and never switches to it by itself', () => {
    const queue = [review('a'), review('b', approved), review('c')];
    const { result } = render({ reviews: queue, current: queue[0]!.selection });
    act(() => result.current.start());
    expect(result.current.step).toEqual({ kind: 'switch', name: 'c', waiting: 1 });
    act(() => void vi.advanceTimersByTime(60_000));
    expect(onSwitch).not.toHaveBeenCalled();
    expect(result.current.step).toEqual({ kind: 'switch', name: 'c', waiting: 1 });
    act(() => result.current.proceed());
    expect(onSwitch).toHaveBeenCalledExactlyOnceWith(queue[2]!.selection);
    expect(result.current.step).toBeNull();
  });

  // The open review's entry may not show its verdict yet, right after the verdict saves.
  it('counts the reviews that still need a verdict, leaving out the open one', () => {
    const queue = [review('a'), review('b', approved), review('c'), review('d')];
    const { result } = render({ reviews: queue, current: queue[0]!.selection });
    act(() => result.current.start());
    expect(result.current.step).toEqual({ kind: 'switch', name: 'c', waiting: 2 });
  });

  it('offers to close the tab once every review has a verdict, and never closes it by itself', () => {
    const queue = [review('a'), review('b', approved)];
    const { result } = render({ reviews: queue, current: queue[0]!.selection });
    act(() => result.current.start());
    expect(result.current.step).toEqual({ kind: 'close', reviews: 2 });
    act(() => void vi.advanceTimersByTime(60_000));
    expect(close).not.toHaveBeenCalled();
    act(() => result.current.proceed());
    expect(close).toHaveBeenCalledOnce();
    // The browser ignores close() for a tab a script did not open and that has history.
    expect(result.current.step).toEqual({ kind: 'closable', reviews: 2 });
  });

  // The send settles 2 seconds after the verdict, so a failure can arrive while the offer shows.
  it('turns the offer to close into the Codex handoff when the verdict did not reach the agent', () => {
    const queue = [review('a')];
    const props = { reviews: queue, current: queue[0]!.selection };
    const { result, rerender } = render(props);
    act(() => result.current.start());
    expect(result.current.step).toEqual({ kind: 'close', reviews: 1 });
    rerender({ ...props, requiresResume: true });
    expect(result.current.step).toEqual({ kind: 'resume', reviews: 1, status: 'ready' });
    expect(close).not.toHaveBeenCalled();
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

  it('dismisses the next step', () => {
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
    expect(result.current.step).toEqual({ kind: 'switch', name: 'b', waiting: 1 });
    expect(result.current.pulse).toBeGreaterThan(0);
    act(() => result.current.proceed());
    expect(onSwitch).toHaveBeenCalledExactlyOnceWith(grown[1]!.selection);
    expect(close).not.toHaveBeenCalled();
  });

  it('switches to a review that arrives after the tab failed to close', () => {
    const queue = [review('a')];
    const { result, rerender } = render({ reviews: queue, current: queue[0]!.selection });
    act(() => result.current.start());
    act(() => result.current.proceed());
    expect(result.current.step?.kind).toBe('closable');
    rerender({ reviews: [...queue, review('b')], current: queue[0]!.selection });
    expect(result.current.step).toEqual({ kind: 'switch', name: 'b', waiting: 1 });
    expect(result.current.pulse).toBeGreaterThan(0);
  });

  it('falls back to closing when the review it was about to open gets a verdict elsewhere', () => {
    const queue = [review('a'), review('b')];
    const { result, rerender } = render({ reviews: queue, current: queue[0]!.selection });
    act(() => result.current.start());
    rerender({ reviews: [queue[0]!, review('b', approved)], current: queue[0]!.selection });
    expect(result.current.step).toEqual({ kind: 'close', reviews: 2 });
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

  // The toast names the open review's verdict, so it must not paint once that verdict is gone.
  it('shows no step in the render where the open review loses its verdict', () => {
    const queue = [review('a'), review('b')];
    const steps: unknown[] = [];
    const { result, rerender } = renderHook(
      ({ currentHasVerdict }: { currentHasVerdict: boolean }) => {
        const followUp = useVerdictFollowUp({
          reviews: queue,
          current: queue[0]!.selection,
          currentHasVerdict,
          onSwitch,
        });
        steps.push(followUp.step);
        return followUp;
      },
      { initialProps: { currentHasVerdict: true } },
    );
    act(() => result.current.start());
    const before = steps.length;
    rerender({ currentHasVerdict: false });
    expect(steps.slice(before)).toEqual(steps.slice(before).map(() => null));
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

  it('pulses the reviews without a verdict when it offers another review', () => {
    const queue = [review('a'), review('b')];
    const { result } = render({ reviews: queue, current: queue[0]!.selection });
    const before = result.current.pulse;
    act(() => result.current.start());
    expect(result.current.pulse).toBe(before + 1);
    act(() => result.current.pulseNow());
    expect(result.current.pulse).toBe(before + 2);
  });
});
