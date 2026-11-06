import { Check, ChevronDown } from 'lucide-react';
import { useState, type Ref } from 'react';

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

export function ApprovalSplitButton({
  containerRef,
  requested,
  approved,
  mode,
  pendingCount,
  conditionalSupported = false,
  disabled,
  busy,
  onApprove,
  onRevoke,
}: {
  // The approval celebration bursts from this element.
  containerRef: Ref<HTMLDivElement>;
  requested: boolean;
  approved: boolean;
  mode?: ApprovalMode;
  pendingCount: number;
  conditionalSupported?: boolean;
  disabled: boolean;
  busy: boolean;
  onApprove: (mode: ApprovalMode) => void;
  onRevoke: () => void;
}) {
  const [open, setOpen] = useState(false);
  const label = describeApproval(requested, approved, mode, pendingCount) ?? 'Approve as-is';
  const colors = !requested
    ? 'border-github-border bg-github-bg-tertiary text-github-text-primary'
    : !approved
      ? 'border-yellow-600 bg-github-bg-secondary ui-warning'
      : 'border-github-accent bg-github-accent text-white';
  return (
    <div ref={containerRef} className={`flex items-stretch rounded-md border ${colors}`}>
      {/* Below 1024px only the checkmark and chevron show, and they always open the menu. */}
      <button
        type="button"
        disabled={busy || disabled}
        aria-busy={busy}
        title="Approve the reviewed patch as-is"
        onClick={() => onApprove('as-is')}
        className="hidden min-w-0 items-center justify-center gap-1.5 rounded-l-md px-3 py-1.5 text-sm font-medium disabled:opacity-60 lg:inline-flex"
      >
        <Check size={14} aria-hidden="true" />
        {label}
      </button>
      <HeaderMenu
        open={open}
        onOpenChange={setOpen}
        title={requested ? label : 'Choose an approval mode'}
        className="inline-flex items-center justify-center gap-1 rounded-md px-2 disabled:opacity-60 lg:rounded-l-none lg:border-l lg:border-current/30"
        label={
          <>
            <Check size={14} aria-hidden="true" className="lg:hidden" />
            <ChevronDown size={14} aria-hidden="true" />
            <span className="sr-only">Approval options</span>
          </>
        }
      >
        <div className="mb-2 text-xs ui-label">{requested ? label : 'Choose an approval mode'}</div>
        {requested && mode === 'after-comments' && (
          <p className="ui-value mb-2 text-xs">
            Resolving a thread confirms its included comments for this approval.
          </p>
        )}
        <button
          type="button"
          disabled={disabled || busy}
          data-close-menu
          onClick={() => onApprove('as-is')}
          className="w-full rounded p-2 text-left hover:bg-github-bg-tertiary disabled:opacity-60"
        >
          Approve as-is
          <span className="block text-xs text-github-text-secondary">Land the reviewed patch.</span>
        </button>
        <button
          type="button"
          disabled={disabled || busy || !conditionalSupported}
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
        {requested && (
          <button
            type="button"
            disabled={busy}
            data-close-menu
            onClick={onRevoke}
            className="mt-2 w-full rounded border-t border-github-border p-2 text-left hover:bg-github-bg-tertiary"
          >
            Revoke approval
          </button>
        )}
      </HeaderMenu>
    </div>
  );
}
