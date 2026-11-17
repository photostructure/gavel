import { useId, useRef, useState, type CSSProperties, type PointerEvent } from 'react';

import type { useReviewSummary } from '../hooks/useReviewSummary';
import { readClientSettings, saveClientSettings } from '../services/userSettings';

import { CommentBodyRenderer } from './CommentBodyRenderer';

const FIELD_CLASS =
  'min-w-0 grow rounded border border-github-border bg-github-bg-primary px-2 py-1.5 text-sm';
const EMPTY_CLASS = 'font-sans text-github-text-secondary italic';
// The rationale column's md:min-w-[192px] class holds the same width.
const RATIONALE_MIN_WIDTH_PX = 192;
const MESSAGE_MIN_WIDTH_PX = 160;
const MESSAGE_WIDTH_SETTING = 'summaryMessageWidth';

// The width from the last drag, as a CSS length, or undefined for the 80ch default.
const readSavedMessageWidth = (): string | undefined => {
  const width = readClientSettings()[MESSAGE_WIDTH_SETTING];
  return typeof width === 'number' && Number.isFinite(width) ? `${width}px` : undefined;
};

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
  const rationaleRef = useRef<HTMLDivElement>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; width: number; max: number } | null>(null);
  const [messageWidth, setMessageWidth] = useState(readSavedMessageWidth);

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    // Both columns render whenever the separator does.
    const width = (messageRef.current as HTMLDivElement).getBoundingClientRect().width;
    const spare =
      (rationaleRef.current as HTMLDivElement).getBoundingClientRect().width -
      RATIONALE_MIN_WIDTH_PX;
    dragRef.current = { x: event.clientX, width, max: width + spare };
  };
  const drag = (event: PointerEvent<HTMLDivElement>) => {
    const start = dragRef.current;
    if (!start) return;
    // The separator sits left of the message, so moving left widens it.
    const width = start.width + start.x - event.clientX;
    const clamped = Math.min(start.max, Math.max(MESSAGE_MIN_WIDTH_PX, width));
    setMessageWidth(`${clamped}px`);
    saveClientSettings({ [MESSAGE_WIDTH_SETTING]: clamped });
  };
  const endDrag = () => {
    dragRef.current = null;
  };

  return (
    <section
      aria-label="Change summary"
      // useTopVisibleFile finds the summary among the diff's files by this attribute.
      data-review-summary=""
      className="border-b border-github-border bg-github-bg-secondary px-4 py-3"
    >
      <div className="flex min-w-0 flex-col gap-3 md:flex-row md:gap-0">
        <div
          ref={rationaleRef}
          className="flex min-w-0 flex-col gap-1 text-xs md:min-w-[192px] md:flex-1"
        >
          <span id={`${id}-why`} className="text-sm ui-heading">
            Why this change
          </span>
          <div role="group" aria-labelledby={`${id}-why`} className={FIELD_CLASS}>
            {summary.rationale.trim() ? (
              // At 1rem the proportional rationale reads as large as the text-sm monospace beside it.
              <CommentBodyRenderer body={summary.rationale} textSizeClass="text-base" />
            ) : (
              <span className={EMPTY_CLASS}>No rationale yet</span>
            )}
          </div>
        </div>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the commit message"
          title="Drag to resize the commit message"
          className="group hidden w-3 shrink-0 cursor-col-resize touch-none justify-center md:flex"
          onPointerDown={startDrag}
          onPointerMove={drag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {/* As wide as the file sidebar's 4px resize bar. */}
          <div className="w-[4px] group-hover:bg-github-text-muted" />
        </div>
        {/* 80ch is 80 characters of this column's own font, so the column sets the message's
            monospace font; the label and the placeholder set sans back. Only the md: class reads
            the dragged width, so the stacked layout below md keeps its content height. */}
        <div
          ref={messageRef}
          className="flex min-w-0 flex-col gap-1 font-mono text-sm md:basis-[var(--message-width,calc(80ch+1rem+2px))]"
          style={{ '--message-width': messageWidth } as CSSProperties}
        >
          <span id={`${id}-message`} className="font-sans text-sm ui-heading">
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
