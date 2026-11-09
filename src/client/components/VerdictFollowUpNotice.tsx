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

import { COUNTDOWN_SECONDS, type VerdictFollowUpStep } from '../hooks/useVerdictFollowUp';

import { verdictButtonClasses } from './VerdictControl';

/**
 * What happens after a verdict: the next review, closing the tab, or that the tab can close.
 * It floats just below the verdict buttons, where the reviewer is looking, from a portal: the
 * header group clips its overflow.
 */
export function VerdictFollowUpNotice({
  anchor,
  step,
  onCancel,
  onProceed,
}: {
  // The verdict buttons.
  anchor: Element | null;
  step: VerdictFollowUpStep | null;
  // Cancels a countdown, or dismisses the notice once the tab can be closed.
  onCancel: () => void;
  // Takes the countdown's next step now.
  onProceed: () => void;
}) {
  const { refs, floatingStyles, middlewareData, context } = useFloating({
    open: step !== null,
    placement: 'bottom-end',
    elements: { reference: anchor },
    whileElementsMounted: autoUpdate,
    // hide: the header slides away while the diff scrolls on touch screens.
    middleware: [offset(6), flip(), shift({ padding: 8 }), hide()],
  });
  if (!step) return null;
  const allDone =
    step.kind !== 'switch' &&
    (step.reviews === 1
      ? 'This review has a verdict.'
      : `All ${step.reviews} reviews have a verdict.`);
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
          }}
          className="z-40 flex items-center gap-3 overflow-hidden rounded-md border border-blue-600 bg-[color-mix(in_srgb,var(--color-blue-600)_14%,var(--color-github-bg-secondary))] [[data-theme=dark]_&]:bg-[color-mix(in_srgb,var(--color-blue-600)_20%,var(--color-github-bg-secondary))] pt-3 pr-4 pb-3.5 pl-5 text-sm text-github-text-primary shadow-2xl"
        >
          <span className="min-w-0">
            {step.kind === 'switch' ? (
              <>
                Switching to <code className="font-semibold">{step.name}</code> in {step.seconds}s
              </>
            ) : step.kind === 'close' ? (
              `${allDone} Closing this tab in ${step.seconds}s`
            ) : (
              `${allDone} You can close this tab.`
            )}
          </span>
          {/* Blue, not green: green means approval on the verdict buttons beside it. */}
          {step.kind !== 'closable' && (
            <button
              type="button"
              onClick={onProceed}
              className={`${verdictButtonClasses} shrink-0 border-blue-600 bg-blue-600 text-white hover:opacity-90`}
            >
              {step.kind === 'switch' ? 'Switch now' : 'Close now'}
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className={`${verdictButtonClasses} shrink-0 border-github-text-secondary bg-github-bg-primary text-github-text-primary hover:bg-github-bg-tertiary`}
          >
            {step.kind === 'closable' ? 'Dismiss' : 'Cancel'}
          </button>
          {/* A CSS animation, so it runs smoothly between the once-a-second renders. The key
              restarts it for a new countdown. */}
          {step.kind !== 'closable' && (
            <div
              key={step.deadline}
              aria-hidden="true"
              style={{ animationDuration: `${COUNTDOWN_SECONDS}s` }}
              className="verdict-countdown-bar absolute inset-x-0 bottom-0 h-[3px] bg-blue-600"
            />
          )}
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  );
}
