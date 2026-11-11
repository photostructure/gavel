import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CommentLinkContext } from '../contexts/CommentLinkContext';
import type { useReviewSummary } from '../hooks/useReviewSummary';

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
