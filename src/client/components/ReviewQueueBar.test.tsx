import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReviewApproval } from '../../types/conversation';
import { createDiffSelection, getDiffSelectionKey } from '../../utils/diffSelection';

import { headerButtonClasses } from './HeaderMenu';
import { ReviewQueueBar, type ApprovalRequest } from './ReviewQueueBar';

const request = (name: string, approval: ReviewApproval = {}): ApprovalRequest => ({
  selection: createDiffSelection('base', '.', undefined, name),
  name,
  title: `fix: ${name}`,
  approval,
});
const asIs: ReviewApproval = { verdict: 'as-is' };
const reviews = [request('parser'), request('tests'), request('docs')];

const bar = () => screen.getByRole('navigation', { name: 'Reviews on this server' });
const allReviews = (name: string) => within(bar()).getByRole('button', { name });

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
    fireEvent.click(within(bar()).getByRole('button', { name: 'parser, Needs a verdict' }));
    expect(onSelect).toHaveBeenCalledWith(reviews[0]!.selection);
  });

  it('marks only the tabs of reviews with unread replies', () => {
    render(
      <ReviewQueueBar
        reviews={reviews}
        current={reviews[0]!.selection}
        approvals
        unreadReviews={new Set([getDiffSelectionKey(reviews[2]!.selection)])}
        onSelect={vi.fn()}
      />,
    );
    expect(
      within(bar()).getByRole('button', { name: 'docs, Needs a verdict, unread replies' }),
    ).toBeVisible();
    expect(within(bar()).getByRole('button', { name: 'tests, Needs a verdict' })).toBeVisible();
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
    const buttons = within(within(bar()).getByRole('list')).getAllByRole('button');
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
      request('tests', { verdict: 'after-comments' }),
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
    expect(screen.getByRole('button', { name: 'tests, Approved after comments' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'docs, Needs a verdict' })).toHaveAttribute(
      'title',
      'fix: docs\nNeeds a verdict',
    );
  });

  it('pulses only the tabs of reviews without a verdict, replaying on each new pulse', () => {
    const queue = [
      request('parser', asIs),
      request('tests', { verdict: 'reject' }),
      request('docs'),
    ];
    const props = { reviews: queue, current: queue[0]!.selection, approvals: true };
    const { rerender } = render(<ReviewQueueBar {...props} pulse={0} onSelect={vi.fn()} />);
    const docs = screen.getByRole('button', { name: 'docs, Needs a verdict' });
    expect(docs.className).not.toMatch(/verdict-pulse/);

    rerender(<ReviewQueueBar {...props} pulse={1} onSelect={vi.fn()} />);
    expect(docs).toHaveClass('verdict-pulse-1');
    expect(screen.getByRole('button', { name: 'tests, Rejected' }).className).not.toMatch(
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

  // The same hue as the chosen verdict button: green as-is, yellow after comments, violet reject.
  it('colors each tab mark, and the open tab, like its verdict button', () => {
    const afterComments: ReviewApproval = { verdict: 'after-comments' };
    const queue = [
      request('parser', asIs),
      request('tests', afterComments),
      request('docs', { verdict: 'reject' }),
      request('none'),
      request('addressed', afterComments),
    ];
    const mark = (name: string) =>
      screen.getByRole('button', { name: new RegExp(`^${name},`) }).querySelector('svg');
    const { rerender } = render(
      <ReviewQueueBar reviews={queue} current={queue[1]!.selection} approvals onSelect={vi.fn()} />,
    );
    expect(mark('parser')).toHaveClass('text-github-accent');
    expect(mark('tests')).toHaveClass('text-verdict-after-comments', 'lucide-message-square-more');
    // The dark-theme brightness filter turns #fdc700 into #fff900, off the button's yellow:
    // node -e 'console.log([253, 199, 0].map((v) => Math.min(255, Math.round(v * 1.25))))'
    expect(mark('tests')).not.toHaveClass('verdict-mark');
    expect(mark('addressed')).toHaveClass(
      'text-verdict-after-comments',
      'lucide-message-square-more',
    );
    expect(mark('docs')).toHaveClass('text-verdict-reject');
    expect(mark('none')).toHaveClass('text-github-text-muted');
    const open = () => screen.getByRole('button', { current: 'page' });
    expect(open()).toHaveClass('border-t-verdict-after-comments');
    for (const [index, border] of [
      [0, 'border-t-github-accent'],
      [2, 'border-t-verdict-reject'],
      // No verdict yet: neutral, since green would read as approval.
      [3, 'border-t-github-text-secondary'],
      [4, 'border-t-verdict-after-comments'],
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

  it('counts reject as a verdict and marks it with an X', () => {
    const queue = [
      request('parser', asIs),
      request('tests', { verdict: 'reject' }),
      request('docs'),
    ];
    render(
      <ReviewQueueBar reviews={queue} current={queue[0]!.selection} approvals onSelect={vi.fn()} />,
    );
    expect(allReviews('All reviews 1 approved, 1 rejected, 1 needs a verdict')).toBeVisible();
    const tests = screen.getByRole('button', { name: 'tests, Rejected' });
    expect(tests.querySelector('[data-verdict="reject"]')).not.toBeNull();
    expect(bar().querySelector('[data-verdict-segment].bg-verdict-reject')).not.toBeNull();
  });

  it('draws a bar segment for each verdict some review has, sized by its count', () => {
    const pending: ReviewApproval = { verdict: 'after-comments' };
    const queue = [request('parser', asIs), request('tests', pending), request('docs')];
    const segments = () =>
      Array.from(
        within(bar())
          .getByRole('button', { name: /^All reviews/ })
          .querySelectorAll<HTMLElement>('[data-verdict-segment]'),
      );
    const { rerender } = render(
      <ReviewQueueBar reviews={queue} current={queue[0]!.selection} approvals onSelect={vi.fn()} />,
    );
    const summary = 'All reviews 1 approved, 1 approved after comments, 1 needs a verdict';
    expect(allReviews(summary)).toHaveAttribute(
      'title',
      '1 approved, 1 approved after comments, 1 needs a verdict',
    );
    expect(segments().map((segment) => segment.style.flexGrow)).toEqual(['1', '1', '1']);
    expect(segments()[0]).toHaveClass('bg-github-accent');
    expect(segments()[1]).toHaveClass('bg-verdict-after-comments');
    expect(segments()[2]).toHaveClass('bg-github-text-muted');

    const done = [request('parser', asIs), request('tests', asIs)];
    rerender(
      <ReviewQueueBar reviews={done} current={done[0]!.selection} approvals onSelect={vi.fn()} />,
    );
    expect(allReviews('All reviews 2 approved')).toBeVisible();
    expect(segments().map((segment) => segment.style.flexGrow)).toEqual(['2']);

    rerender(
      <ReviewQueueBar
        reviews={queue}
        current={queue[0]!.selection}
        approvals={false}
        onSelect={vi.fn()}
      />,
    );
    expect(allReviews('All reviews')).toBeVisible();
    expect(segments()).toEqual([]);
  });

  it('starts the bar with the tabs, now the count is on the button', () => {
    render(
      <ReviewQueueBar
        reviews={reviews}
        current={reviews[0]!.selection}
        approvals
        onSelect={vi.fn()}
      />,
    );
    expect(bar().firstElementChild).toBe(within(bar()).getByRole('list'));
  });

  it('keeps every tab on one row that scrolls sideways', () => {
    render(
      <ReviewQueueBar
        reviews={reviews}
        current={reviews[0]!.selection}
        approvals
        onSelect={vi.fn()}
      />,
    );
    expect(bar()).not.toHaveClass('flex-wrap');
    expect(within(bar()).getByRole('list')).toHaveClass('overflow-x-auto');
  });

  it('always offers a menu listing every review', () => {
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
    fireEvent.click(within(bar()).getByRole('button', { name: /^All reviews/ }));
    const items = within(screen.getByRole('dialog')).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('parser');
    expect(items[0]).toHaveTextContent('fix: parser');
    expect(items[0]).toHaveTextContent('Approved as-is');
    expect(within(items[1]!).getByRole('button')).toHaveAttribute('aria-current', 'page');
    expect(items[2]).toHaveTextContent('Needs a verdict');

    fireEvent.click(within(items[2]!).getByRole('button'));
    expect(onSelect).toHaveBeenCalledWith(listed[2]!.selection);
  });

  it('draws All reviews as a button rather than a tab, with no unread mark', () => {
    render(
      <ReviewQueueBar
        reviews={reviews}
        current={reviews[0]!.selection}
        approvals
        unreadReviews={new Set([getDiffSelectionKey(reviews[2]!.selection)])}
        onSelect={vi.fn()}
      />,
    );
    const button = allReviews('All reviews 3 need a verdict');
    expect(button).toHaveClass(...headerButtonClasses.split(' '));
    expect(button).not.toHaveClass('rounded-t-md');
    expect(button).toHaveClass('relative', 'overflow-hidden');
  });

  describe('scrolling the tab row', () => {
    const queue = ['a', 'b', 'c', 'd', 'e'].map((name) => request(name));
    const renderAt = (index: number) => (
      <ReviewQueueBar
        reviews={queue}
        current={queue[index]!.selection}
        approvals
        onSelect={vi.fn()}
      />
    );
    const tabRow = () => within(bar()).getByRole('list');

    // happy-dom does no layout, so stand in for five 100px tabs in a 250px row.
    beforeEach(() => {
      vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (
        this: HTMLElement,
      ) {
        return Array.from(this.parentElement?.children ?? []).indexOf(this) * 100;
      });
      vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100);
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(250);
    });
    afterEach(() => vi.restoreAllMocks());

    it('puts the review before an out-of-view open tab at the left edge', () => {
      render(renderAt(3));
      expect(tabRow().scrollLeft).toBe(200);
    });

    it('puts the open tab at the left edge when the review before it would not fit', () => {
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(150);
      render(renderAt(3));
      expect(tabRow().scrollLeft).toBe(300);
    });

    describe('from a scrolled position', () => {
      const scrollRowTo = (left: number) => {
        tabRow().scrollLeft = left;
        fireEvent.scroll(tabRow());
      };
      // The row's position outlives the bar, so return it to the start for the next test.
      afterEach(() => scrollRowTo(0));

      it('scrolls back to the start for the first review', () => {
        const { rerender } = render(renderAt(3));
        scrollRowTo(200);
        rerender(renderAt(0));
        expect(tabRow().scrollLeft).toBe(0);
      });

      it('leaves the row where it is when the open tab is already in view', () => {
        const { rerender } = render(renderAt(0));
        scrollRowTo(37);
        rerender(renderAt(1));
        expect(tabRow().scrollLeft).toBe(37);
      });

      // The app replaces the page with a loading message between reviews, unmounting the bar.
      it('keeps its position when the bar remounts for the next review', () => {
        const { unmount } = render(renderAt(0));
        scrollRowTo(150);
        unmount();

        render(renderAt(2));
        expect(tabRow().scrollLeft).toBe(150);
      });
    });

    it('scrolls sideways with the mouse wheel', () => {
      render(renderAt(0));
      fireEvent.wheel(tabRow(), { deltaY: 120 });
      expect(tabRow().scrollLeft).toBe(120);
    });
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
