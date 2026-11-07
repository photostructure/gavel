import { useCallback, useEffect, useRef, useState } from 'react';

import type { ReviewApproval } from '../../types/conversation';
import type { DiffSelection } from '../../types/diff';
import { getDiffSelectionKey } from '../../utils/diffSelection';
import { nextReviewNeedingVerdict } from '../utils/verdict';

// Long enough to read the notice and reach Cancel, before switching reviews or closing the tab.
const COUNTDOWN_SECONDS = 10;
// The length of the verdict-pulse animation in global.css: 4 iterations of 1.6s.
const PULSE_MS = 6400;

type Phase = { kind: 'switch' | 'close'; deadline: number } | { kind: 'closable' } | null;

export type VerdictFollowUpStep =
  | { kind: 'switch'; name: string; seconds: number }
  | { kind: 'close'; reviews: number; seconds: number }
  // The browser ignored close(): it closes only tabs a script opened or with one history entry.
  | { kind: 'closable'; reviews: number };

/**
 * After a verdict, counts down to the next review without one, or to closing the tab when
 * every review has one. A review that arrives in the meantime takes over the countdown.
 */
export function useVerdictFollowUp<
  T extends { selection: DiffSelection; name: string; approval: ReviewApproval },
>({
  reviews,
  current,
  currentHasVerdict,
  onSwitch,
}: {
  // In the order the server created them.
  reviews: T[];
  current: DiffSelection | null;
  // From the open review's own approval state, which is fresher than its entry in reviews.
  currentHasVerdict: boolean;
  onSwitch: (selection: DiffSelection) => void;
}) {
  const [phase, setPhase] = useState<Phase>(null);
  const [now, setNow] = useState(() => Date.now());
  // Bumped to replay the pulse on the tabs of reviews without a verdict; reported as 0 once the
  // animation has ended, so a tab bar that remounts later does not replay it.
  const [pulse, setPulse] = useState(0);
  const [pulsing, setPulsing] = useState(false);
  const target = nextReviewNeedingVerdict(reviews, current);
  const targetRef = useRef(target);
  targetRef.current = target;
  const onSwitchRef = useRef(onSwitch);
  onSwitchRef.current = onSwitch;

  // Stable, so a listener that calls them is not re-registered on every render.
  const cancel = useCallback(() => setPhase(null), []);
  const pulseNow = useCallback(() => {
    setPulse((value) => value + 1);
    setPulsing(true);
  }, []);

  // Every switch countdown pulses the tabs, whether a verdict or an arriving review started it.
  const countdown = useCallback(
    (next: T | undefined) => {
      const time = Date.now();
      setNow(time);
      if (next) pulseNow();
      setPhase(
        next
          ? { kind: 'switch', deadline: time + COUNTDOWN_SECONDS * 1000 }
          : { kind: 'close', deadline: time + COUNTDOWN_SECONDS * 1000 },
      );
    },
    [pulseNow],
  );

  // Opening another review ends the follow-up, including the switch it made itself.
  const currentKey = current ? getDiffSelectionKey(current) : null;
  const shownKey = useRef(currentKey);
  useEffect(() => {
    if (shownKey.current === currentKey) return;
    shownKey.current = currentKey;
    setPhase(null);
    setPulsing(false);
  }, [currentKey]);

  // A recapture or summary change clears the open review's verdict; it needs one again, so
  // neither move on from it nor close over it.
  useEffect(() => {
    if (!currentHasVerdict) setPhase(null);
  }, [currentHasVerdict]);

  useEffect(() => {
    if (!pulsing) return;
    const end = setTimeout(() => setPulsing(false), PULSE_MS);
    return () => clearTimeout(end);
  }, [pulsing, pulse]);

  // A review that arrives takes over a close countdown; one that gets a verdict elsewhere
  // gives way to closing.
  const hasTarget = target !== undefined;
  useEffect(() => {
    if (!phase || (hasTarget ? phase.kind === 'switch' : phase.kind !== 'switch')) return;
    countdown(targetRef.current);
  }, [phase, hasTarget, countdown]);

  // What a countdown does when it ends, or at once when the reviewer asks for it now.
  const runNextStep = useCallback((kind: 'switch' | 'close') => {
    const next = targetRef.current;
    if (kind === 'switch' && next) {
      setPhase(null);
      onSwitchRef.current(next.selection);
    } else {
      window.close();
      setPhase({ kind: 'closable' });
    }
  }, []);

  useEffect(() => {
    if (!phase || phase.kind === 'closable') return;
    const { kind } = phase;
    const expire = setTimeout(() => runNextStep(kind), phase.deadline - Date.now());
    // App runs this hook, so each tick re-renders the page: tick only when the shown whole
    // second changes.
    const { deadline } = phase;
    let tick: ReturnType<typeof setTimeout>;
    const scheduleTick = () => {
      tick = setTimeout(
        () => {
          setNow(Date.now());
          scheduleTick();
        },
        (deadline - Date.now()) % 1000 || 1000,
      );
    };
    scheduleTick();
    return () => {
      clearTimeout(expire);
      clearTimeout(tick);
    };
  }, [phase, runNextStep]);

  const count = Math.max(reviews.length, 1);
  const step: VerdictFollowUpStep | null = !phase
    ? null
    : phase.kind === 'closable'
      ? { kind: 'closable', reviews: count }
      : phase.kind === 'switch' && target
        ? {
            kind: 'switch',
            name: target.name,
            seconds: Math.max(0, Math.ceil((phase.deadline - now) / 1000)),
          }
        : {
            kind: 'close',
            reviews: count,
            seconds: Math.max(0, Math.ceil((phase.deadline - now) / 1000)),
          };

  return {
    step,
    pulse: pulsing ? pulse : 0,
    start: () => countdown(target),
    cancel,
    // Skips the rest of a countdown and takes its next step now.
    proceed: () => {
      if (phase && phase.kind !== 'closable') runNextStep(phase.kind);
    },
    pulseNow,
  };
}
