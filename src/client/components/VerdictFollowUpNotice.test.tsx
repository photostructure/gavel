import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { ClientInboxDelivery } from '../hooks/useInboxDelivery';

import { VerdictFollowUpNotice } from './VerdictFollowUpNotice';

type Props = ComponentProps<typeof VerdictFollowUpNotice>;

describe('verdict follow-up notice', () => {
  const status = () => screen.getByRole('status', { name: 'Next step' });
  const anchor = () => {
    const element = document.createElement('div');
    document.body.appendChild(element);
    return element;
  };
  const notice = (props: Partial<Props> & Pick<Props, 'step'>) => (
    <VerdictFollowUpNotice
      anchor={anchor()}
      verdict="approve"
      delivery={undefined}
      busy={false}
      onDismiss={vi.fn()}
      onProceed={vi.fn()}
      onUndo={vi.fn()}
      {...props}
    />
  );

  it('renders nothing without a step', () => {
    render(notice({ step: null }));
    expect(screen.queryByRole('status', { name: 'Next step' })).not.toBeInTheDocument();
  });

  // A toast's usual anatomy: the message, with its close X in the top-right corner, above the
  // actions, which sit at the right with the primary one last, in the bottom-right corner.
  it('puts the message above its actions, and the close X in the top-right corner', () => {
    render(
      notice({
        step: { kind: 'switch', name: 'task-b', waiting: 1 },
        delivery: { status: 'pending' },
      }),
    );
    const message = screen.getByTestId('verdict-toast-detail');
    const next = screen.getByRole('button', { name: 'Switch to task-b' });
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    expect(message).toHaveTextContent(/^Approved\. Sending to the agent…$/);
    expect(message.nextElementSibling).toContainElement(next);
    expect(message).not.toContainElement(next);
    expect(next.parentElement).toHaveClass('justify-end', 'gap-3');
    expect(next.nextElementSibling).toBeNull();
    // The X gets a padded hit area. Only the message keeps clear of it, so the buttons reach the
    // toast's right padding, which matches its left: the primary button sat 43 px in from the
    // right edge when the whole toast had pr-12.
    expect(dismiss).toHaveClass('absolute', 'top-1.5', 'right-1.5', 'p-1');
    expect(status()).toHaveClass('pr-4', 'pl-4', 'gap-4');
    expect(message).toHaveClass('pr-8');
    expect(next.parentElement?.nextElementSibling).toBe(dismiss);
  });

  it('names the verdict, then offers Undo, the next review, and Dismiss in that order', () => {
    const onDismiss = vi.fn();
    const onProceed = vi.fn();
    const onUndo = vi.fn();
    render(
      notice({
        step: { kind: 'switch', name: 'task-b', waiting: 1 },
        onDismiss,
        onProceed,
        onUndo,
      }),
    );
    const next = screen.getByRole('button', { name: 'Switch to task-b' });
    const undo = screen.getByRole('button', { name: 'Undo' });
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    expect(screen.getByTestId('verdict-toast-detail')).toHaveTextContent(/^Approved\./);
    expect(next.previousElementSibling).toBe(undo);
    expect(next.compareDocumentPosition(dismiss) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(next);
    expect(onProceed).toHaveBeenCalledOnce();
    fireEvent.click(undo);
    expect(onUndo).toHaveBeenCalledOnce();
    fireEvent.click(dismiss);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  // The button keeps its text on one line, like the verdict buttons, so a long name must shrink
  // instead of pushing the button past the toast on a narrow screen.
  it('truncates a long review name inside its button and names it in full in a title', () => {
    render(notice({ step: { kind: 'switch', name: 'fix-useReviewOps-random-uuid', waiting: 1 } }));
    const next = screen.getByRole('button', { name: 'Switch to fix-useReviewOps-random-uuid' });
    expect(next).toHaveClass('min-w-0', 'max-w-full');
    expect(next).toHaveAttribute('title', 'Switch to fix-useReviewOps-random-uuid');
    expect(next.querySelector('code')).toHaveClass('min-w-0', 'truncate');
  });

  // A verdict saving or a capture reloading ignores the click, as it does on the verdict buttons.
  it('disables Undo while the verdict buttons are busy', () => {
    render(notice({ step: { kind: 'switch', name: 'task-b', waiting: 1 }, busy: true }));
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  it('names a Reject', () => {
    render(notice({ step: { kind: 'switch', name: 'task-b', waiting: 1 }, verdict: 'reject' }));
    expect(status()).toHaveTextContent('Rejected');
  });

  it('offers Close tab once every review has a verdict', () => {
    const onProceed = vi.fn();
    const { rerender } = render(notice({ step: { kind: 'close', reviews: 3 }, onProceed }));
    expect(status()).toHaveTextContent('Approved');
    expect(status()).toHaveTextContent('All 3 reviews have a verdict, so you can close this tab.');
    fireEvent.click(screen.getByRole('button', { name: 'Close tab' }));
    expect(onProceed).toHaveBeenCalledOnce();
    rerender(notice({ step: { kind: 'close', reviews: 1 } }));
    expect(status()).toHaveTextContent('You can close this tab.');
    expect(status()).not.toHaveTextContent('reviews have a verdict');
  });

  describe('delivery to the agent', () => {
    const line = () => screen.getByTestId('verdict-toast-detail');
    const sent: ClientInboxDelivery = {
      status: 'sent',
      at: '2026-11-12T17:00:00.000Z',
      via: 'inbox',
    };

    // A closed tab cannot show a failed send, which needs the resume prompt.
    it('says the verdict is being sent, and holds Close tab until it is', () => {
      const step = { kind: 'close', reviews: 1 } as const;
      const { rerender } = render(notice({ step, delivery: { status: 'pending' } }));
      expect(line()).toHaveTextContent(/^Approved\. Sending to the agent…$/);
      expect(line().querySelector('[data-delivery-state]')).toHaveAttribute(
        'data-delivery-state',
        'delivering',
      );
      expect(screen.getByRole('button', { name: 'Close tab' })).toBeDisabled();
      rerender(notice({ step, delivery: sent }));
      expect(line()).toHaveTextContent(/^Approved\. Sent to the agent\. You can close this tab\.$/);
      expect(line().querySelector('[data-delivery-state]')).toHaveAttribute(
        'data-delivery-state',
        'delivered',
      );
      expect(screen.getByRole('button', { name: 'Close tab' })).toBeEnabled();
    });

    // Switching reviews keeps the page, so it never waits for the send.
    it('offers the next review while sending, then names it and counts the rest', () => {
      const { rerender } = render(
        notice({
          step: { kind: 'switch', name: 'task-b', waiting: 1 },
          delivery: { status: 'pending' },
        }),
      );
      expect(line()).toHaveTextContent(/^Approved\. Sending to the agent…$/);
      expect(screen.getByRole('button', { name: 'Switch to task-b' })).toBeEnabled();
      rerender(notice({ step: { kind: 'switch', name: 'task-b', waiting: 1 }, delivery: sent }));
      expect(line()).toHaveTextContent('Sent to the agent. task-b still needs a verdict.');
      rerender(notice({ step: { kind: 'switch', name: 'task-b', waiting: 2 }, delivery: sent }));
      expect(line()).toHaveTextContent(
        'Sent to the agent. task-b and 1 other review still need a verdict.',
      );
      rerender(notice({ step: { kind: 'switch', name: 'task-b', waiting: 3 }, delivery: sent }));
      expect(line()).toHaveTextContent(
        'Sent to the agent. task-b and 2 other reviews still need a verdict.',
      );
    });

    it('names a Codex queue receipt', () => {
      render(
        notice({
          step: { kind: 'resume', reviews: 1, status: 'ready' },
          delivery: { status: 'queued', at: '2026-11-12T17:00:00.000Z', transport: 'queue' },
        }),
      );
      expect(line()).toHaveTextContent(
        /^Approved\. Queued for Codex\. This review has a verdict\./,
      );
    });

    it('names a send that failed or went unconfirmed', () => {
      const step = { kind: 'resume', reviews: 1, status: 'ready' } as const;
      const at = '2026-11-12T17:00:00.000Z';
      const { rerender } = render(
        notice({ step, delivery: { status: 'failed', at, error: 'connect ENOENT' } }),
      );
      expect(line()).toHaveTextContent(
        /^Approved\. Not sent: connect ENOENT\. This review has a verdict\./,
      );
      expect(line().querySelector('[data-delivery-state]')).toHaveAttribute(
        'data-delivery-state',
        'disconnected',
      );
      rerender(
        notice({
          step,
          delivery: { status: 'uncertain', at, error: 'no acknowledgment', transport: 'queue' },
        }),
      );
      // The robot's hidden ! comes first in the text.
      expect(line()).toHaveTextContent(
        "Codex didn't confirm it got this. This review has a verdict.",
      );
      expect(line().querySelector('[data-delivery-state]')).toHaveAttribute(
        'data-delivery-state',
        'uncertain',
      );
    });

    // An agent blocked in gavel wait still gets the verdict without an inbox.
    it('says when no agent session gets messages, and still offers Close tab', () => {
      render(notice({ step: { kind: 'close', reviews: 1 }, delivery: { status: 'unavailable' } }));
      expect(line()).toHaveTextContent(
        /^Approved\. No agent session gets messages from this review\. You can close this tab\.$/,
      );
      expect(screen.getByRole('button', { name: 'Close tab' })).toBeEnabled();
    });

    // A server older than the inbox reports no delivery.
    it('shows only the next step without a delivery report', () => {
      render(notice({ step: { kind: 'close', reviews: 1 } }));
      expect(line()).toHaveTextContent(/^Approved\. You can close this tab\.$/);
      expect(line().querySelector('[data-delivery-state]')).toBeNull();
      expect(screen.getByRole('button', { name: 'Close tab' })).toBeEnabled();
    });
  });

  it('shows no countdown', () => {
    render(notice({ step: { kind: 'switch', name: 'task-b', waiting: 1 } }));
    expect(status()).not.toHaveTextContent(/\d+s\b/);
    expect(status().querySelector('.verdict-countdown-bar')).toBeNull();
  });

  // The toast slides in from the right; reduced motion turns that off in global.css.
  it('slides in', () => {
    render(notice({ step: { kind: 'switch', name: 'task-b', waiting: 1 } }));
    expect(status()).toHaveClass('verdict-toast');
  });

  it('explains the Codex handoff, and exposes copy errors', () => {
    const onProceed = vi.fn();
    const onUndo = vi.fn();
    const { rerender } = render(
      notice({ step: { kind: 'resume', reviews: 2, status: 'ready' }, onProceed, onUndo }),
    );
    expect(status()).toHaveTextContent('All 2 reviews have a verdict.');
    expect(status()).toHaveTextContent(
      "If the agent hasn't resumed, copy the prompt and paste it into the chat that opened this review",
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy resume prompt and close' }));
    expect(onProceed).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Keep open' })).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Copy resume prompt and close' }).previousElementSibling,
    ).toBe(screen.getByRole('button', { name: 'Keep open' }));
    rerender(notice({ step: { kind: 'resume', reviews: 2, status: 'copying' } }));
    expect(screen.getByRole('button', { name: 'Copying…' })).toBeDisabled();
    rerender(notice({ step: { kind: 'resume', reviews: 2, status: 'error' } }));
    expect(screen.getByRole('alert')).toHaveTextContent('This tab will stay open; try again.');
    expect(screen.getByRole('button', { name: 'Copy resume prompt and close' })).toBeEnabled();
  });

  // Green means approval on the verdict buttons beside it; moving on is navigation.
  it('colors the notice and its default button blue, not the approval green', () => {
    render(notice({ step: { kind: 'switch', name: 'task-b', waiting: 1 } }));
    const next = screen.getByRole('button', { name: 'Switch to task-b' });
    expect(next).toHaveClass('bg-blue-600', 'text-white');
    expect(status()).toHaveClass('border-blue-600');
    for (const element of [next, status()]) expect(element.className).not.toMatch(/github-accent/);
  });

  it('sizes its buttons like the verdict buttons above it', () => {
    render(notice({ step: { kind: 'switch', name: 'task-b', waiting: 1 } }));
    for (const name of ['Switch to task-b', 'Undo']) {
      expect(screen.getByRole('button', { name })).toHaveClass('py-1.5', 'text-sm');
    }
  });

  // A bordered X was shorter than the text buttons beside it, and no other control looked like it.
  it('dismisses with a bare X, like the sidebars close', () => {
    render(notice({ step: { kind: 'switch', name: 'task-b', waiting: 1 } }));
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    expect(dismiss).toHaveClass('text-github-text-secondary', 'hover:text-github-text-primary');
    expect(dismiss.className).not.toMatch(/\bborder\b|py-1\.5/);
    expect(dismiss.querySelector('svg')).toHaveAttribute('width', '20');
  });

  // The header group clips overflow, so the notice floats above the page from a portal,
  // anchored to the verdict buttons the reviewer just clicked.
  it('floats outside the header so the header cannot clip it', () => {
    const header = document.createElement('header');
    header.style.overflow = 'hidden';
    document.body.appendChild(header);
    const verdicts = document.createElement('div');
    header.appendChild(verdicts);
    render(notice({ anchor: verdicts, step: { kind: 'close', reviews: 1 } }), {
      container: header,
    });
    expect(header).not.toContainElement(status());
  });

  // An absolute toast adds to the page's scroll size while it slides in from past the right edge,
  // or widens before it is repositioned, so a horizontal scrollbar flashes and the page jumps.
  // Measured in headless Chromium at 1280 px: scrollWidth reached 1291 during the slide-in.
  it('stays out of the page scroll size, so it cannot flash a scrollbar', () => {
    render(notice({ step: { kind: 'switch', name: 'task-b', waiting: 1 } }));
    expect(status().style.position).toBe('fixed');
  });

  // The portal mounts the notice at the end of the page; a keyboard user who just pressed a
  // verdict button must still reach its buttons with Tab.
  it('puts its buttons right after the verdict buttons in tab order', async () => {
    const user = userEvent.setup();
    const verdicts = document.createElement('div');
    document.body.appendChild(verdicts);
    render(
      <>
        <button type="button">Reject</button>
        {notice({ anchor: verdicts, step: { kind: 'switch', name: 'task-b', waiting: 1 } })}
        <button type="button">Next control</button>
      </>,
    );
    screen.getByRole('button', { name: 'Reject' }).focus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Switch to task-b' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toHaveFocus();
  });

  it('tells the reviewer the tab can be closed, and lets them undo or dismiss it', () => {
    const onDismiss = vi.fn();
    const onUndo = vi.fn();
    render(notice({ step: { kind: 'closable', reviews: 2 }, onDismiss, onUndo }));
    expect(status()).toHaveTextContent('All 2 reviews have a verdict. You can close this tab.');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
