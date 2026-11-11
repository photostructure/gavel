import { Check, ChevronDown, Circle, MessageSquareMore, X } from 'lucide-react';
import { useState, type MouseEvent, type Ref } from 'react';

import type { ReviewVerdict } from '../../types/conversation';

import { HeaderMenu } from './HeaderMenu';

const VERDICT_NAMES: Record<ReviewVerdict, string> = {
  'as-is': 'Approved as-is',
  'after-comments': 'Approved after comments',
  reject: 'Rejected',
};

/** Names a recorded verdict; undefined when there is none. */
export const describeVerdict = (verdict: ReviewVerdict | undefined) =>
  verdict && VERDICT_NAMES[verdict];

// The verdict follow-up notice sizes its buttons with these too.
export const verdictButtonClasses =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-60';
const idleClasses = 'border-github-border bg-github-bg-tertiary text-github-text-primary';
// Idle buttons look alike, so none reads as already chosen; hover shows which way each goes.
// Only the border tints (doubled by an inset ring): green or violet text on this background is
// too faint to read.
const approveIdleClasses = `${idleClasses} enabled:hover:border-github-accent enabled:hover:shadow-[inset_0_0_0_1px_var(--color-github-accent)]`;
// Yellow, like its fill once chosen.
const afterCommentsIdleClasses = `${idleClasses} enabled:hover:border-verdict-after-comments enabled:hover:shadow-[inset_0_0_0_1px_var(--color-verdict-after-comments)]`;
const rejectIdleClasses = `${idleClasses} enabled:hover:border-verdict-reject enabled:hover:shadow-[inset_0_0_0_1px_var(--color-verdict-reject)]`;
const approvedClasses = 'border-github-accent bg-github-accent text-white';
// A chosen approval after comments is filled yellow, with dark text because white on this
// yellow measures 1.57:1. It stays yellow: comments may live outside gavel, so this verdict
// neither counts them nor changes on its own.
const afterCommentsClasses = 'border-yellow-400 bg-yellow-400 text-gray-900';
const rejectClasses = 'border-verdict-reject bg-verdict-reject text-white';
const clearTitle = 'Clear this verdict';
const rejectDescription = 'The agent stops and asks you what to do instead.';

/**
 * The reviewer's verdict on the open review: approve as-is, approve after comments are
 * addressed, or reject. Wide screens show each as a button; narrow screens list them in a menu.
 */
export function VerdictControl({
  containerRef,
  verdict,
  conditionalSupported = false,
  disabled,
  approveDisabled,
  busy,
  onVerdict,
  onClear,
}: {
  // The approval celebration bursts from this element.
  containerRef: Ref<HTMLDivElement>;
  verdict?: ReviewVerdict;
  conditionalSupported?: boolean;
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
  const asIs = verdict === 'as-is';
  const afterComments = verdict === 'after-comments';
  const rejected = verdict === 'reject';
  // Clearing ignores a double-click's second click (detail 2), which lands on the button its
  // first click just pressed; a keyboard press has detail 0.
  const clear = (event: MouseEvent) => {
    if (event.detail <= 1) onClear();
  };
  const afterCommentsTitle = conditionalSupported
    ? 'The agent addresses all your comments, then commits'
    : 'Unavailable on this review server';
  return (
    <div ref={containerRef} className="flex items-stretch">
      <div role="group" aria-label="Verdict" className="hidden items-stretch gap-1.5 xl:flex">
        {/* Clicking the pressed button clears its verdict; clearing never leaves the review. */}
        <button
          type="button"
          aria-pressed={asIs}
          disabled={busy || (!asIs && (disabled || approveDisabled))}
          aria-busy={busy}
          title={asIs ? clearTitle : 'Approve the reviewed patch as-is'}
          onClick={(event) => (asIs ? clear(event) : onVerdict('as-is'))}
          className={`${verdictButtonClasses} ${asIs ? approvedClasses : approveIdleClasses}`}
        >
          <Check size={14} aria-hidden="true" />
          {asIs ? current : 'Approve as-is'}
        </button>
        <button
          type="button"
          aria-pressed={afterComments}
          disabled={
            busy || (!afterComments && (disabled || approveDisabled || !conditionalSupported))
          }
          aria-busy={busy}
          title={afterComments ? clearTitle : afterCommentsTitle}
          onClick={(event) => (afterComments ? clear(event) : onVerdict('after-comments'))}
          className={`${verdictButtonClasses} ${afterComments ? afterCommentsClasses : afterCommentsIdleClasses}`}
        >
          <MessageSquareMore size={14} aria-hidden="true" />
          {afterComments ? current : 'Approve after comments'}
        </button>
        <button
          type="button"
          aria-pressed={rejected}
          disabled={busy || (!rejected && disabled)}
          aria-busy={busy}
          title={rejected ? clearTitle : rejectDescription}
          onClick={(event) => (rejected ? clear(event) : onVerdict('reject'))}
          className={`${verdictButtonClasses} ${rejected ? rejectClasses : rejectIdleClasses}`}
        >
          <X size={14} aria-hidden="true" />
          Reject
        </button>
      </div>
      <div className="flex xl:hidden">
        <HeaderMenu
          open={open}
          onOpenChange={setOpen}
          title={current ?? 'Choose a verdict'}
          className={`inline-flex items-center justify-center gap-1 rounded-md border px-2 disabled:opacity-60 ${
            rejected
              ? rejectClasses
              : afterComments
                ? afterCommentsClasses
                : asIs
                  ? approvedClasses
                  : idleClasses
          }`}
          label={
            <>
              {rejected ? (
                <X size={14} aria-hidden="true" />
              ) : afterComments ? (
                <MessageSquareMore size={14} aria-hidden="true" />
              ) : asIs ? (
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
            onClick={() => onVerdict('as-is')}
            className="w-full rounded p-2 text-left hover:bg-github-bg-tertiary disabled:opacity-60"
          >
            Approve as-is
            <span className="block text-xs text-github-text-secondary">
              Land the reviewed patch.
            </span>
          </button>
          <button
            type="button"
            disabled={busy || disabled || approveDisabled || !conditionalSupported}
            data-close-menu
            onClick={() => onVerdict('after-comments')}
            className="w-full rounded p-2 text-left hover:bg-github-bg-tertiary disabled:opacity-60"
          >
            Approve after comments are addressed
            <span className="block text-xs text-github-text-secondary">
              {conditionalSupported
                ? 'The agent addresses all your comments, then commits.'
                : 'Unavailable on this review server.'}
            </span>
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
