import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReviewApproval } from '../../types/conversation';
import { createDiffSelection } from '../../utils/diffSelection';

import { ReviewQueueBar, type ApprovalRequest } from './ReviewQueueBar';

const request = (
  name: string,
  approval: ReviewApproval = { approved: false },
): ApprovalRequest => ({
  selection: createDiffSelection('base', '.', undefined, name),
  name,
  title: `fix: ${name}`,
  approval,
});
const asIs: ReviewApproval = { approved: true, requested: true, mode: 'as-is' };
const reviews = [request('parser'), request('tests'), request('docs')];

const bar = () => screen.getByRole('navigation', { name: 'Reviews on this server' });

describe('review queue bar', () => {
  it('stays hidden while the only review is the open one', () => {
    const { container } = render(
      <ReviewQueueBar
        reviews={[request('parser')]}
        current={reviews[0]!.selection}
        approvals
        onSelect={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a lone review that is not the open one, so it can be reached', () => {
    const onSelect = vi.fn();
    render(
      <ReviewQueueBar
        reviews={[request('parser')]}
        current={createDiffSelection('base', 'staged')}
        approvals
        onSelect={onSelect}
      />,
    );
    expect(bar()).toHaveTextContent(/^1 of 1 need a verdict/);
    fireEvent.click(within(bar()).getByRole('button', { name: 'parser, Needs a verdict' }));
    expect(onSelect).toHaveBeenCalledWith(reviews[0]!.selection);
  });

  it('names every review in creation order, marks the open one, and opens the one clicked', () => {
    const onSelect = vi.fn();
    render(
      <ReviewQueueBar
        reviews={reviews}
        current={reviews[1]!.selection}
        approvals={false}
        onSelect={onSelect}
      />,
    );
    const buttons = within(bar()).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['parser', 'tests', 'docs']);
    expect(buttons[1]).toHaveAttribute('aria-current', 'page');
    expect(buttons[0]).not.toHaveAttribute('aria-current');
    expect(buttons[0]).toHaveAttribute('title', 'fix: parser');

    fireEvent.click(buttons[2]!);
    expect(onSelect).toHaveBeenCalledWith(reviews[2]!.selection);
  });

  it('shows each review approval state next to its name', () => {
    const listed = [
      request('parser', asIs),
      request('tests', {
        approved: false,
        requested: true,
        mode: 'after-comments',
        conditions: [
          { threadId: 't', messageId: 'm', cursor: 'c', intent: 'question' },
          {
            threadId: 't2',
            messageId: 'm2',
            cursor: 'c2',
            intent: 'question',
            addressed: { outcome: 'fixed', evidence: 'done', updatedAt: '2026-11-05T00:00:00Z' },
          },
        ],
      }),
      request('docs'),
    ];
    render(
      <ReviewQueueBar
        reviews={listed}
        current={listed[0]!.selection}
        approvals
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'parser, Approved as-is' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'tests, Approved · 1 pending' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'docs, Needs a verdict' })).toHaveAttribute(
      'title',
      'fix: docs\nNeeds a verdict',
    );
  });

  it('pulses only the tabs of reviews without a verdict, replaying on each new pulse', () => {
    const queue = [
      request('parser', asIs),
      request('tests', { approved: false, notYet: true }),
      request('docs'),
    ];
    const props = { reviews: queue, current: queue[0]!.selection, approvals: true };
    const { rerender } = render(<ReviewQueueBar {...props} pulse={0} onSelect={vi.fn()} />);
    const docs = screen.getByRole('button', { name: 'docs, Needs a verdict' });
    expect(docs.className).not.toMatch(/verdict-pulse/);

    rerender(<ReviewQueueBar {...props} pulse={1} onSelect={vi.fn()} />);
    expect(docs).toHaveClass('verdict-pulse-1');
    expect(screen.getByRole('button', { name: 'tests, Not yet' }).className).not.toMatch(
      /verdict-pulse/,
    );
    expect(screen.getByRole('button', { name: 'parser, Approved as-is' }).className).not.toMatch(
      /verdict-pulse/,
    );

    // A new animation name restarts the animation without remounting the focused tab.
    rerender(<ReviewQueueBar {...props} pulse={2} onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'docs, Needs a verdict' })).toBe(docs);
    expect(docs).toHaveClass('verdict-pulse-0');
  });

  // The same color as the chosen verdict button: green as-is, amber after comments, red not yet.
  it('colors each tab mark, and the open tab, like its verdict button', () => {
    const afterComments: ReviewApproval = {
      approved: false,
      requested: true,
      mode: 'after-comments',
    };
    const queue = [
      request('parser', asIs),
      request('tests', afterComments),
      request('docs', { approved: false, notYet: true }),
      request('none'),
    ];
    const mark = (name: string) =>
      screen.getByRole('button', { name: new RegExp(`^${name},`) }).querySelector('svg');
    const { rerender } = render(
      <ReviewQueueBar reviews={queue} current={queue[1]!.selection} approvals onSelect={vi.fn()} />,
    );
    expect(mark('parser')).toHaveClass('text-github-accent');
    expect(mark('tests')).toHaveClass('text-amber-700');
    expect(mark('docs')).toHaveClass('text-github-danger');
    expect(mark('none')).toHaveClass('text-github-text-muted');
    const open = () => screen.getByRole('button', { current: 'page' });
    expect(open()).toHaveClass('border-t-amber-700');
    for (const [index, border] of [
      [0, 'border-t-github-accent'],
      [2, 'border-t-github-danger'],
      // No verdict yet: neutral, since green would read as approval.
      [3, 'border-t-github-text-secondary'],
    ] as const) {
      rerender(
        <ReviewQueueBar
          reviews={queue}
          current={queue[index]!.selection}
          approvals
          onSelect={vi.fn()}
        />,
      );
      expect(open()).toHaveClass(border);
    }
  });

  it('counts not yet as a verdict and marks it with an X', () => {
    const queue = [
      request('parser', asIs),
      request('tests', { approved: false, notYet: true }),
      request('docs'),
    ];
    render(
      <ReviewQueueBar reviews={queue} current={queue[0]!.selection} approvals onSelect={vi.fn()} />,
    );
    expect(bar()).toHaveTextContent(/^1 of 3 need a verdict/);
    const tests = screen.getByRole('button', { name: 'tests, Not yet' });
    expect(tests.querySelector('[data-verdict="not-yet"]')).not.toBeNull();
  });

  it('counts the reviews that still need a verdict', () => {
    const pending: ReviewApproval = {
      approved: false,
      requested: true,
      mode: 'after-comments',
      conditions: [{ threadId: 't', messageId: 'm', cursor: 'c', intent: 'question' }],
    };
    // An approval after comments with open conditions is the reviewer done.
    const queue = [request('parser', asIs), request('tests', pending), request('docs')];
    const { rerender } = render(
      <ReviewQueueBar reviews={queue} current={queue[0]!.selection} approvals onSelect={vi.fn()} />,
    );
    expect(bar()).toHaveTextContent(/^1 of 3 need a verdict/);

    const done = [request('parser', asIs), request('tests', asIs)];
    rerender(
      <ReviewQueueBar reviews={done} current={done[0]!.selection} approvals onSelect={vi.fn()} />,
    );
    expect(bar()).toHaveTextContent(/^All 2 have a verdict/);

    rerender(
      <ReviewQueueBar
        reviews={queue}
        current={queue[0]!.selection}
        approvals={false}
        onSelect={vi.fn()}
      />,
    );
    expect(bar()).toHaveTextContent(/^3 reviews/);
  });

  it('wraps the names onto more rows instead of hiding any', () => {
    render(
      <ReviewQueueBar
        reviews={reviews}
        current={reviews[0]!.selection}
        approvals
        onSelect={vi.fn()}
      />,
    );
    // The count and the names wrap as one flow, so on a phone the names share the count's row.
    expect(bar()).toHaveClass('flex-wrap');
    const list = within(bar()).getByRole('list');
    expect(list).toHaveClass('contents');
    expect(list).not.toHaveClass('overflow-x-auto');
  });

  describe('when the tabs need more than one row', () => {
    // happy-dom does no layout, so stand in for the browser's measurement of the hidden
    // one-row copy of the tabs: 500px of tabs in a 300px bar.
    beforeEach(() => {
      vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (
        this: Element,
      ) {
        return this.hasAttribute('data-tab-measure') ? 500 : 0;
      });
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
        this: Element,
      ) {
        return this.hasAttribute('data-tab-measure') ? 300 : 0;
      });
    });
    afterEach(() => vi.restoreAllMocks());

    it('shows the open review with a menu of every review instead of the tabs', () => {
      const onSelect = vi.fn();
      const listed = [request('parser', asIs), request('tests'), request('docs')];
      render(
        <ReviewQueueBar
          reviews={listed}
          current={listed[1]!.selection}
          approvals
          onSelect={onSelect}
        />,
      );
      expect(bar()).toHaveTextContent(/^2 of 3 need a verdict/);
      expect(within(bar()).queryByRole('list')).not.toBeInTheDocument();

      fireEvent.click(within(bar()).getByRole('button', { name: 'All reviews, open: tests' }));
      const items = screen.getAllByRole('listitem');
      expect(items).toHaveLength(3);
      expect(items[0]).toHaveTextContent('parser');
      expect(items[0]).toHaveTextContent('fix: parser');
      expect(items[0]).toHaveTextContent('Approved as-is');
      expect(within(items[1]!).getByRole('button')).toHaveAttribute('aria-current', 'page');
      expect(items[2]).toHaveTextContent('Needs a verdict');

      fireEvent.click(within(items[2]!).getByRole('button'));
      expect(onSelect).toHaveBeenCalledWith(listed[2]!.selection);
    });

    it('asks for a choice when the open diff is none of the reviews', () => {
      render(
        <ReviewQueueBar
          reviews={reviews}
          current={createDiffSelection('HEAD^', 'HEAD')}
          approvals
          onSelect={vi.fn()}
        />,
      );
      expect(
        within(bar()).getByRole('button', { name: 'All reviews, open: Choose a review' }),
      ).toBeVisible();
    });
  });

  it('keeps the measured count on one line so it cannot absorb the tabs overflow', () => {
    // In Chrome at 1100px with 8 reviews, a shrinkable count wrapped to two lines in the
    // one-row copy, so scrollWidth matched clientWidth while the real tabs wrapped.
    const { container } = render(
      <ReviewQueueBar
        reviews={reviews}
        current={reviews[0]!.selection}
        approvals
        onSelect={vi.fn()}
      />,
    );
    const measure = container.querySelector('[data-tab-measure]');
    for (const child of Array.from(measure?.children ?? [])) {
      expect(child).toHaveClass('shrink-0', 'whitespace-nowrap');
    }
  });

  it('marks no review as open when the open diff is none of them', () => {
    render(
      <ReviewQueueBar
        reviews={reviews}
        current={createDiffSelection('HEAD^', 'HEAD')}
        approvals
        onSelect={vi.fn()}
      />,
    );
    for (const button of within(bar()).getAllByRole('button')) {
      expect(button).not.toHaveAttribute('aria-current');
    }
  });
});
