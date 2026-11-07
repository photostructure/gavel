import { Check, ChevronDown, Circle } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';

import type { ReviewApproval } from '../../types/conversation';
import type { DiffSelection } from '../../types/diff';
import { diffSelectionsEqual, getDiffSelectionKey } from '../../utils/diffSelection';

import { describeApproval } from './ApprovalSplitButton';
import { HeaderMenu } from './HeaderMenu';

/** A review on this server that proposes a commit for approval. */
export interface ApprovalRequest {
  selection: DiffSelection;
  name: string;
  title: string;
  approval: ReviewApproval;
}

const approvalLabel = ({ requested = false, approved, mode, conditions }: ReviewApproval) =>
  describeApproval(
    requested,
    approved,
    mode,
    conditions?.filter((condition) => !condition.addressed).length ?? 0,
  ) ?? 'Not approved';

// An approval after comments stays approved: false until the agent addresses them,
// but the reviewer's part is done once requested is set.
const isDone = (review: ApprovalRequest) => review.approval.requested === true;

const tabClasses = '-mb-px inline-flex items-center gap-1 rounded-t-md border px-3 py-1.5';
// The open tab overlaps the bar's bottom border and shares the Change summary row's
// background, so it reads as attached to the review below it. The accent top border marks
// it when it sits on an upper row of wrapped tabs.
const openTabClasses =
  'border-github-border border-t-2 border-t-github-accent border-b-github-bg-secondary bg-github-bg-secondary font-semibold text-github-text-primary';

function ApprovalMark({ done }: { done: boolean }) {
  return done ? (
    <Check size={12} aria-hidden="true" className="shrink-0 text-github-accent" />
  ) : (
    <Circle size={10} aria-hidden="true" className="shrink-0 text-github-text-muted" />
  );
}

export function ReviewQueueBar({
  reviews,
  current,
  approvals,
  onSelect,
}: {
  // In the order the server created them, which agents use for commit order.
  reviews: ApprovalRequest[];
  current: DiffSelection | null;
  // False on a server launched with --no-lgtm, where nothing can be approved.
  approvals: boolean;
  onSelect: (selection: DiffSelection) => void;
}) {
  const measureRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

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
  }, [reviews, approvals]);

  const open = reviews.find((review) => diffSelectionsEqual(review.selection, current));
  // While a review asks for approval the revision picker is gone, so the bar is the only way
  // to reach a review that isn't open.
  if (reviews.length === 0 || (reviews.length === 1 && open)) return null;

  const waiting = reviews.filter((review) => !isDone(review)).length;
  const count = !approvals
    ? `${reviews.length} reviews`
    : waiting === 0
      ? `All ${reviews.length} approved`
      : `${waiting} of ${reviews.length} need approval`;
  const countLabel = (
    <span className="mr-2 shrink-0 self-center whitespace-nowrap pb-1 text-github-text-secondary">
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
            {approvals && <ApprovalMark done={isDone(review)} />}
            <code className="font-semibold">{review.name}</code>
          </span>
        ))}
      </div>
      {countLabel}
      {collapsed ? (
        <HeaderMenu
          className={`${tabClasses} min-w-0 ${openTabClasses}`}
          label={
            <>
              <span className="sr-only">All reviews, open: </span>
              {approvals && open && <ApprovalMark done={isDone(open)} />}
              <code className="truncate">{open?.name ?? 'Choose a review'}</code>
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
                        <ApprovalMark done={isDone(review)} />
                      </span>
                    )}
                    <span className="min-w-0">
                      <code className="block break-all font-semibold">{review.name}</code>
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
            return (
              <li key={getDiffSelectionKey(review.selection)} className="shrink-0">
                <button
                  type="button"
                  aria-current={isOpen ? 'page' : undefined}
                  aria-label={state ? `${review.name}, ${state}` : undefined}
                  title={[review.title, state].filter(Boolean).join('\n')}
                  onClick={() => onSelect(review.selection)}
                  className={`${tabClasses} ${isOpen ? openTabClasses : 'border-transparent text-github-text-secondary hover:bg-github-bg-secondary hover:text-github-text-primary'}`}
                >
                  {state && <ApprovalMark done={isDone(review)} />}
                  <code>{review.name}</code>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
