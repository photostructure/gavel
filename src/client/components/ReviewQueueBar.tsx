import { Check, ChevronDown, Circle, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';

import type { ReviewApproval } from '../../types/conversation';
import type { DiffSelection } from '../../types/diff';
import { diffSelectionsEqual, getDiffSelectionKey } from '../../utils/diffSelection';
import { hasVerdict } from '../utils/verdict';

import { HeaderMenu } from './HeaderMenu';
import { describeApproval } from './VerdictControl';

/** A review on this server that proposes a commit for approval. */
export interface ApprovalRequest {
  selection: DiffSelection;
  name: string;
  title: string;
  approval: ReviewApproval;
}

const approvalLabel = ({ requested = false, approved, mode, conditions, notYet }: ReviewApproval) =>
  describeApproval(
    requested,
    approved,
    mode,
    conditions?.filter((condition) => !condition.addressed).length ?? 0,
  ) ?? (notYet ? 'Not yet' : 'Needs a verdict');

const isDone = (review: ApprovalRequest) => hasVerdict(review.approval);

const tabClasses = '-mb-px inline-flex items-center gap-1 rounded-t-md border px-3 py-1.5';
// Each verdict's color, the same as its chosen button in VerdictControl.
const verdictColor = (approval: ReviewApproval) =>
  approval.notYet
    ? { text: 'text-github-danger', topBorder: 'border-t-github-danger' }
    : approval.requested && approval.mode === 'after-comments'
      ? { text: 'text-amber-700', topBorder: 'border-t-amber-700' }
      : approval.requested
        ? { text: 'text-github-accent', topBorder: 'border-t-github-accent' }
        : // No verdict yet: neutral, since green would read as approval.
          { text: 'text-github-text-muted', topBorder: 'border-t-github-text-secondary' };

// The open tab overlaps the bar's bottom border and shares the Change summary row's
// background, so it reads as attached to the review below it. Its top border, in its
// verdict's color, marks it when it sits on an upper row of wrapped tabs.
const openTabClasses = (approval: ReviewApproval | undefined, approvals: boolean) =>
  `border-github-border border-t-2 ${approvals && approval ? verdictColor(approval).topBorder : 'border-t-github-accent'} border-b-github-bg-secondary bg-github-bg-secondary font-semibold text-github-text-primary`;

function ApprovalMark({ approval }: { approval: ReviewApproval }) {
  const { text } = verdictColor(approval);
  return approval.notYet ? (
    <X
      size={12}
      aria-hidden="true"
      data-verdict="not-yet"
      className={`verdict-mark shrink-0 ${text}`}
    />
  ) : approval.requested ? (
    <Check size={12} aria-hidden="true" className={`verdict-mark shrink-0 ${text}`} />
  ) : (
    <Circle size={10} aria-hidden="true" className={`verdict-mark shrink-0 ${text}`} />
  );
}

const UNREAD_LABEL = 'unread replies';
const EMPTY_UNREAD: ReadonlySet<string> = new Set();

function UnreadDot() {
  return (
    <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500">
      <span className="sr-only">, {UNREAD_LABEL}</span>
    </span>
  );
}

export function ReviewQueueBar({
  reviews,
  current,
  approvals,
  pulse = 0,
  unreadReviews = EMPTY_UNREAD,
  onSelect,
}: {
  // In the order the server created them, which agents use for commit order.
  reviews: ApprovalRequest[];
  current: DiffSelection | null;
  // False on a server launched with --no-lgtm, where nothing can be approved.
  approvals: boolean;
  // Each increase replays a pulse on the tabs of reviews without a verdict.
  pulse?: number;
  // getDiffSelectionKey of each review with an unread agent reply.
  unreadReviews?: ReadonlySet<string>;
  onSelect: (selection: DiffSelection) => void;
}) {
  const hasUnread = (review: ApprovalRequest) =>
    unreadReviews.has(getDiffSelectionKey(review.selection));
  // Two identically animated classes: switching between them restarts the animation.
  const pulseClass = (review: ApprovalRequest) =>
    approvals && pulse > 0 && !isDone(review) ? ` verdict-pulse-${pulse % 2}` : '';
  const measureRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  // Every dot is the same width, so their number is enough to know when to measure again.
  const unreadTabs = reviews.filter(hasUnread).length;

  // The tabs collapse into one menu when a hidden one-row copy of them is wider than the
  // bar, so a long stack never pushes the diff down by several rows.
  useLayoutEffect(() => {
    const measure = measureRef.current;
    if (!measure) return;
    const update = () => setCollapsed(measure.scrollWidth > measure.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(measure);
    return () => observer.disconnect();
  }, [reviews, approvals, unreadTabs]);

  const open = reviews.find((review) => diffSelectionsEqual(review.selection, current));
  // While a review asks for approval the revision picker is gone, so the bar is the only way
  // to reach a review that isn't open.
  if (reviews.length === 0 || (reviews.length === 1 && open)) return null;

  const waiting = reviews.filter((review) => !isDone(review)).length;
  const count = !approvals
    ? `${reviews.length} reviews`
    : waiting === 0
      ? `All ${reviews.length} have a verdict`
      : `${waiting} of ${reviews.length} need a verdict`;
  const countLabel = (
    // The same box as a tab (padding, transparent border, -mb-px), so its text lines up with
    // the tab titles in the bar's bottom-aligned row.
    <span className="-mb-px mr-2 inline-flex shrink-0 items-center whitespace-nowrap border border-transparent py-1.5 text-github-text-secondary">
      {count}
    </span>
  );

  return (
    <nav
      aria-label="Reviews on this server"
      className="review-toolbar relative flex shrink-0 flex-wrap items-end gap-x-0.5 gap-y-1 border-b border-github-border bg-github-bg-tertiary px-3 pt-1.5 text-xs text-github-text-primary"
    >
      <div
        ref={measureRef}
        data-tab-measure
        aria-hidden="true"
        inert
        className="pointer-events-none invisible absolute inset-x-0 top-0 flex flex-nowrap items-end gap-x-0.5 overflow-hidden px-3 pt-1.5"
      >
        {countLabel}
        {reviews.map((review) => (
          <span
            key={getDiffSelectionKey(review.selection)}
            className={`${tabClasses} shrink-0 whitespace-nowrap`}
          >
            {approvals && <ApprovalMark approval={review.approval} />}
            <code className="font-semibold">{review.name}</code>
            {hasUnread(review) && <UnreadDot />}
          </span>
        ))}
      </div>
      {countLabel}
      {collapsed ? (
        <HeaderMenu
          // The menu hides the other tabs, so it pulses for any review without a verdict.
          className={`${tabClasses} min-w-0 ${openTabClasses(open?.approval, approvals)}${reviews.map(pulseClass).find(Boolean) ?? ''}`}
          label={
            <>
              <span className="sr-only">All reviews, open: </span>
              {approvals && open && <ApprovalMark approval={open.approval} />}
              <code className="truncate">{open?.name ?? 'Choose a review'}</code>
              {reviews.some(hasUnread) && <UnreadDot />}
              <ChevronDown size={12} aria-hidden="true" className="shrink-0" />
            </>
          }
        >
          <ol className="-m-3 divide-y divide-github-border">
            {reviews.map((review) => {
              const isOpen = review === open;
              return (
                <li key={getDiffSelectionKey(review.selection)}>
                  <button
                    type="button"
                    data-close-menu
                    aria-current={isOpen ? 'page' : undefined}
                    onClick={() => onSelect(review.selection)}
                    className={`flex w-full items-start gap-2 px-3 py-2 text-left text-xs hover:bg-github-bg-tertiary ${isOpen ? 'border-l-4 border-l-github-accent bg-github-bg-tertiary pl-2' : ''}`}
                  >
                    {approvals && (
                      <span className="pt-0.5">
                        <ApprovalMark approval={review.approval} />
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <code className="block break-all font-semibold">{review.name}</code>
                        {hasUnread(review) && <UnreadDot />}
                      </span>
                      {review.title && (
                        <span className="block truncate text-github-text-secondary">
                          {review.title}
                        </span>
                      )}
                      {approvals && (
                        <span className="block text-github-text-muted">
                          {approvalLabel(review.approval)}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </HeaderMenu>
      ) : (
        // Wrap rather than scroll until the menu takes over. display: contents lets the
        // tabs share rows with the count; the explicit role keeps the list semantics that
        // Safari drops from display: contents.
        <ul role="list" className="contents">
          {reviews.map((review) => {
            const isOpen = review === open;
            const state = approvals ? approvalLabel(review.approval) : undefined;
            const unread = hasUnread(review);
            return (
              <li key={getDiffSelectionKey(review.selection)} className="shrink-0">
                <button
                  type="button"
                  aria-current={isOpen ? 'page' : undefined}
                  aria-label={
                    state
                      ? [review.name, state, unread && UNREAD_LABEL].filter(Boolean).join(', ')
                      : undefined
                  }
                  title={[review.title, state, unread && 'Unread replies']
                    .filter(Boolean)
                    .join('\n')}
                  onClick={() => onSelect(review.selection)}
                  className={`${tabClasses} ${isOpen ? openTabClasses(review.approval, approvals) : 'border-transparent text-github-text-secondary hover:bg-github-bg-secondary hover:text-github-text-primary'}${pulseClass(review)}`}
                >
                  {state && <ApprovalMark approval={review.approval} />}
                  <code>{review.name}</code>
                  {unread && <UnreadDot />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
