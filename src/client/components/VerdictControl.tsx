import { Check, ChevronDown, Circle, X } from 'lucide-react';
import { useState, type MouseEvent, type Ref } from 'react';

import type { ApprovalMode } from '../../types/conversation';

import { HeaderMenu } from './HeaderMenu';

/** Names a recorded approval; undefined when the reviewer has not approved. */
export const describeApproval = (
  requested: boolean,
  approved: boolean,
  mode: ApprovalMode | undefined,
  pendingCount: number,
) =>
  requested
    ? mode === 'after-comments'
      ? approved
        ? 'Approved after comments'
        : `Approved · ${pendingCount} pending`
      : 'Approved as-is'
    : undefined;

// The verdict follow-up notice sizes its buttons with these too.
export const verdictButtonClasses =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-60';
const idleClasses = 'border-github-border bg-github-bg-tertiary text-github-text-primary';
// Idle buttons look alike, so none reads as already chosen; hover shows which way each goes.
// Only the border tints (doubled by an inset ring): green or red text on this background is
// too faint to read.
const approveIdleClasses = `${idleClasses} enabled:hover:border-github-accent enabled:hover:shadow-[inset_0_0_0_1px_var(--color-github-accent)]`;
// Amber, the fill it gets once chosen.
const afterCommentsIdleClasses = `${idleClasses} enabled:hover:border-amber-700 enabled:hover:shadow-[inset_0_0_0_1px_var(--color-amber-700)]`;
const notYetIdleClasses = `${idleClasses} enabled:hover:border-github-danger enabled:hover:shadow-[inset_0_0_0_1px_var(--color-github-danger)]`;
const approvedClasses = 'border-github-accent bg-github-accent text-white';
// Pending or complete, a chosen approval after comments is filled amber (white text about 5:1),
// as as-is is filled green and Not yet red; its label says whether comments are pending.
const afterCommentsClasses = 'border-amber-700 bg-amber-700 text-white';
const notYetClasses = 'border-github-danger bg-github-danger text-white';
const clearTitle = 'Clear this verdict';

/**
 * The reviewer's verdict on the open review: approve as-is, approve after comments are
 * addressed, or not yet. Wide screens show each as a button; narrow screens list them in a menu.
 */
export function VerdictControl({
  containerRef,
  requested,
  approved,
  notYet,
  mode,
  pendingCount,
  conditionalSupported = false,
  disabled,
  approveDisabled,
  busy,
  onApprove,
  onNotYet,
  onRevoke,
}: {
  // The approval celebration bursts from this element.
  containerRef: Ref<HTMLDivElement>;
  requested: boolean;
  approved: boolean;
  notYet: boolean;
  mode?: ApprovalMode;
  pendingCount: number;
  conditionalSupported?: boolean;
  // Every verdict waits for the approval state and comments to load and for summary edits to
  // save: the next step after a verdict leaves the review and would drop the draft.
  disabled: boolean;
  // Approval also waits for the summary to load; not yet does not endorse it.
  approveDisabled: boolean;
  busy: boolean;
  onApprove: (mode: ApprovalMode) => void;
  onNotYet: () => void;
  onRevoke: () => void;
}) {
  const [open, setOpen] = useState(false);
  const approval = describeApproval(requested, approved, mode, pendingCount);
  const current = approval ?? (notYet ? 'Not yet' : undefined);
  const asIs = requested && mode !== 'after-comments';
  const afterComments = requested && mode === 'after-comments';
  // Clearing ignores a double-click's second click (detail 2), which lands on the button its
  // first click just pressed; a keyboard press has detail 0.
  const clear = (event: MouseEvent) => {
    if (event.detail <= 1) onRevoke();
  };
  const afterCommentsTitle = conditionalSupported
    ? 'Approve once every included comment has explicit completion evidence'
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
          onClick={(event) => (asIs ? clear(event) : onApprove('as-is'))}
          className={`${verdictButtonClasses} ${asIs ? approvedClasses : approveIdleClasses}`}
        >
          <Check size={14} aria-hidden="true" />
          {asIs ? approval : 'Approve as-is'}
        </button>
        <button
          type="button"
          aria-pressed={afterComments}
          disabled={
            busy || (!afterComments && (disabled || approveDisabled || !conditionalSupported))
          }
          aria-busy={busy}
          title={afterComments ? clearTitle : afterCommentsTitle}
          onClick={(event) => (afterComments ? clear(event) : onApprove('after-comments'))}
          className={`${verdictButtonClasses} ${afterComments ? afterCommentsClasses : afterCommentsIdleClasses}`}
        >
          <Check size={14} aria-hidden="true" />
          {afterComments ? approval : 'Approve after comments'}
        </button>
        <button
          type="button"
          aria-pressed={notYet}
          disabled={busy || (!notYet && disabled)}
          aria-busy={busy}
          title={notYet ? clearTitle : 'Not ready: the agent revises it and asks again'}
          onClick={(event) => (notYet ? clear(event) : onNotYet())}
          className={`${verdictButtonClasses} ${notYet ? notYetClasses : notYetIdleClasses}`}
        >
          <X size={14} aria-hidden="true" />
          Not yet
        </button>
      </div>
      <div className="flex xl:hidden">
        <HeaderMenu
          open={open}
          onOpenChange={setOpen}
          title={current ?? 'Choose a verdict'}
          className={`inline-flex items-center justify-center gap-1 rounded-md border px-2 disabled:opacity-60 ${
            notYet
              ? notYetClasses
              : !requested
                ? idleClasses
                : afterComments
                  ? afterCommentsClasses
                  : approvedClasses
          }`}
          label={
            <>
              {notYet ? (
                <X size={14} aria-hidden="true" />
              ) : requested ? (
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
          {afterComments && (
            <p className="ui-value mb-2 text-xs">
              Resolving a thread confirms its included comments for this approval.
            </p>
          )}
          <button
            type="button"
            disabled={busy || disabled || approveDisabled}
            data-close-menu
            onClick={() => onApprove('as-is')}
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
            onClick={() => onApprove('after-comments')}
            className="w-full rounded p-2 text-left hover:bg-github-bg-tertiary disabled:opacity-60"
          >
            Approve after comments are addressed
            <span className="block text-xs text-github-text-secondary">
              {conditionalSupported
                ? 'Every included comment needs explicit completion evidence before committing.'
                : 'Unavailable on this review server.'}
            </span>
          </button>
          <button
            type="button"
            disabled={busy || disabled}
            data-close-menu
            onClick={onNotYet}
            className="w-full rounded p-2 text-left hover:bg-github-bg-tertiary disabled:opacity-60"
          >
            {/* Red text is too faint on the dark menu, so the icon carries the color. */}
            <X size={14} aria-hidden="true" className="mr-1 inline text-github-danger" />
            Not yet
            <span className="block text-xs text-github-text-secondary">
              Send it back: the agent revises it and asks again.
            </span>
          </button>
          {(requested || notYet) && (
            <button
              type="button"
              disabled={busy}
              data-close-menu
              onClick={onRevoke}
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
