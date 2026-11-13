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
import { X } from 'lucide-react';

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
  return (
    <FloatingPortal>
      {/* Non-modal and never moving focus: it keeps the notice in tab order right after the
          verdict buttons, though the portal mounts it at the end of the page. */}
      <FloatingFocusManager
        context={context}
        modal={false}
        initialFocus={-1}
        returnFocus={false}
        closeOnFocusOut={false}
      >
        <div
          ref={refs.setFloating}
          role="status"
          aria-label="Next step"
          style={{
            ...floatingStyles,
            visibility: middlewareData.hide?.referenceHidden ? 'hidden' : 'visible',
            maxWidth: 'min(36rem, calc(100vw - 16px))',
          }}
          className="verdict-toast z-40 flex flex-col gap-4 rounded-md border border-blue-600 bg-[color-mix(in_srgb,var(--color-blue-600)_14%,var(--color-github-bg-secondary))] [[data-theme=dark]_&]:bg-[color-mix(in_srgb,var(--color-blue-600)_20%,var(--color-github-bg-secondary))] py-3 pr-4 pl-4 text-sm text-github-text-primary shadow-2xl"
        >
          {/* A toast's usual anatomy: the message, its close X in the top-right corner, and the
              actions below at the right, the primary one last. The X comes last in tab order. */}
          <p
            data-testid="verdict-toast-detail"
            className="flex items-start gap-2 pr-8 text-github-text-secondary"
          >
            {report && (
              <span className={`shrink-0 ${deliveryColor(report.state)}`}>
                <DeliveryGlyph state={report.state} />
              </span>
            )}
            <span className="min-w-0 [overflow-wrap:anywhere]">
              <span className="font-medium text-github-text-primary">
                {describeVerdict(verdict)}.
              </span>{' '}
              {report?.text}
              {report && ' '}
              {step.kind === 'switch' ? (
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
                  {allDone} If the agent hasn't resumed, copy the prompt and paste it into the chat
                  that opened this review.
                  {step.status === 'error' && (
                    <span role="alert" className="mt-1 block text-github-danger">
                      Could not copy the prompt; try again.
                    </span>
                  )}
                </>
              ) : (
                "Copied. Paste it into the agent's chat, then close this page."
              )}
            </span>
          </p>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <button type="button" onClick={onUndo} disabled={busy} className={secondaryClasses}>
              Undo
            </button>
            {/* Blue, not green: green means approval on the verdict buttons beside it. */}
            {(step.kind === 'switch' || step.kind === 'resume') && (
              <button
                type="button"
                onClick={onProceed}
                disabled={step.kind === 'resume' && step.status === 'copying'}
                {...(step.kind === 'switch' ? { title: `Switch to ${step.name}` } : {})}
                className={`${verdictButtonClasses} min-w-0 max-w-full shrink-0 border-blue-600 bg-blue-600 text-white hover:opacity-90`}
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
              </button>
            )}
          </div>
          {/* The sidebars' close button. */}
          <button
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
