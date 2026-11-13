import { Check, ChevronDown, Circle, X } from 'lucide-react';
import { useState, type MouseEvent, type Ref } from 'react';

import type { ReviewVerdict } from '../../types/conversation';

import { HeaderMenu } from './HeaderMenu';

const VERDICT_NAMES: Record<ReviewVerdict, string> = {
  approve: 'Approved',
  reject: 'Rejected',
};

/** Names a recorded verdict; undefined when there is none. */
export const describeVerdict = (verdict: ReviewVerdict | undefined) =>
  verdict && VERDICT_NAMES[verdict];

// The verdict follow-up notice sizes its buttons with these too.
export const verdictButtonClasses =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-60';
// The verdict follow-up notice's secondary buttons use this too.
export const idleClasses = 'border-github-border bg-github-bg-tertiary text-github-text-primary';
// Idle buttons look alike, so none reads as already chosen; hover shows which way each goes.
// Only the border tints (doubled by an inset ring): green or violet text on this background is
// too faint to read.
const approveIdleClasses = `${idleClasses} enabled:hover:border-github-accent enabled:hover:shadow-[inset_0_0_0_1px_var(--color-github-accent)]`;
const rejectIdleClasses = `${idleClasses} enabled:hover:border-verdict-reject enabled:hover:shadow-[inset_0_0_0_1px_var(--color-verdict-reject)]`;
const approvedClasses = 'border-github-accent bg-github-accent text-white';
const rejectClasses = 'border-verdict-reject bg-verdict-reject text-white';
const clearTitle = 'Clear this verdict';
const approveDescription =
  'The agent addresses your comments, runs the required checks and reviews, then commits.';
const rejectDescription = 'The agent stops and asks you what to do instead.';

/**
 * The reviewer's verdict on the open review: approve or reject, each as a button, or listed in a
 * menu when the review header (group/header in App) has no room for the buttons.
 */
export function VerdictControl({
  containerRef,
  verdict,
  disabled,
  approveDisabled,
  busy,
  onVerdict,
  onClear,
}: {
  // The approval celebration bursts from this element.
  containerRef: Ref<HTMLDivElement>;
  verdict?: ReviewVerdict;
  // Every verdict waits for the approval state and comments to load.
  disabled: boolean;
  // Approval also waits for the summary to load; reject does not endorse it.
  approveDisabled: boolean;
  busy: boolean;
  onVerdict: (verdict: ReviewVerdict) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const current = describeVerdict(verdict);
  const approved = verdict === 'approve';
  const rejected = verdict === 'reject';
  // Clearing ignores a double-click's second click (detail 2), which lands on the button its
  // first click just pressed; a keyboard press has detail 0.
  const clear = (event: MouseEvent) => {
    if (event.detail <= 1) onClear();
  };
  return (
    <div ref={containerRef} className="flex items-stretch">
      <div
        role="group"
        aria-label="Verdict"
        className="flex items-stretch gap-1.5 group-data-verdict-menu/header:hidden"
      >
        {/* Clicking the pressed button clears its verdict; clearing never leaves the review. */}
        <button
          type="button"
          aria-pressed={approved}
          disabled={busy || (!approved && (disabled || approveDisabled))}
          aria-busy={busy}
          title={approved ? clearTitle : `${approveDescription} (Shift+A)`}
          onClick={(event) => (approved ? clear(event) : onVerdict('approve'))}
          className={`${verdictButtonClasses} ${approved ? approvedClasses : approveIdleClasses}`}
        >
          <Check size={14} aria-hidden="true" />
          {approved ? current : 'Approve'}
        </button>
        <button
          type="button"
          aria-pressed={rejected}
          disabled={busy || (!rejected && disabled)}
          aria-busy={busy}
          title={rejected ? clearTitle : `${rejectDescription} (Shift+X)`}
          onClick={(event) => (rejected ? clear(event) : onVerdict('reject'))}
          className={`${verdictButtonClasses} ${rejected ? rejectClasses : rejectIdleClasses}`}
        >
          <X size={14} aria-hidden="true" />
          Reject
        </button>
      </div>
      <div className="hidden group-data-verdict-menu/header:flex">
        <HeaderMenu
          open={open}
          onOpenChange={setOpen}
          title={current ?? 'Choose a verdict'}
          className={`inline-flex items-center justify-center gap-1 rounded-md border px-2 disabled:opacity-60 ${
            rejected ? rejectClasses : approved ? approvedClasses : idleClasses
          }`}
          label={
            <>
              {rejected ? (
                <X size={14} aria-hidden="true" />
              ) : approved ? (
                <Check size={14} aria-hidden="true" />
              ) : (
                <Circle size={12} aria-hidden="true" />
              )}
              <ChevronDown size={14} aria-hidden="true" />
              <span className="sr-only">Verdict options</span>
            </>
          }
        >
          <div className="mb-2 text-xs ui-label">{current ?? 'Choose a verdict'}</div>
          <button
            type="button"
            disabled={busy || disabled || approveDisabled}
            data-close-menu
            onClick={() => onVerdict('approve')}
            className="w-full rounded p-2 text-left hover:bg-github-bg-tertiary disabled:opacity-60"
          >
            <Check size={14} aria-hidden="true" className="mr-1 inline text-github-accent-text" />
            Approve
            <span className="block text-xs text-github-text-secondary">{approveDescription}</span>
          </button>
          <button
            type="button"
            disabled={busy || disabled}
            data-close-menu
            onClick={() => onVerdict('reject')}
            className="w-full rounded p-2 text-left hover:bg-github-bg-tertiary disabled:opacity-60"
          >
            {/* Violet text is too faint on the dark menu, so the icon carries the color. */}
            <X size={14} aria-hidden="true" className="mr-1 inline text-verdict-reject" />
            Reject
            <span className="block text-xs text-github-text-secondary">{rejectDescription}</span>
          </button>
          {verdict && (
            <button
              type="button"
              disabled={busy}
              data-close-menu
              onClick={onClear}
              className="mt-2 w-full rounded border-t border-github-border p-2 text-left hover:bg-github-bg-tertiary"
            >
              Clear verdict
            </button>
          )}
        </HeaderMenu>
      </div>
    </div>
  );
}
