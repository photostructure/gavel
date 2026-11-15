import { FloatingFocusManager, useFloating } from '@floating-ui/react';
import { Check, CornerDownLeft, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import type { ReviewVerdict } from '../../types/conversation';
import type { ClientInboxDelivery } from '../hooks/useInboxDelivery';
import type { VerdictFollowUpStep } from '../hooks/useVerdictFollowUp';

import {
  type ToastKind,
  toastActionsClasses,
  toastButtonClasses,
  toastClasses,
  toastDetailClasses,
  toastDismissClasses,
  toastGlyphCellClasses,
  toastGlyphClasses,
  toastTitleClasses,
} from './toastStyles';
import { describeVerdict } from './VerdictControl';

// What became of the open review's latest verdict or comment, as the header robot reports it. A
// server without an inbox reports nothing, and ready means nothing is waiting to go.
function describeDelivery(
  delivery: ClientInboxDelivery | undefined,
): { failed: boolean; text: string } | undefined {
  switch (delivery?.status) {
    case 'pending':
      return { failed: false, text: 'Sending to the agent…' };
    case 'sent':
      return { failed: false, text: 'Sent to the agent.' };
    case 'queued':
      return { failed: false, text: 'Queued for Codex.' };
    case 'uncertain':
      return { failed: true, text: "Codex didn't confirm it got this." };
    case 'failed':
      return { failed: true, text: `Not sent: ${delivery.error}.` };
    case 'unavailable':
      return { failed: false, text: 'No agent session gets messages from this review.' };
    case 'ready':
    case undefined:
      return undefined;
  }
}

/**
 * A toast after a verdict: it names the verdict, says whether it reached the agent, and then what
 * is left: the next review to open, the resume prompt to copy, or that the page can be closed.
 * Undo sits beside the next step. It opens in the header's toast stack, just below the verdict
 * buttons, where the reviewer is looking.
 */
export function VerdictFollowUpNotice({
  anchor,
  step,
  verdict,
  delivery,
  busy,
  onDismiss,
  onProceed,
  onUndo,
}: {
  // The verdict buttons, which keep the toast in tab order right after them.
  anchor: Element | null;
  step: VerdictFollowUpStep | null;
  // The open review's verdict.
  verdict: ReviewVerdict | undefined;
  // The open review's delivery to the agent session that owns it.
  delivery: ClientInboxDelivery | undefined;
  // The verdict buttons are saving or a capture is reloading, which ignores Undo.
  busy: boolean;
  onDismiss: () => void;
  // Takes the next step.
  onProceed: () => void;
  // Clears the verdict, as clicking its pressed button does.
  onUndo: () => void;
}) {
  // Only for FloatingFocusManager; the toast stack positions the toast.
  const { refs, context } = useFloating({
    open: step !== null,
    elements: { reference: anchor },
  });
  const detailId = useId();
  const nextRef = useRef<HTMLButtonElement>(null);
  const dismissRef = useRef<HTMLButtonElement>(null);
  const hasNext = step?.kind === 'switch' || step?.kind === 'resume';
  // A next step that goes away while focused (another tab gave the last verdict, or the prompt
  // was copied) drops focus to the page; the X takes it, so Escape and Tab still work.
  useEffect(() => {
    if (!hasNext && document.activeElement === document.body) dismissRef.current?.focus();
  }, [hasNext]);
  // A retried send can open the toast long after the click; a reviewer typing a comment by then
  // keeps their focus, or their keystrokes would land on the toast. Decided once as it opens:
  // Floating UI re-runs its initial focus whenever this changes.
  const [typing, setTyping] = useState(false);
  const [shown, setShown] = useState(false);
  if (shown !== (step !== null)) {
    setShown(step !== null);
    const active = document.activeElement;
    setTyping(
      active instanceof HTMLElement &&
        (active.isContentEditable || active.matches('input, textarea, select')),
    );
  }
  if (!step) return null;
  const allDone =
    step.kind === 'resume' &&
    (step.reviews === 1
      ? 'This review has a verdict.'
      : `All ${step.reviews} reviews have a verdict.`);
  const report = describeDelivery(delivery);
  // An undone verdict, say from another tab, leaves a gray toast with no glyph.
  const kind: ToastKind = verdict ?? 'info';
  const Glyph = verdict === 'approve' ? Check : verdict === 'reject' ? X : undefined;
  // A failed send, which needs the resume prompt, may still arrive; what is left waits for it.
  const sending = delivery?.status === 'pending';
  const others = step.kind === 'switch' ? step.waiting - 1 : 0;
  // On its own line under the verdict and its delivery, so a delivery report that changes does
  // not reflow it.
  const next =
    step.kind === 'switch' ? (
      !sending && (
        <>
          <code>{step.name}</code>
          {others === 0
            ? ' still needs a verdict.'
            : ` and ${others} other ${others === 1 ? 'review' : 'reviews'} still need a verdict.`}
        </>
      )
    ) : step.kind === 'close' ? (
      !sending &&
      (step.reviews === 1
        ? 'You can close this page.'
        : `All ${step.reviews} reviews have a verdict, so you can close this page.`)
    ) : step.kind === 'resume' ? (
      <>
        {allDone} If the agent hasn't resumed, copy the prompt and paste it into the chat that
        opened this review.
        {step.status === 'error' && (
          <span role="alert" className="mt-1 block text-github-danger-text">
            Could not copy the prompt; try again.
          </span>
        )}
      </>
    ) : (
      "Copied. Paste it into the agent's chat, then close this page."
    );
  return (
    <>
      {/* Non-modal: the page stays usable, and the notice stays in tab order right after the
          verdict buttons, though the stack's portal mounts it at the end of the page. It focuses
          the button Return should press: the next step, or the X when there is none, never Undo. */}
      <FloatingFocusManager
        context={context}
        modal={false}
        initialFocus={typing ? -1 : hasNext ? nextRef : dismissRef}
        returnFocus={false}
        closeOnFocusOut={false}
      >
        <div
          ref={refs.setFloating}
          role="dialog"
          aria-label="Next step"
          aria-describedby={detailId}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            onDismiss();
          }}
          className={toastClasses(kind)}
        >
          {/* The cell stays without a glyph, so the message keeps its column. */}
          <span className={`col-start-1 row-start-1 ${toastGlyphCellClasses}`}>
            {Glyph && <Glyph size={16} aria-hidden="true" className={toastGlyphClasses[kind]} />}
          </span>
          {/* A live region, so a delivery report that changes after the toast opens is read out.
              The spaces between its lines keep the words apart in its text, which also describes
              the dialog. */}
          <div
            id={detailId}
            data-testid="verdict-toast-detail"
            aria-live="polite"
            className="col-start-2 row-start-1 min-w-0"
          >
            {verdict && <div className={toastTitleClasses}>{describeVerdict(verdict)}</div>}{' '}
            {/* Dimmed: it is status, and the header's robot just above shows the same state; the
                next step below is what the reviewer acts on. A verdict that did not reach the agent
                turns red, as the robot does, in a shade that stays readable on the toast's tint. */}
            {report && (
              <div
                data-testid="verdict-toast-delivery"
                className={
                  report.failed
                    ? 'text-github-danger-text [overflow-wrap:anywhere]'
                    : toastDetailClasses
                }
              >
                {report.text}
              </div>
            )}
            {report && ' '}
            {/* 8px under a delivery report; without one, the title's margin spaces it. */}
            {next && (
              <div
                data-testid="verdict-toast-next"
                className={`${report ? 'mt-2' : ''} text-github-text-primary [overflow-wrap:anywhere]`}
              >
                {next}
              </div>
            )}
          </div>
          <div className={toastActionsClasses}>
            <button type="button" onClick={onUndo} disabled={busy} className={toastButtonClasses}>
              Undo
            </button>
            {/* Blue, not green: green means approval on the verdict buttons. */}
            {hasNext && (
              <button
                ref={nextRef}
                type="button"
                onClick={onProceed}
                // Not disabled: a disabled button drops focus to the page, so Return could not
                // retry a failed copy. The hook ignores a click while a copy is under way.
                aria-disabled={(step.kind === 'resume' && step.status === 'copying') || undefined}
                title={
                  step.kind === 'switch'
                    ? `Switch to ${step.name} (Return)`
                    : 'Copy resume prompt (Return)'
                }
                className="group inline-flex h-7 min-w-0 max-w-full items-center gap-1.5 whitespace-nowrap rounded-md border border-blue-600 bg-blue-600 px-3 text-sm font-medium text-white hover:opacity-90 aria-disabled:opacity-60"
              >
                {step.kind === 'switch' ? (
                  <>
                    Switch to <code className="min-w-0 truncate font-semibold">{step.name}</code>
                  </>
                ) : step.status === 'copying' ? (
                  'Copying…'
                ) : (
                  'Copy resume prompt'
                )}
                {/* The focus ring may not show after a mouse click, so this says Return will
                    press the button. Touch-only screens have no Return key. */}
                <CornerDownLeft
                  data-testid="return-glyph"
                  size={14}
                  aria-hidden="true"
                  className="hidden shrink-0 opacity-70 pointer-fine:group-focus:inline"
                />
              </button>
            )}
          </div>
          {/* Last in the DOM, so it comes after the actions in tab order; the grid shows it
              beside the message. */}
          <button
            ref={dismissRef}
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            title="Dismiss"
            className={`col-start-3 row-start-1 ${toastDismissClasses}`}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </FloatingFocusManager>
    </>
  );
}
