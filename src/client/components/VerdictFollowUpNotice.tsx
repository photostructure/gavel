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

import type { VerdictFollowUpStep } from '../hooks/useVerdictFollowUp';

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
          className="z-40 flex items-center gap-2 rounded-md border border-blue-600 bg-github-bg-secondary px-3 py-1.5 text-sm text-github-text-primary shadow-lg"
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
              className="shrink-0 rounded-md border border-blue-600 bg-blue-600 px-2.5 py-0.5 text-xs font-medium text-white hover:opacity-90"
            >
              {step.kind === 'switch' ? 'Switch now' : 'Close now'}
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="shrink-0 rounded-md border border-github-text-secondary bg-github-bg-primary px-2.5 py-0.5 text-xs font-medium text-github-text-primary hover:bg-github-bg-tertiary"
          >
            {step.kind === 'closable' ? 'Dismiss' : 'Cancel'}
          </button>
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  );
}
