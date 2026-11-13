import { useCallback, useEffect, useRef, useState } from 'react';

import type { ReviewApproval } from '../../types/conversation';
import type { DiffSelection } from '../../types/diff';
import { diffSelectionsEqual, getDiffSelectionKey } from '../../utils/diffSelection';
import { copyTextToClipboard } from '../utils/clipboard';
import { buildResumePrompt } from '../utils/resumePrompt';
import { hasVerdict, nextReviewNeedingVerdict } from '../utils/verdict';

// The length of the verdict-pulse animation in global.css: 4 iterations of 1.6s.
const PULSE_MS = 6400;

type CopyStatus = 'ready' | 'copying' | 'error';
// review: the key of the review that was open when the phase began.
type Phase =
  | ((
      | { kind: 'switch' | 'close' }
      | { kind: 'resume'; status: CopyStatus }
      | { kind: 'copied' }
    ) & {
      review: string | null;
    })
  | null;

export type VerdictFollowUpStep =
  // waiting: the reviews without a verdict, the named one among them.
  | { kind: 'switch'; name: string; waiting: number }
  // Every review has a verdict, so the reviewer can close the page.
  | { kind: 'close'; reviews: number }
  | { kind: 'resume'; reviews: number; status: CopyStatus }
  // The resume prompt is on the clipboard.
  | { kind: 'copied' };

/**
 * After a verdict, offers the next review without one, or says the page can be closed when every
 * review has one; only the reviewer's click takes a step, since they may still be reading. A
 * verdict that did not reach the agent (requiresResume) offers the resume prompt instead. A review
 * that arrives in the meantime takes over the follow-up. Nothing closes the page: browsers honour
 * window.close() only in a tab a script opened or one whose history holds a single entry, and
 * comment links, the revision picker, and pages the tab showed before gavel all add entries.
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
  // A phase belongs to the review it began on, while that review has a verdict. Opening another
  // review or clearing the verdict ends it in the same render, before any effect sees it; a later
  // effect cannot say the page can be closed over a review that still needs a verdict.
  const phase = storedPhase?.review === currentKey && currentHasVerdict ? storedPhase : null;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  // Bumped to replay the pulse on the tabs of reviews without a verdict; reported as 0 once the
  // animation has ended, so a tab bar that remounts later does not replay it.
  const [pulse, setPulse] = useState(0);
  const [pulsing, setPulsing] = useState(false);
  const target = nextReviewNeedingVerdict(reviews, current);
  const targetRef = useRef(target);
  targetRef.current = target;

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

  // Every offer of another review pulses the tabs, whether a verdict or an arriving review
  // started it.
  const offer = useCallback(
    (next: T | undefined) => {
      if (next) pulseNow();
      const review = currentKeyRef.current;
      if (!next && requiresResume) setPhase({ kind: 'resume', status: 'ready', review });
      else setPhase({ kind: next ? 'switch' : 'close', review });
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

  // A review that arrives takes over an offer to close; one that gets a verdict elsewhere gives
  // way to closing, or to the Codex handoff. So does a verdict that did not reach the agent. An
  // untouched handoff that is no longer needed gives way to closing: start() can run from a render
  // whose delivery report predates the verdict.
  const hasTarget = target !== undefined;
  useEffect(() => {
    if (!phase) return;
    const stale = hasTarget ? phase.kind !== 'switch' : phase.kind === 'switch';
    const handoff = phase.kind === 'resume' && phase.status === 'ready';
    if (stale || (phase.kind === 'close' && requiresResume) || (handoff && !requiresResume))
      offer(targetRef.current);
  }, [phase, hasTarget, requiresResume, offer]);

  const copyPrompt = async () => {
    if (phase?.kind !== 'resume' || phase.status === 'copying') return;
    const copying: Phase = { ...phase, status: 'copying' };
    phaseRef.current = copying;
    setPhase(copying);
    try {
      await copyTextToClipboard(buildResumePrompt());
      // A new review, recapture, navigation, Undo, or Dismiss supersedes this handoff.
      if (phaseRef.current !== copying) return;
      setPhase({ kind: 'copied', review: currentKeyRef.current });
    } catch {
      if (phaseRef.current === copying) setPhase({ ...copying, status: 'error' });
    }
  };

  const count = Math.max(reviews.length, 1);
  const step: VerdictFollowUpStep | null = !phase
    ? null
    : phase.kind === 'copied'
      ? { kind: 'copied' }
      : phase.kind === 'resume'
        ? { kind: 'resume', reviews: count, status: phase.status }
        : phase.kind === 'switch' && target
          ? {
              kind: 'switch',
              name: target.name,
              // The open review's entry may not show its verdict yet.
              waiting: reviews.filter(
                (entry) =>
                  !hasVerdict(entry.approval) && !diffSelectionsEqual(entry.selection, current),
              ).length,
            }
          : { kind: 'close', reviews: count };

  return {
    step,
    pulse: pulsing ? pulse : 0,
    start: () => offer(target),
    cancel,
    // Takes the next step: opens the next review, or copies the resume prompt in the handoff.
    proceed: () => {
      if (phase?.kind === 'resume') void copyPrompt();
      else if (phase?.kind === 'switch' && target) {
        setPhase(null);
        onSwitch(target.selection);
      }
    },
    pulseNow,
  };
}
