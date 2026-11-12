import { useCallback, useEffect, useRef, useState } from 'react';

import type { ReviewApproval } from '../../types/conversation';
import type { DiffSelection } from '../../types/diff';
import { getDiffSelectionKey } from '../../utils/diffSelection';
import { copyTextToClipboard } from '../utils/clipboard';
import { buildResumePrompt } from '../utils/resumePrompt';
import { nextReviewNeedingVerdict } from '../utils/verdict';

// Long enough to read the notice and reach Cancel, before switching reviews or closing the tab.
export const COUNTDOWN_SECONDS = 10;
// The length of the verdict-pulse animation in global.css: 4 iterations of 1.6s.
const PULSE_MS = 6400;

type CopyStatus = 'ready' | 'copying' | 'error';
// review: the key of the review that was open when the phase began.
type Phase =
  | ((
      | { kind: 'switch' | 'close'; deadline: number }
      | { kind: 'resume'; status: CopyStatus }
      | { kind: 'closable'; promptCopied?: boolean }
    ) & {
      review: string | null;
    })
  | null;

export type VerdictFollowUpStep =
  // deadline: when the countdown ends; a new countdown has a new one.
  | { kind: 'switch'; name: string; seconds: number; deadline: number }
  | { kind: 'close'; reviews: number; seconds: number; deadline: number }
  // The browser ignored close(): it closes only tabs a script opened or with one history entry.
  | { kind: 'closable'; reviews: number; promptCopied?: boolean }
  | { kind: 'resume'; reviews: number; status: CopyStatus };

/**
 * After a verdict, counts down to the next review without one, or to closing the tab when
 * every review has one. Codex waits for an explicit copy-and-close handoff instead.
 * A review that arrives in the meantime takes over the follow-up.
 */
export function useVerdictFollowUp<
  T extends { selection: DiffSelection; name: string; approval: ReviewApproval },
>({
  reviews,
  current,
  currentHasVerdict,
  requiresResume = false,
  onSwitch,
}: {
  // In the order the server created them.
  reviews: T[];
  current: DiffSelection | null;
  // From the open review's own approval state, which is fresher than its entry in reviews.
  currentHasVerdict: boolean;
  requiresResume?: boolean;
  onSwitch: (selection: DiffSelection) => void;
}) {
  const [storedPhase, setPhase] = useState<Phase>(null);
  const currentKey = current ? getDiffSelectionKey(current) : null;
  const currentKeyRef = useRef(currentKey);
  currentKeyRef.current = currentKey;
  // A phase belongs to the review it began on. Opening another review ends it in the same
  // render, before any effect sees it; a later effect cannot turn it into a close countdown
  // over a review that still needs a verdict.
  const phase = storedPhase?.review === currentKey ? storedPhase : null;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const requiresResumeRef = useRef(requiresResume);
  requiresResumeRef.current = requiresResume;
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
  const cancel = useCallback(() => {
    phaseRef.current = null;
    setPhase(null);
  }, []);
  // A clipboard request may finish after this page has unmounted.
  useEffect(
    () => () => {
      phaseRef.current = null;
    },
    [],
  );
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
      if (!next && requiresResume) {
        setPhase({ kind: 'resume', status: 'ready', review: currentKeyRef.current });
        return;
      }
      setPhase({
        kind: next ? 'switch' : 'close',
        deadline: time + COUNTDOWN_SECONDS * 1000,
        review: currentKeyRef.current,
      });
    },
    [pulseNow, requiresResume],
  );

  // Opening another review ends the follow-up, including the switch it made itself.
  const shownKey = useRef(currentKey);
  useEffect(() => {
    if (shownKey.current === currentKey) return;
    shownKey.current = currentKey;
    setPhase(null);
    setPulsing(false);
  }, [currentKey]);

  // A verdict cleared from another tab leaves the open review needing one again, so neither move
  // on from it nor close over it.
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
    } else if (requiresResumeRef.current) {
      setPhase({ kind: 'resume', status: 'ready', review: currentKeyRef.current });
    } else {
      window.close();
      setPhase({ kind: 'closable', review: currentKeyRef.current });
    }
  }, []);

  useEffect(() => {
    if (!phase || (phase.kind !== 'switch' && phase.kind !== 'close')) return;
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

  const copyAndClose = async () => {
    if (phase?.kind !== 'resume' || phase.status === 'copying') return;
    const copying: Phase = { ...phase, status: 'copying' };
    phaseRef.current = copying;
    setPhase(copying);
    try {
      await copyTextToClipboard(buildResumePrompt());
      // A new review, recapture, navigation, or Cancel supersedes this handoff.
      if (phaseRef.current !== copying) return;
      window.close();
      setPhase({ kind: 'closable', promptCopied: true, review: currentKeyRef.current });
    } catch {
      if (phaseRef.current === copying) setPhase({ ...copying, status: 'error' });
    }
  };

  const count = Math.max(reviews.length, 1);
  const remaining = (deadline: number) => ({
    deadline,
    seconds: Math.max(0, Math.ceil((deadline - now) / 1000)),
  });
  const step: VerdictFollowUpStep | null = !phase
    ? null
    : phase.kind === 'closable'
      ? { kind: 'closable', reviews: count, ...(phase.promptCopied ? { promptCopied: true } : {}) }
      : phase.kind === 'resume'
        ? { kind: 'resume', reviews: count, status: phase.status }
        : phase.kind === 'switch' && target
          ? { kind: 'switch', name: target.name, ...remaining(phase.deadline) }
          : { kind: 'close', reviews: count, ...remaining(phase.deadline) };

  return {
    step,
    pulse: pulsing ? pulse : 0,
    start: () => countdown(target),
    cancel,
    // Takes the next step now, copying the resume prompt before closing for Codex.
    proceed: () => {
      if (phase?.kind === 'resume') void copyAndClose();
      else if (phase && phase.kind !== 'closable') runNextStep(phase.kind);
    },
    pulseNow,
  };
}
