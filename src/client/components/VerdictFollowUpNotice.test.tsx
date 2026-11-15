import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { ClientInboxDelivery } from '../hooks/useInboxDelivery';

import { ToastStack } from './ToastStack';
import { VerdictFollowUpNotice } from './VerdictFollowUpNotice';

type Props = ComponentProps<typeof VerdictFollowUpNotice>;

describe('verdict follow-up notice', () => {
  const toast = () => screen.getByRole('dialog', { name: 'Next step' });
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
    expect(screen.queryByRole('dialog', { name: 'Next step' })).not.toBeInTheDocument();
  });

  // The comment cards' look, shared by every toast: a grid of glyph, message, and close X, with
  // the actions under the message, the primary one last.
  it('puts the glyph, message, and close X in a row, with the actions under the message', () => {
    render(
      notice({
        step: { kind: 'switch', name: 'task-b', waiting: 1 },
        delivery: { status: 'pending' },
      }),
    );
    const message = screen.getByTestId('verdict-toast-detail');
    const next = screen.getByRole('button', { name: 'Switch to task-b' });
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    const glyph = toast().firstElementChild;
    expect(toast()).toHaveClass('toast', 'grid');
    expect(glyph).toHaveClass('col-start-1', 'row-start-1');
    expect(glyph?.nextElementSibling).toBe(message);
    expect(message).toHaveTextContent(/^Approved Sending to the agent…$/);
    expect(message).toHaveClass('col-start-2', 'row-start-1');
    expect(message.nextElementSibling).toContainElement(next);
    expect(message).not.toContainElement(next);
    expect(next.parentElement).toHaveClass('col-start-2', 'justify-end');
    expect(next.nextElementSibling).toBeNull();
    // Last in the DOM, so last in tab order, though the grid shows it beside the message.
    expect(next.parentElement?.nextElementSibling).toBe(dismiss);
    expect(dismiss).toHaveClass('col-start-3', 'row-start-1');
    expect(dismiss).not.toHaveClass('absolute');
  });

  it('marks an Approve with a check in the approve color', () => {
    render(notice({ step: { kind: 'switch', name: 'task-b', waiting: 1 } }));
    expect(toast()).toHaveClass('border-l-github-accent');
    const glyph = toast().firstElementChild?.querySelector('svg');
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
    expect(glyph).toHaveAttribute('width', '16');
    expect(glyph?.getAttribute('class')).toMatch(/lucide-check/);
    expect(glyph).toHaveClass('text-github-accent-text');
  });

  // An undone verdict leaves nothing to color, but the empty glyph cell keeps the message in its
  // column.
  it('shows a gray frame and no glyph without a verdict', () => {
    render(notice({ step: { kind: 'close', reviews: 1 }, verdict: undefined }));
    expect(toast()).toHaveClass('border-l-github-text-muted');
    expect(toast().firstElementChild).toHaveClass('col-start-1');
    expect(toast().firstElementChild?.querySelector('svg')).toBeNull();
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
    expect(screen.getByTestId('verdict-toast-detail').firstElementChild).toHaveTextContent(
      /^Approved$/,
    );
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
    expect(next).toHaveAttribute('title', 'Switch to fix-useReviewOps-random-uuid (Return)');
    expect(next.querySelector('code')).toHaveClass('min-w-0', 'truncate');
  });

  // With a long name the row wrapped, leaving Undo alone on a line above the button. On one row,
  // the button shrinks and its name truncates instead; Undo keeps its width.
  it('keeps Undo and a long next step on one row', () => {
    render(notice({ step: { kind: 'switch', name: 'refactor-plan-2-test-helpers', waiting: 6 } }));
    const next = screen.getByRole('button', { name: 'Switch to refactor-plan-2-test-helpers' });
    const undo = screen.getByRole('button', { name: 'Undo' });
    expect(next.parentElement).not.toHaveClass('flex-wrap');
    expect(next).not.toHaveClass('shrink-0');
    expect(undo).toHaveClass('shrink-0');
  });

  // A verdict saving or a capture reloading ignores the click, as it does on the verdict buttons.
  it('disables Undo while the verdict buttons are busy', () => {
    render(notice({ step: { kind: 'switch', name: 'task-b', waiting: 1 }, busy: true }));
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  it('names a Reject, framed and marked in the reject color', () => {
    render(notice({ step: { kind: 'switch', name: 'task-b', waiting: 1 }, verdict: 'reject' }));
    expect(screen.getByTestId('verdict-toast-detail').firstElementChild).toHaveTextContent(
      /^Rejected$/,
    );
    expect(toast()).toHaveClass('border-l-verdict-reject');
    expect(toast().className).not.toMatch(/github-accent/);
    const glyph = toast().firstElementChild?.querySelector('svg');
    expect(glyph?.getAttribute('class')).toMatch(/lucide-x/);
    expect(glyph).toHaveClass('text-verdict-reject');
  });

  // Browsers honour window.close() only in a tab a script opened or one with a single history
  // entry, and comment links and the revision picker add entries, so the toast says the page can be
  // closed instead of offering a button that usually fails. "Page" holds on phones and tablets, where readers may not see tabs.
  it('says the page can be closed once every review has a verdict, with no close button', () => {
    const { rerender } = render(notice({ step: { kind: 'close', reviews: 3 } }));
    expect(toast()).toHaveTextContent('Approved');
    expect(toast()).toHaveTextContent('All 3 reviews have a verdict, so you can close this page.');
    expect(
      within(toast())
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Undo', '']);
    rerender(notice({ step: { kind: 'close', reviews: 1 } }));
    expect(toast()).toHaveTextContent('You can close this page.');
    expect(toast()).not.toHaveTextContent('reviews have a verdict');
  });

  describe('delivery to the agent', () => {
    const line = () => screen.getByTestId('verdict-toast-detail');
    const report = () => screen.getByTestId('verdict-toast-delivery');
    const sent: ClientInboxDelivery = {
      status: 'sent',
      at: '2026-11-12T17:00:00.000Z',
      via: 'inbox',
    };

    // Until the verdict is sent, a failure that needs the resume prompt may still arrive.
    it('says the verdict is being sent, and only then that the page can be closed', () => {
      const step = { kind: 'close', reviews: 1 } as const;
      const { rerender } = render(notice({ step, delivery: { status: 'pending' } }));
      expect(line()).toHaveTextContent(/^Approved Sending to the agent…$/);
      expect(report()).toHaveClass('text-github-text-primary/75');
      rerender(notice({ step, delivery: sent }));
      expect(line()).toHaveTextContent(/^Approved Sent to the agent\. You can close this page\.$/);
      expect(report()).toHaveClass('text-github-text-primary/75');
    });

    // Switching reviews keeps the page, so it never waits for the send.
    it('offers the next review while sending, then names it and counts the rest', () => {
      const { rerender } = render(
        notice({
          step: { kind: 'switch', name: 'task-b', waiting: 1 },
          delivery: { status: 'pending' },
        }),
      );
      expect(line()).toHaveTextContent(/^Approved Sending to the agent…$/);
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
      expect(line()).toHaveTextContent(/^Approved Queued for Codex\. This review has a verdict\./);
    });

    it('names a send that failed or went unconfirmed', () => {
      const step = { kind: 'resume', reviews: 1, status: 'ready' } as const;
      const at = '2026-11-12T17:00:00.000Z';
      const { rerender } = render(
        notice({ step, delivery: { status: 'failed', at, error: 'connect ENOENT' } }),
      );
      expect(line()).toHaveTextContent(
        /^Approved Not sent: connect ENOENT\. This review has a verdict\./,
      );
      // Red, as the header robot is when the verdict did not reach the agent, in the shade that
      // keeps 4.5:1 contrast on the toast's tint.
      expect(report()).toHaveClass('text-github-danger-text');
      expect(report()).not.toHaveClass('text-github-text-primary/75');
      rerender(
        notice({
          step,
          delivery: { status: 'uncertain', at, error: 'no acknowledgment', transport: 'queue' },
        }),
      );
      expect(line()).toHaveTextContent(
        /^Approved Codex didn't confirm it got this\. This review has a verdict\./,
      );
      expect(report()).toHaveClass('text-github-danger-text');
    });

    // An agent blocked in gavel wait still gets the verdict without an inbox.
    it('says when no agent session gets messages, and that the page can still be closed', () => {
      render(notice({ step: { kind: 'close', reviews: 1 }, delivery: { status: 'unavailable' } }));
      expect(line()).toHaveTextContent(
        /^Approved No agent session gets messages from this review\. You can close this page\.$/,
      );
      // Nothing is wrong, so the report stays dimmed.
      expect(report()).toHaveClass('text-github-text-primary/75');
    });

    // A server older than the inbox reports no delivery.
    it('shows only the next step without a delivery report', () => {
      render(notice({ step: { kind: 'close', reviews: 1 } }));
      expect(line()).toHaveTextContent(/^Approved You can close this page\.$/);
      expect(screen.queryByTestId('verdict-toast-delivery')).toBeNull();
    });
  });

  // The header's robot, just above, already shows the delivery state; the toast says it in words.
  it('puts the delivery report on its own line under the title, without a robot', () => {
    render(notice({ step: { kind: 'close', reviews: 1 }, delivery: { status: 'pending' } }));
    const report = screen.getByTestId('verdict-toast-delivery');
    expect(report).toHaveTextContent(/^Sending to the agent…$/);
    expect(report.previousElementSibling).toHaveTextContent(/^Approved$/);
    expect(toast().querySelector('[data-delivery-state]')).toBeNull();
  });

  // The status, then what to do: a delivery report that changes does not reflow the next step.
  it('starts the next step on its own line, under the verdict and its delivery', () => {
    render(
      notice({
        step: { kind: 'switch', name: 'play-b', waiting: 3 },
        delivery: { status: 'sent', at: '2026-11-12T17:00:00.000Z', via: 'inbox' },
      }),
    );
    const next = screen.getByTestId('verdict-toast-next');
    expect(next).toHaveClass('mt-2', 'text-github-text-primary');
    expect(next).toHaveTextContent(/^play-b and 2 other reviews still need a verdict\.$/);
  });

  // Every line of the toast is 8px from the next: the title's own margin sets the gap when
  // there is no delivery report between it and the next step.
  it('spaces the title, delivery report, and next step 8px apart', () => {
    const { rerender } = render(
      notice({
        step: { kind: 'close', reviews: 1 },
        delivery: { status: 'sent', at: '2026-11-12T17:00:00.000Z', via: 'inbox' },
      }),
    );
    expect(screen.getByText('Approved')).toHaveClass('mb-2');
    expect(screen.getByTestId('verdict-toast-next')).toHaveClass('mt-2');
    rerender(notice({ step: { kind: 'close', reviews: 1 } }));
    expect(screen.getByText('Approved')).toHaveClass('mb-2');
    expect(screen.getByTestId('verdict-toast-next')).not.toHaveClass('mt-2');
  });

  it('shows no next step line while the verdict is being sent', () => {
    render(
      notice({
        step: { kind: 'switch', name: 'play-b', waiting: 2 },
        delivery: { status: 'pending' },
      }),
    );
    expect(screen.queryByTestId('verdict-toast-next')).toBeNull();
  });

  // What the reviewer acts on stands out; the delivery report is status beside it.
  it('dims only the delivery report, not the verdict or the next step', () => {
    render(
      notice({
        step: { kind: 'close', reviews: 1 },
        delivery: { status: 'sent', at: '2026-11-12T17:00:00.000Z', via: 'inbox' },
      }),
    );
    const message = screen.getByTestId('verdict-toast-detail');
    expect(message).toHaveTextContent('Approved Sent to the agent. You can close this page.');
    expect(message).not.toHaveClass('text-github-text-primary/75');
    expect(
      [...message.querySelectorAll('.text-github-text-primary\\/75')].map((dim) => dim.textContent),
    ).toEqual(['Sent to the agent.']);
  });

  it('shows no countdown', () => {
    render(notice({ step: { kind: 'switch', name: 'task-b', waiting: 1 } }));
    expect(toast()).not.toHaveTextContent(/\d+s\b/);
    expect(toast().querySelector('.verdict-countdown-bar')).toBeNull();
  });

  // The shared toast class slides it in from the right.
  it('slides in', () => {
    render(notice({ step: { kind: 'switch', name: 'task-b', waiting: 1 } }));
    expect(toast()).toHaveClass('toast');
  });

  // Keep open did what the X does on every other toast.
  it('explains the resume handoff, closes with the X, and exposes copy errors', () => {
    const onDismiss = vi.fn();
    const onProceed = vi.fn();
    const onUndo = vi.fn();
    const { rerender } = render(
      notice({
        step: { kind: 'resume', reviews: 2, status: 'ready' },
        onDismiss,
        onProceed,
        onUndo,
      }),
    );
    expect(toast()).toHaveTextContent('All 2 reviews have a verdict.');
    expect(toast()).toHaveTextContent(
      "If the agent hasn't resumed, copy the prompt and paste it into the chat that opened this review",
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy resume prompt' }));
    expect(onProceed).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Keep open' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy resume prompt' }).previousElementSibling).toBe(
      screen.getByRole('button', { name: 'Undo' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledOnce();
    rerender(notice({ step: { kind: 'resume', reviews: 2, status: 'copying' } }));
    expect(screen.getByRole('button', { name: 'Copying…' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    rerender(notice({ step: { kind: 'resume', reviews: 2, status: 'error' } }));
    expect(screen.getByRole('alert')).toHaveTextContent('Could not copy the prompt; try again.');
    // The danger fill's red measures 2.7:1 on the dark tint; this shade keeps 4.5:1.
    expect(screen.getByRole('alert')).toHaveClass('text-github-danger-text');
    expect(screen.getByRole('button', { name: 'Copy resume prompt' })).toBeEnabled();
  });

  // Green means approval on the verdict buttons; moving on is navigation.
  it('colors its default button blue, not the approval green', () => {
    render(notice({ step: { kind: 'switch', name: 'task-b', waiting: 1 } }));
    const next = screen.getByRole('button', { name: 'Switch to task-b' });
    expect(next).toHaveClass('bg-blue-600', 'text-white');
    expect(next.className).not.toMatch(/github-accent/);
  });

  it("sizes its buttons like the other toasts' buttons", () => {
    render(notice({ step: { kind: 'switch', name: 'task-b', waiting: 1 } }));
    for (const name of ['Switch to task-b', 'Undo']) {
      expect(screen.getByRole('button', { name })).toHaveClass('h-7', 'px-3', 'text-sm');
    }
  });

  // The toast is on the tertiary background, so Undo takes the secondary one, as every toast's
  // secondary buttons do.
  it("styles Undo like the other toasts' secondary buttons", () => {
    render(notice({ step: { kind: 'resume', reviews: 1, status: 'ready' } }));
    const button = screen.getByRole('button', { name: 'Undo' });
    expect(button).toHaveClass('border-github-border', 'bg-github-bg-secondary');
    expect(button).not.toHaveClass('bg-github-bg-tertiary');
  });

  // A bordered X was shorter than the text buttons beside it, and no other control looked like it.
  it('dismisses with a bare X, like the sidebars close', () => {
    render(notice({ step: { kind: 'switch', name: 'task-b', waiting: 1 } }));
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    expect(dismiss).toHaveClass('text-github-text-secondary', 'hover:text-github-text-primary');
    expect(dismiss.className).not.toMatch(/\bborder\b|py-1\.5/);
    expect(dismiss.querySelector('svg')).toHaveAttribute('width', '16');
  });

  // The toast stack's portal mounts the notice at the end of the page; a keyboard user who just
  // pressed a verdict button must still reach its buttons with Tab.
  it('puts its buttons right after the verdict buttons in tab order', async () => {
    const user = userEvent.setup();
    const verdicts = document.createElement('div');
    document.body.appendChild(verdicts);
    render(
      <>
        <button type="button">Reject</button>
        <ToastStack anchor={verdicts}>
          {notice({ anchor: verdicts, step: { kind: 'switch', name: 'task-b', waiting: 1 } })}
        </ToastStack>
        <button type="button">Next control</button>
      </>,
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Switch to task-b' })).toHaveFocus(),
    );
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Reject' })).toHaveFocus();
    await user.tab();
    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toHaveFocus();
  });

  describe('from the keyboard', () => {
    // Return presses the focused button, so the toast focuses the one Return should press.
    it('focuses the next step when it opens, so Return takes it', async () => {
      const user = userEvent.setup();
      const onProceed = vi.fn();
      render(notice({ step: { kind: 'switch', name: 'task-b', waiting: 1 }, onProceed }));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Switch to task-b' })).toHaveFocus(),
      );
      await user.keyboard('{Enter}');
      expect(onProceed).toHaveBeenCalledOnce();
    });

    it('focuses the copy button in the resume handoff', async () => {
      render(notice({ step: { kind: 'resume', reviews: 1, status: 'ready' } }));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Copy resume prompt' })).toHaveFocus(),
      );
    });

    // Never Undo: Return there would clear the verdict.
    it('focuses the X when there is no next step to take', async () => {
      render(notice({ step: { kind: 'close', reviews: 1 } }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Dismiss' })).toHaveFocus());
    });

    // Another tab can give the last verdict while the reviewer's focus is on Switch.
    it('moves focus to the X when the focused next step goes away', async () => {
      const { rerender } = render(notice({ step: { kind: 'switch', name: 'task-b', waiting: 1 } }));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Switch to task-b' })).toHaveFocus(),
      );
      rerender(notice({ step: { kind: 'close', reviews: 2 } }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Dismiss' })).toHaveFocus());
    });

    // A disabled button loses focus to the page, and a copy that then fails (no clipboard over
    // plain HTTP) would leave Return and Escape with nothing to act on.
    it('keeps focus on the copy button while it copies, so Return can retry a failed copy', async () => {
      const { rerender } = render(
        notice({ step: { kind: 'resume', reviews: 1, status: 'ready' } }),
      );
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Copy resume prompt' })).toHaveFocus(),
      );
      rerender(notice({ step: { kind: 'resume', reviews: 1, status: 'copying' } }));
      const copying = screen.getByRole('button', { name: 'Copying…' });
      expect(copying).not.toBeDisabled();
      expect(copying).toHaveAttribute('aria-disabled', 'true');
      expect(copying).toHaveFocus();
      rerender(notice({ step: { kind: 'resume', reviews: 1, status: 'error' } }));
      expect(screen.getByRole('button', { name: 'Copy resume prompt' })).toHaveFocus();
    });

    // A retried send can open the toast long after the click; typing in a comment then must not
    // land on the toast, where Space would switch reviews.
    it('leaves focus in a text field the reviewer is typing in, while it stays open', async () => {
      const field = document.createElement('textarea');
      const help = document.createElement('button');
      document.body.append(field, help);
      field.focus();
      const step = { kind: 'switch', name: 'task-b', waiting: 1 } as const;
      const { rerender } = render(notice({ step }));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(field).toHaveFocus();
      // Leaving the field, say for Help, must not hand focus to the toast on its next render.
      help.focus();
      rerender(notice({ step: { ...step } }));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(help).toHaveFocus();
      field.remove();
      help.remove();
    });

    it('dismisses on Escape', async () => {
      const user = userEvent.setup();
      const onDismiss = vi.fn();
      render(notice({ step: { kind: 'switch', name: 'task-b', waiting: 1 }, onDismiss }));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Switch to task-b' })).toHaveFocus(),
      );
      await user.keyboard('{Escape}');
      expect(onDismiss).toHaveBeenCalledOnce();
    });

    // It takes focus, so it is a dialog; its message stays a live region, so a delivery report
    // that changes after it opens is still read out.
    it('is a non-modal dialog described by its message, which announces changes', () => {
      render(notice({ step: { kind: 'close', reviews: 1 } }));
      const message = screen.getByTestId('verdict-toast-detail');
      expect(toast()).not.toHaveAttribute('aria-modal', 'true');
      expect(toast()).toHaveAccessibleDescription(message.textContent ?? '');
      expect(message).toHaveAttribute('aria-live', 'polite');
    });

    // The focus ring may not show after a mouse click, so a mark says Return is armed. Touch-only
    // devices have no Return key to arm.
    it('marks its focused next step with a Return glyph on pointer devices, and names the key', () => {
      render(notice({ step: { kind: 'switch', name: 'task-b', waiting: 1 } }));
      const next = screen.getByRole('button', { name: 'Switch to task-b' });
      expect(next).toHaveAttribute('title', 'Switch to task-b (Return)');
      expect(next).toHaveClass('group');
      const glyph = within(next).getByTestId('return-glyph');
      expect(glyph).toHaveAttribute('aria-hidden', 'true');
      expect(glyph).toHaveClass('hidden', 'pointer-fine:group-focus:inline');
    });

    it('names Return in the copy button title too', () => {
      render(notice({ step: { kind: 'resume', reviews: 1, status: 'ready' } }));
      expect(screen.getByRole('button', { name: 'Copy resume prompt' })).toHaveAttribute(
        'title',
        'Copy resume prompt (Return)',
      );
    });
  });

  it('says what to do with a copied resume prompt, and lets the reviewer undo or dismiss it', () => {
    const onDismiss = vi.fn();
    const onUndo = vi.fn();
    render(notice({ step: { kind: 'copied' }, onDismiss, onUndo }));
    expect(toast()).toHaveTextContent(
      "Approved Copied. Paste it into the agent's chat, then close this page.",
    );
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
