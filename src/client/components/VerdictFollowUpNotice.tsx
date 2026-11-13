import {
  FloatingFocusManager,
  FloatingPortal,
  autoUpdate,
  flip,
  hide,
  offset,
  shift,
  useFloating,
} from '@floating-ui/react';
import { CornerDownLeft, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import type { ReviewVerdict } from '../../types/conversation';
import type { ClientInboxDelivery } from '../hooks/useInboxDelivery';
import type { VerdictFollowUpStep } from '../hooks/useVerdictFollowUp';

import { type DeliveryState, DeliveryGlyph, deliveryColor } from './AgentDeliveryStatus';
import { describeVerdict, idleClasses, verdictButtonClasses } from './VerdictControl';

// An unpressed verdict button, with a neutral hover: the verdict buttons' green and violet
// hovers say which verdict a click gives.
const secondaryClasses = `${verdictButtonClasses} shrink-0 ${idleClasses} enabled:hover:border-github-text-secondary`;

// What became of the open review's latest verdict or comment, in the header robot's terms. A
// server without an inbox reports nothing, and ready means nothing is waiting to go.
function describeDelivery(
  delivery: ClientInboxDelivery | undefined,
): { state: DeliveryState; text: string } | undefined {
  switch (delivery?.status) {
    case 'pending':
      return { state: 'delivering', text: 'Sending to the agent…' };
    case 'sent':
      return { state: 'delivered', text: 'Sent to the agent.' };
    case 'queued':
      return { state: 'delivered', text: 'Queued for Codex.' };
    case 'uncertain':
      return { state: 'uncertain', text: "Codex didn't confirm it got this." };
    case 'failed':
      return { state: 'disconnected', text: `Not sent: ${delivery.error}.` };
    case 'unavailable':
      return { state: 'disconnected', text: 'No agent session gets messages from this review.' };
    case 'ready':
    case undefined:
      return undefined;
  }
}

/**
 * A toast after a verdict: it names the verdict, says whether it reached the agent, and then what
 * is left: the next review to open, the resume prompt to copy, or that the page can be closed.
 * Undo sits beside the next step. It floats just below the verdict buttons, where the reviewer is
 * looking, from a portal: the header group clips its overflow.
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
  // The verdict buttons.
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
  const { refs, floatingStyles, middlewareData, context } = useFloating({
    open: step !== null,
    placement: 'bottom-end',
    // Fixed, so it never adds to the page's scroll size: sliding in from past the right edge, or
    // widening before it is repositioned, would otherwise flash a horizontal scrollbar.
    strategy: 'fixed',
    elements: { reference: anchor },
    whileElementsMounted: autoUpdate,
    // hide: the header slides away while the diff scrolls on touch screens.
    middleware: [offset(6), flip(), shift({ padding: 8 }), hide()],
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
          <span role="alert" className="mt-1 block text-github-danger">
            Could not copy the prompt; try again.
          </span>
        )}
      </>
    ) : (
      "Copied. Paste it into the agent's chat, then close this page."
    );
  return (
    <FloatingPortal>
      {/* Non-modal: the page stays usable, and the notice stays in tab order right after the
          verdict buttons, though the portal mounts it at the end of the page. It focuses the
          button Return should press: the next step, or the X when there is none, never Undo. */}
      <FloatingFocusManager
        context={context}
        modal={false}
        initialFocus={typing ? -1 : hasNext ? nextRef : dismissRef}
        returnFocus={false}
        closeOnFocusOut={false}
      >
        {/* A black shadow cannot show on the dark theme's near-black page, so there a dark ring
            outside the border and a denser shadow set the toast off, as GitHub's dark overlays do. */}
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
          style={{
            ...floatingStyles,
            visibility: middlewareData.hide?.referenceHidden ? 'hidden' : 'visible',
            maxWidth: 'min(36rem, calc(100vw - 16px))',
          }}
          className="verdict-toast z-40 flex flex-col gap-4 rounded-md border border-blue-600 bg-[color-mix(in_srgb,var(--color-blue-600)_14%,var(--color-github-bg-secondary))] [[data-theme=dark]_&]:bg-[color-mix(in_srgb,var(--color-blue-600)_20%,var(--color-github-bg-secondary))] py-3 pr-4 pl-4 text-sm text-github-text-primary shadow-[0_12px_32px_rgb(31_35_40/0.3),0_2px_6px_rgb(31_35_40/0.16)] [[data-theme=dark]_&]:shadow-[0_0_0_1px_rgb(1_4_9/0.9),0_16px_40px_rgb(1_4_9/0.9)]"
        >
          {/* A toast's usual anatomy: the message, its close X in the top-right corner, and the
              actions below at the right, the primary one last. The X comes last in tab order. */}
          {/* A live region, so a delivery report that changes after the toast opens is read out. */}
          <p
            id={detailId}
            data-testid="verdict-toast-detail"
            aria-live="polite"
            className="flex items-start gap-2 pr-8 leading-7"
          >
            {report && (
              <span className={`shrink-0 ${deliveryColor(report.state)}`}>
                <DeliveryGlyph state={report.state} />
              </span>
            )}
            <span className="min-w-0 [overflow-wrap:anywhere]">
              <span className="font-medium">{describeVerdict(verdict)}.</span>{' '}
              {/* Dimmed: it is status; the next step below is what the reviewer acts on. */}
              {report && <span className="text-github-text-secondary">{report.text}</span>}
              {report && ' '}
              {next && (
                <span data-testid="verdict-toast-next" className="block">
                  {next}
                </span>
              )}
            </span>
          </p>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <button type="button" onClick={onUndo} disabled={busy} className={secondaryClasses}>
              Undo
            </button>
            {/* Blue, not green: green means approval on the verdict buttons beside it. */}
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
                className={`group ${verdictButtonClasses} min-w-0 max-w-full shrink-0 border-blue-600 bg-blue-600 text-white hover:opacity-90 aria-disabled:opacity-60`}
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
          {/* The sidebars' close button. */}
          <button
            ref={dismissRef}
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            title="Dismiss"
            className="absolute top-1.5 right-1.5 p-1 text-github-text-secondary transition-colors hover:text-github-text-primary"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  );
}
