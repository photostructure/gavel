import {
  FloatingPortal,
  autoUpdate,
  flip,
  hide,
  offset,
  shift,
  useFloating,
} from '@floating-ui/react';
import { X } from 'lucide-react';
import { useState } from 'react';

/**
 * A toast for changes this browser could not send to the server. It looks like the verdict
 * toast, in orange, and floats from a portal under `anchor`: the verdict toast while that is
 * open, so the two stack, or the header otherwise. It takes no focus, since it can open while
 * the reviewer is typing a comment. Dismissing it hides this message; a different one, such as
 * a new count, shows it again.
 */
export function UnsavedChangesToast({
  anchor,
  message,
}: {
  anchor: Element | null;
  message: string | null;
}) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  // Once the changes are sent, the same message after a later failure shows again.
  if (message === null && dismissed !== null) setDismissed(null);
  const open = message !== null && message !== dismissed;
  const { refs, floatingStyles, middlewareData } = useFloating({
    open,
    placement: 'bottom-end',
    // Fixed, as the verdict toast is, so it never adds to the page's scroll size.
    strategy: 'fixed',
    elements: { reference: anchor },
    whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip(), shift({ padding: 8 }), hide()],
  });
  if (!open) return null;
  return (
    <FloatingPortal>
      {/* The verdict toast's frame and shadows, with orange for its blue. */}
      <div
        ref={refs.setFloating}
        role="alert"
        style={{
          ...floatingStyles,
          visibility: middlewareData.hide?.referenceHidden ? 'hidden' : 'visible',
          maxWidth: 'min(36rem, calc(100vw - 16px))',
        }}
        className="unsaved-toast z-40 rounded-md border border-orange-600 bg-[color-mix(in_srgb,var(--color-orange-600)_14%,var(--color-github-bg-secondary))] [[data-theme=dark]_&]:bg-[color-mix(in_srgb,var(--color-orange-600)_20%,var(--color-github-bg-secondary))] py-3 pr-4 pl-4 text-sm text-github-text-primary shadow-[0_12px_32px_rgb(31_35_40/0.3),0_2px_6px_rgb(31_35_40/0.16)] [[data-theme=dark]_&]:shadow-[0_0_0_1px_rgb(1_4_9/0.9),0_16px_40px_rgb(1_4_9/0.9)]"
      >
        <p className="pr-8 leading-7 [overflow-wrap:anywhere]">{message}</p>
        <button
          type="button"
          onClick={() => setDismissed(message)}
          aria-label="Dismiss"
          title="Dismiss"
          className="absolute top-1.5 right-1.5 p-1 text-github-text-secondary transition-colors hover:text-github-text-primary"
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>
    </FloatingPortal>
  );
}
