import { Check, ChevronDown, Circle, X } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';

import type { ReviewApproval, ReviewWithdrawal } from '../../types/conversation';
import type { DiffSelection } from '../../types/diff';
import { diffSelectionsEqual, getDiffSelectionKey } from '../../utils/diffSelection';
import { needsVerdict } from '../utils/verdict';

import { HeaderMenu, headerButtonClasses } from './HeaderMenu';
import { describeVerdict } from './VerdictControl';

/** A review on this server that proposes a commit for approval. */
export interface ApprovalRequest {
  selection: DiffSelection;
  name: string;
  title: string;
  approval: ReviewApproval;
  withdrawal?: ReviewWithdrawal;
}

const approvalLabel = ({ verdict }: ReviewApproval) =>
  describeVerdict(verdict) ?? 'Needs a verdict';

// A withdrawal shows even on a --no-lgtm server, where verdicts do not.
const stateLabel = (review: ApprovalRequest, approvals: boolean) =>
  review.withdrawal ? 'Withdrawn' : approvals ? approvalLabel(review.approval) : undefined;

// The inset focus outline keeps the tab row's overflow from clipping it.
const tabClasses =
  'inline-flex items-center gap-1 rounded-t-md border px-3 py-1.5 focus-visible:-outline-offset-2';
// Each verdict's color, the same hue as its chosen button in VerdictControl. A review with a
// verdict also gets a light tint in that color, so the untinted tabs and menu items are the
// ones left to review.
const verdictColor = ({ verdict }: ReviewApproval) =>
  verdict === 'reject'
    ? {
        text: 'text-verdict-reject',
        topBorder: 'border-t-verdict-reject',
        tint: 'bg-verdict-reject/15 hover:bg-verdict-reject/25',
      }
    : verdict === 'approve'
      ? {
          text: 'text-github-accent',
          topBorder: 'border-t-github-accent',
          tint: 'bg-github-accent/15 hover:bg-github-accent/25',
        }
      : // No verdict yet: neutral, since green would read as approval.
        {
          text: 'text-github-text-muted',
          topBorder: 'border-t-github-text-secondary',
          tint: undefined,
        };
// Red, apart from reject's violet: the agent, not the reviewer, ended this review.
const WITHDRAWN_COLOR = {
  text: 'text-github-danger',
  topBorder: 'border-t-github-danger',
  tint: 'bg-github-danger/15 hover:bg-github-danger/25',
};
// The colors a review's state takes, or undefined on a --no-lgtm server for one not withdrawn.
const stateColor = (review: ApprovalRequest, approvals: boolean) =>
  review.withdrawal ? WITHDRAWN_COLOR : approvals ? verdictColor(review.approval) : undefined;

// The open tab overlaps the bar's bottom border and shares the secondary background of the
// file list and the Change summary below it, so it reads as attached to the review. Its top
// border takes its state's color.
const openTabClasses = (review: ApprovalRequest, approvals: boolean) =>
  `border-github-border border-t-2 ${stateColor(review, approvals)?.topBorder ?? 'border-t-github-accent'} border-b-github-bg-secondary bg-github-bg-secondary font-semibold text-github-text-primary`;

const verdictKind = ({ approval: { verdict }, withdrawal }: ApprovalRequest) =>
  withdrawal ? 'withdrawn' : verdict === 'approve' ? 'approved' : (verdict ?? 'needs-verdict');

const VERDICT_SEGMENTS = [
  ['approved', 'bg-github-accent', (count: number) => `${count} approved`],
  ['reject', 'bg-verdict-reject', (count: number) => `${count} rejected`],
  [
    'needs-verdict',
    'bg-github-text-muted',
    (count: number) => `${count} ${count === 1 ? 'needs' : 'need'} a verdict`,
  ],
  ['withdrawn', 'bg-github-danger', (count: number) => `${count} withdrawn`],
] as const;

function ApprovalMark({ review }: { review: ApprovalRequest }) {
  const { approval } = review;
  const { text } = verdictColor(approval);
  return review.withdrawal ? (
    <X
      size={12}
      aria-hidden="true"
      data-withdrawn
      className={`verdict-mark shrink-0 ${WITHDRAWN_COLOR.text}`}
    />
  ) : approval.verdict === 'reject' ? (
    <X
      size={12}
      aria-hidden="true"
      data-verdict="reject"
      className={`verdict-mark shrink-0 ${text}`}
    />
  ) : approval.verdict === 'approve' ? (
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

// App replaces the page with a loading message between reviews, which unmounts the bar, so
// the tab row's position is kept outside it.
let tabRowScrollLeft = 0;

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
  const tintOf = (review: ApprovalRequest) => stateColor(review, approvals)?.tint;
  // Two identically animated classes: switching between them restarts the animation.
  const pulseClass = (review: ApprovalRequest) =>
    approvals && pulse > 0 && needsVerdict(review) ? ` verdict-pulse-${pulse % 2}` : '';
  const tabRowRef = useRef<HTMLUListElement>(null);
  const open = reviews.find((review) => diffSelectionsEqual(review.selection, current));
  const openIndex = open ? reviews.indexOf(open) : -1;

  // As in a browser's tab strip, an open tab already in view stays put, so a click never moves
  // the tab under the pointer. One out of view scrolls in with the review before it at the
  // left edge, if both fit, and the later reviews filling the row to its right.
  useLayoutEffect(() => {
    const row = tabRowRef.current;
    if (!row || openIndex < 0) return;
    row.scrollLeft = tabRowScrollLeft;
    const tabAt = (index: number) => row.children[index] as HTMLElement;
    const tab = tabAt(openIndex);
    const inView =
      tab.offsetLeft >= row.scrollLeft &&
      tab.offsetLeft + tab.offsetWidth <= row.scrollLeft + row.clientWidth;
    if (inView) return;
    const prior = tabAt(Math.max(openIndex - 1, 0));
    const bothFit = tab.offsetLeft + tab.offsetWidth - prior.offsetLeft <= row.clientWidth;
    row.scrollLeft = (bothFit ? prior : tab).offsetLeft;
  }, [openIndex]);

  // While a review asks for approval the revision picker is gone, so the bar is the only way
  // to reach a review that isn't open.
  if (reviews.length === 0 || (reviews.length === 1 && open)) return null;

  const segments = approvals
    ? VERDICT_SEGMENTS.flatMap(([kind, color, describe]) => {
        const count = reviews.filter((review) => verdictKind(review) === kind).length;
        return count > 0 ? [{ kind, color, count, summary: describe(count) }] : [];
      })
    : [];
  const verdictSummary = segments.map(({ summary }) => summary).join(', ');

  return (
    <nav
      aria-label="Reviews on this server"
      className="review-toolbar relative flex shrink-0 items-end gap-x-0.5 border-b border-github-border bg-github-bg-tertiary px-3 pt-1.5 text-xs text-github-text-primary"
    >
      {/* The explicit role keeps the list semantics that Safari drops with list-style: none.
          Vertical wheel movement reaches the row because no ancestor scrolls vertically.
          `relative` makes each tab's offsetLeft measure from this row. */}
      <ul
        ref={tabRowRef}
        role="list"
        onScroll={(event) => {
          tabRowScrollLeft = event.currentTarget.scrollLeft;
        }}
        onWheel={(event) => {
          event.currentTarget.scrollLeft += event.deltaY;
        }}
        className="relative -mb-px flex min-w-0 flex-1 items-end gap-x-0.5 overflow-x-auto overflow-y-hidden [scrollbar-width:none]"
      >
        {reviews.map((review) => {
          const isOpen = review === open;
          const state = stateLabel(review, approvals);
          const unread = hasUnread(review);
          const tint = tintOf(review);
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
                title={[review.title, state, review.withdrawal?.reason, unread && 'Unread replies']
                  .filter(Boolean)
                  .join('\n')}
                onClick={() => onSelect(review.selection)}
                className={`${tabClasses} ${isOpen ? openTabClasses(review, approvals) : `border-transparent text-github-text-secondary hover:text-github-text-primary ${tint ?? 'hover:bg-github-bg-secondary'}`}${pulseClass(review)}`}
              >
                {state && <ApprovalMark review={review} />}
                <span className={review.withdrawal ? 'line-through' : undefined}>
                  {review.name}
                </span>
                {unread && <UnreadDot />}
              </button>
            </li>
          );
        })}
      </ul>
      <HeaderMenu
        title={verdictSummary}
        // Tabs can be scrolled out of view, so this pulses for any review without a verdict.
        // Filled with the header's background, so it matches the header's buttons on this bar.
        className={`relative mb-1 ml-2 overflow-hidden whitespace-nowrap bg-github-bg-secondary ${headerButtonClasses}${reviews.map(pulseClass).find(Boolean) ?? ''}`}
        label={
          <>
            <span className="max-sm:sr-only">All reviews</span>
            {verdictSummary && <span className="sr-only">{verdictSummary}</span>}
            <ChevronDown size={12} aria-hidden="true" className="shrink-0" />
            {segments.length > 0 && (
              <span aria-hidden="true" className="absolute inset-x-0 bottom-0 flex h-[3px]">
                {segments.map(({ kind, color, count }) => (
                  <span
                    key={kind}
                    data-verdict-segment
                    className={color}
                    style={{ flexGrow: count }}
                  />
                ))}
              </span>
            )}
          </>
        }
      >
        <ol className="-m-3 divide-y divide-github-border">
          {reviews.map((review) => {
            const isOpen = review === open;
            const tint = tintOf(review);
            const state = stateLabel(review, approvals);
            return (
              <li key={getDiffSelectionKey(review.selection)}>
                <button
                  type="button"
                  data-close-menu
                  aria-current={isOpen ? 'page' : undefined}
                  onClick={() => onSelect(review.selection)}
                  className={`flex w-full items-start gap-2 px-3 py-2 text-left text-xs ${tint ?? `hover:bg-github-bg-tertiary${isOpen ? ' bg-github-bg-tertiary' : ''}`} ${isOpen ? 'border-l-4 border-l-github-accent pl-2' : ''}`}
                >
                  {state && (
                    <span className="pt-0.5">
                      <ApprovalMark review={review} />
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span
                        className={`block break-all font-semibold${review.withdrawal ? ' line-through' : ''}`}
                      >
                        {review.name}
                      </span>
                      {hasUnread(review) && <UnreadDot />}
                    </span>
                    {review.title && (
                      <span className="block truncate text-github-text-secondary">
                        {review.title}
                      </span>
                    )}
                    {state && <span className="block text-github-text-muted">{state}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </HeaderMenu>
    </nav>
  );
}
