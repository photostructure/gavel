import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CommentLinkContext } from '../contexts/CommentLinkContext';
import type { useReviewSummary } from '../hooks/useReviewSummary';
import {
  readClientSettings,
  resetClientSettingsForTests,
  saveClientSettings,
} from '../services/userSettings';

import { ReviewSummaryPanel } from './ReviewSummaryPanel';

type Summary = ReturnType<typeof useReviewSummary>;

const summary = (overrides: Partial<Summary> = {}): Summary => ({
  commitMessage: 'feat: add links\n\nLink comments to each other.',
  rationale: 'Start here: [the parser](#thread=tour-1).',
  version: 1,
  ready: true,
  error: null,
  refresh: vi.fn(async () => {}),
  ...overrides,
});

const follow = vi.fn();
const renderPanel = (value: Summary, committed = false) =>
  render(
    <CommentLinkContext.Provider value={follow}>
      <ReviewSummaryPanel summary={value} committed={committed} />
    </CommentLinkContext.Provider>,
  );

describe('ReviewSummaryPanel', () => {
  beforeEach(() => {
    follow.mockClear();
    resetClientSettingsForTests();
  });

  it('shows when and why the agent withdrew the review, above the proposal', () => {
    const at = '2026-11-21T12:00:00.000Z';
    render(
      <CommentLinkContext.Provider value={follow}>
        <ReviewSummaryPanel
          summary={summary()}
          withdrawal={{ at, reason: 'Superseded by [tests](?review=tests).' }}
        />
      </CommentLinkContext.Provider>,
    );
    const notice = screen.getByRole('note', { name: 'Withdrawn' });
    expect(notice).toHaveTextContent(
      `The agent withdrew this review on ${new Date(at).toLocaleString()}.`,
    );
    expect(notice).toHaveTextContent('Superseded by tests.');
    expect(
      notice.compareDocumentPosition(screen.getByRole('group', { name: 'Why this change' })),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    fireEvent.click(screen.getByRole('link', { name: 'tests' }));
    expect(follow).toHaveBeenCalled();
  });

  it('shows no withdrawal notice for a review that was not withdrawn', () => {
    renderPanel(summary());
    expect(screen.queryByRole('note', { name: 'Withdrawn' })).toBeNull();
  });

  it('shows the rationale as Markdown whose links the router follows', () => {
    renderPanel(summary());
    expect(screen.getByRole('group', { name: 'Why this change' })).toHaveTextContent(
      'Start here: the parser.',
    );
    fireEvent.click(screen.getByRole('link', { name: 'the parser' }));
    // No thread holds the rationale, so Back returns to wherever the reader was.
    expect(follow).toHaveBeenCalledWith('#thread=tour-1', undefined);
  });

  it('shows the proposed commit message as text', () => {
    renderPanel(summary());
    expect(screen.getByRole('group', { name: 'Proposed commit message' }).textContent).toBe(
      'feat: add links\n\nLink comments to each other.',
    );
  });

  it('labels a committed comparison’s message as the commit message', () => {
    renderPanel(summary(), true);
    expect(screen.getByRole('group', { name: 'Commit message' })).toBeInTheDocument();
  });

  it('offers no way to edit or save either field', () => {
    renderPanel(summary());
    expect(screen.queryByRole('textbox')).toBeNull();
    // It always shows both fields, so it has no toggle either.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('sizes the fields to their content, with no height cap or scroll box of its own', () => {
    const { container } = renderPanel(summary());
    // The diff's scroll area scrolls the summary; a capped box inside it would be a second
    // scroll region, which is hard to scroll on phones.
    for (const element of container.querySelectorAll('*')) {
      expect(element.getAttribute('class') ?? '').not.toMatch(
        /max-h-|overflow-y-auto|overflow-auto/,
      );
    }
  });

  it('sizes the commit message column for 80 monospace characters until it is dragged', () => {
    renderPanel(summary());
    const column = screen.getByRole('group', { name: 'Proposed commit message' }).parentElement!;
    // ch is the width of the column's own font, so the column sets the message's mono font.
    expect(column).toHaveClass(
      'font-mono',
      'text-sm',
      'md:basis-[var(--message-width,calc(80ch+1rem+2px))]',
    );
  });

  it('resizes the commit message column by dragging the separator, within limits', () => {
    renderPanel(summary());
    const rationale = screen.getByRole('group', { name: 'Why this change' }).parentElement!;
    const column = screen.getByRole('group', { name: 'Proposed commit message' }).parentElement!;
    vi.spyOn(rationale, 'getBoundingClientRect').mockReturnValue({ width: 500 } as DOMRect);
    vi.spyOn(column, 'getBoundingClientRect').mockReturnValue({ width: 600 } as DOMRect);
    const separator = screen.getByRole('separator', { name: 'Resize the commit message' });

    // Only the primary button drags; a right-click opens the context menu instead.
    fireEvent.pointerDown(separator, { pointerId: 1, button: 2, clientX: 1000 });
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 900 });
    expect(column.style.getPropertyValue('--message-width')).toBe('');

    fireEvent.pointerDown(separator, { pointerId: 1, button: 0, clientX: 1000 });
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 900 });
    expect(column.style.getPropertyValue('--message-width')).toBe('700px');
    // The rationale keeps its 192px minimum: 600 + (500 - 192).
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 0 });
    expect(column.style.getPropertyValue('--message-width')).toBe('908px');
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 2000 });
    expect(column.style.getPropertyValue('--message-width')).toBe('160px');
    fireEvent.pointerUp(separator, { pointerId: 1, clientX: 2000 });
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 900 });
    expect(column.style.getPropertyValue('--message-width')).toBe('160px');
    // Only the md: class reads the width, so the stacked layout below md ignores it.
    expect(column.style.flexBasis).toBe('');
    expect(readClientSettings()).toEqual({ summaryMessageWidth: 160 });
  });

  it('starts the commit message column at the width saved by an earlier drag', () => {
    saveClientSettings({ summaryMessageWidth: 700 });
    renderPanel(summary());
    const column = screen.getByRole('group', { name: 'Proposed commit message' }).parentElement!;
    expect(column.style.getPropertyValue('--message-width')).toBe('700px');
  });

  it('says when the agent has not proposed a rationale or message yet', () => {
    renderPanel(summary({ commitMessage: '', rationale: '' }));
    expect(screen.getByRole('group', { name: 'Why this change' })).toHaveTextContent(
      'No rationale yet',
    );
    expect(screen.getByRole('group', { name: 'Proposed commit message' })).toHaveTextContent(
      'No proposed commit message yet',
    );
  });

  it('offers Retry when the summary fails to load', () => {
    const refresh = vi.fn(async () => {});
    renderPanel(summary({ ready: false, error: 'Could not load the change summary.', refresh }));
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the change summary.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refresh).toHaveBeenCalled();
  });
});
