import { useId } from 'react';

import type { useReviewSummary } from '../hooks/useReviewSummary';

import { CommentBodyRenderer } from './CommentBodyRenderer';

const FIELD_CLASS =
  'min-w-0 grow rounded border border-github-border bg-github-bg-primary px-2 py-1.5 text-sm';
const EMPTY_CLASS = 'text-github-text-secondary italic';

/**
 * The agent's proposal, read-only. App renders it at the top of the diff's scroll area, so the
 * fields size to their content and scroll away with the diff; it needs no toggle or height cap.
 */
export function ReviewSummaryPanel({
  summary,
  committed = false,
}: {
  summary: ReturnType<typeof useReviewSummary>;
  committed?: boolean;
}) {
  const id = useId();
  const messageLabel = committed ? 'Commit message' : 'Proposed commit message';
  return (
    <section
      aria-label="Change summary"
      className="border-b border-github-border bg-github-bg-secondary px-4 py-3"
    >
      <div className="grid min-w-0 gap-3 md:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1 text-xs">
          <span id={`${id}-why`} className="ui-heading">
            Why this change
          </span>
          <div role="group" aria-labelledby={`${id}-why`} className={FIELD_CLASS}>
            {summary.rationale.trim() ? (
              <CommentBodyRenderer body={summary.rationale} />
            ) : (
              <span className={EMPTY_CLASS}>No rationale yet</span>
            )}
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-1 text-xs">
          <span id={`${id}-message`} className="ui-heading">
            {messageLabel}
          </span>
          <div role="group" aria-labelledby={`${id}-message`} className={FIELD_CLASS}>
            {summary.commitMessage.trim() ? (
              <pre className="whitespace-pre-wrap break-words font-mono text-github-text-primary">
                {summary.commitMessage}
              </pre>
            ) : (
              <span className={EMPTY_CLASS}>No {messageLabel.toLowerCase()} yet</span>
            )}
          </div>
        </div>
      </div>
      {(summary.error || !summary.ready) && (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-github-text-secondary">
          {summary.error ? (
            <>
              <span role="alert">{summary.error}</span>
              <button type="button" onClick={() => void summary.refresh()} className="underline">
                Retry
              </button>
            </>
          ) : (
            <span>Loading…</span>
          )}
        </div>
      )}
    </section>
  );
}
