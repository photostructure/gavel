import { ChevronDown, ChevronRight, FilePenLine } from 'lucide-react';
import { useId, useState } from 'react';

import type { useReviewSummary } from '../hooks/useReviewSummary';

interface Props {
  summary: ReturnType<typeof useReviewSummary>;
  committed?: boolean;
}

// One setting for every review: App remounts the panel per review, and a reviewer
// stepping through a stack wants it to stay the way they left it.
const EXPANDED_KEY = 'gavel-change-summary-expanded';

export function ReviewSummaryPanel({ summary, committed = false }: Props) {
  const [expanded, setExpandedState] = useState(() => localStorage.getItem(EXPANDED_KEY) === '1');
  const setExpanded = (next: boolean) => {
    if (next) localStorage.setItem(EXPANDED_KEY, '1');
    else localStorage.removeItem(EXPANDED_KEY);
    setExpandedState(next);
  };
  const id = useId();
  const subject = summary.draft.commitMessage.split('\n')[0];

  return (
    <section className="flex min-h-0 flex-col border-b border-github-border bg-github-bg-secondary">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={`${id}-fields`}
        onClick={() => setExpanded(!expanded)}
        className="flex w-full min-w-0 shrink-0 items-center gap-2 px-4 py-2 text-left text-xs text-github-text-secondary hover:bg-github-bg-tertiary focus-visible:outline-2 focus-visible:outline-github-accent"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <FilePenLine size={14} className="shrink-0" />
        <span className="flex min-w-0 items-baseline gap-2 text-sm leading-5">
          <span className="ui-label shrink-0 font-medium">Change summary</span>
          {subject && <span className="ui-value min-w-0 truncate font-mono">{subject}</span>}
        </span>
        {summary.dirty && <span className="ml-auto shrink-0">Unsaved</span>}
      </button>
      {expanded && (
        <form
          id={`${id}-fields`}
          className="min-h-0 max-h-[70dvh] overflow-y-auto px-4 pb-3"
          onSubmit={(event) => {
            event.preventDefault();
            void summary.save();
          }}
        >
          <div className="grid min-w-0 gap-3 md:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-1 text-xs">
              <span className="ui-heading">Why this change</span>
              <textarea
                value={summary.draft.rationale}
                onChange={(event) => summary.updateDraft({ rationale: event.target.value })}
                placeholder="What problem does this change solve?"
                rows={3}
                maxLength={4000}
                disabled={!summary.ready || summary.saving}
                className="w-full min-w-0 grow resize-y rounded border border-github-border bg-github-bg-primary px-2 py-1.5 text-sm text-github-text-primary focus:border-github-accent focus:outline-none disabled:opacity-50"
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-xs">
              <span className="ui-heading">
                {committed ? 'Commit message' : 'Proposed commit message'}
              </span>
              <textarea
                value={summary.draft.commitMessage}
                onChange={(event) => summary.updateDraft({ commitMessage: event.target.value })}
                placeholder="feat: describe the change"
                rows={10}
                maxLength={16000}
                disabled={!summary.ready || summary.saving}
                className="w-full min-w-0 grow resize-y rounded border border-github-border bg-github-bg-primary px-2 py-1.5 font-mono text-sm text-github-text-primary focus:border-github-accent focus:outline-none disabled:opacity-50"
              />
            </label>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-github-text-secondary">
            <button
              type="submit"
              disabled={!summary.ready || !summary.dirty || summary.saving || summary.conflict}
              className="rounded border border-github-border bg-github-bg-primary px-3 py-1.5 text-github-text-primary hover:bg-github-bg-tertiary disabled:opacity-50"
            >
              {summary.saving ? 'Saving…' : 'Save summary'}
            </button>
            {(summary.dirty || summary.conflict) && (
              <button
                type="button"
                onClick={summary.discard}
                disabled={summary.saving}
                className="underline hover:text-github-text-primary"
              >
                {summary.conflict ? 'Discard draft and load latest' : 'Discard draft'}
              </button>
            )}
            {!summary.dirty && summary.ready && <span>Saved for this review</span>}
            {summary.dirty && <span>Saving changes clears LGTM approval.</span>}
            {!summary.ready && !summary.error && <span>Loading…</span>}
            {summary.conflict && !summary.error && (
              <span role="status">A newer summary is available. Your draft is still here.</span>
            )}
            {summary.error && <span role="alert">{summary.error}</span>}
            {summary.error && !summary.ready && (
              <button type="button" onClick={() => void summary.refresh()} className="underline">
                Retry
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
