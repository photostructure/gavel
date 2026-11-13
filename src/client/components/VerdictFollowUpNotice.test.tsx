import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { VerdictFollowUpNotice } from './VerdictFollowUpNotice';

describe('verdict follow-up notice', () => {
  const status = () => screen.getByRole('status', { name: 'Next step' });
  const anchor = () => {
    const element = document.createElement('div');
    document.body.appendChild(element);
    return element;
  };

  it('renders nothing without a step', () => {
    render(
      <VerdictFollowUpNotice
        anchor={anchor()}
        step={null}
        onCancel={vi.fn()}
        onProceed={vi.fn()}
      />,
    );
    expect(screen.queryByRole('status', { name: 'Next step' })).not.toBeInTheDocument();
  });

  it('names the next review, and switches now or cancels from buttons beside the text', () => {
    const onCancel = vi.fn();
    const onProceed = vi.fn();
    render(
      <VerdictFollowUpNotice
        anchor={anchor()}
        step={{ kind: 'switch', name: 'task-b', seconds: 2, deadline: 1000 }}
        onCancel={onCancel}
        onProceed={onProceed}
      />,
    );
    expect(status()).toHaveTextContent('Switching to task-b in 2s');
    // Both buttons sit right after the text they act on.
    const now = screen.getByRole('button', { name: 'Switch now' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(now.previousElementSibling).toHaveTextContent('Switching to task-b in 2s');
    expect(cancel.previousElementSibling).toBe(now);
    fireEvent.click(now);
    expect(onProceed).toHaveBeenCalledOnce();
    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('offers Close now while counting down to closing the tab', () => {
    const onProceed = vi.fn();
    render(
      <VerdictFollowUpNotice
        anchor={anchor()}
        step={{ kind: 'close', reviews: 1, seconds: 9, deadline: 1000 }}
        onCancel={vi.fn()}
        onProceed={onProceed}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close now' }));
    expect(onProceed).toHaveBeenCalledOnce();
  });

  it('explains the Codex handoff without a countdown, and exposes copy errors', () => {
    const onProceed = vi.fn();
    const props = { anchor: anchor(), onCancel: vi.fn(), onProceed };
    const { rerender } = render(
      <VerdictFollowUpNotice {...props} step={{ kind: 'resume', reviews: 2, status: 'ready' }} />,
    );
    expect(status()).toHaveTextContent('All 2 reviews have a verdict.');
    expect(status()).toHaveTextContent(
      "If the agent hasn't resumed, copy the prompt and paste it into the chat that opened this review",
    );
    expect(status().querySelector('.verdict-countdown-bar')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Copy resume prompt and close' }));
    expect(onProceed).toHaveBeenCalledOnce();
    rerender(
      <VerdictFollowUpNotice {...props} step={{ kind: 'resume', reviews: 2, status: 'copying' }} />,
    );
    expect(screen.getByRole('button', { name: 'Copying…' })).toBeDisabled();
    rerender(
      <VerdictFollowUpNotice {...props} step={{ kind: 'resume', reviews: 2, status: 'error' }} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('This tab will stay open; try again.');
    expect(screen.getByRole('button', { name: 'Copy resume prompt and close' })).toBeEnabled();
  });

  // Green means approval on the verdict buttons beside it; moving on is navigation.
  it('colors the notice and its default button blue, not the approval green', () => {
    render(
      <VerdictFollowUpNotice
        anchor={anchor()}
        step={{ kind: 'switch', name: 'task-b', seconds: 9, deadline: 1000 }}
        onCancel={vi.fn()}
        onProceed={vi.fn()}
      />,
    );
    const now = screen.getByRole('button', { name: 'Switch now' });
    expect(now).toHaveClass('bg-blue-600', 'text-white');
    expect(status()).toHaveClass('border-blue-600');
    for (const element of [now, status()]) expect(element.className).not.toMatch(/github-accent/);
  });

  it('sizes its buttons like the verdict buttons above it', () => {
    render(
      <VerdictFollowUpNotice
        anchor={anchor()}
        step={{ kind: 'switch', name: 'task-b', seconds: 9, deadline: 1000 }}
        onCancel={vi.fn()}
        onProceed={vi.fn()}
      />,
    );
    for (const name of ['Switch now', 'Cancel']) {
      expect(screen.getByRole('button', { name })).toHaveClass('px-3', 'py-1.5', 'text-sm');
    }
  });

  it('drains a bar over the countdown and restarts it for a new countdown', () => {
    const element = anchor();
    const notice = (seconds: number, deadline: number) => (
      <VerdictFollowUpNotice
        anchor={element}
        step={{ kind: 'switch', name: 'task-b', seconds, deadline }}
        onCancel={vi.fn()}
        onProceed={vi.fn()}
      />
    );
    const bar = () => status().querySelector<HTMLElement>('.verdict-countdown-bar');
    const { rerender } = render(notice(10, 1000));
    const first = bar();
    expect(first?.style.animationDuration).toBe('10s');
    // A tick must not restart the animation.
    rerender(notice(9, 1000));
    expect(bar()).toBe(first);
    rerender(notice(10, 2000));
    expect(bar()).not.toBe(first);
  });

  it('shows no time-remaining bar once nothing is counting down', () => {
    render(
      <VerdictFollowUpNotice
        anchor={anchor()}
        step={{ kind: 'closable', reviews: 1 }}
        onCancel={vi.fn()}
        onProceed={vi.fn()}
      />,
    );
    expect(status().querySelector('.verdict-countdown-bar')).toBeNull();
  });

  // The header group clips overflow, so the notice floats above the page from a portal,
  // anchored to the verdict buttons the reviewer just clicked.
  it('floats outside the header so the header cannot clip it', () => {
    const header = document.createElement('header');
    header.style.overflow = 'hidden';
    document.body.appendChild(header);
    const verdicts = document.createElement('div');
    header.appendChild(verdicts);
    render(
      <VerdictFollowUpNotice
        anchor={verdicts}
        step={{ kind: 'close', reviews: 1, seconds: 5, deadline: 1000 }}
        onCancel={vi.fn()}
        onProceed={vi.fn()}
      />,
      { container: header },
    );
    expect(header).not.toContainElement(status());
  });

  // The portal mounts the notice at the end of the page; a keyboard user who just pressed a
  // verdict button must still reach its buttons with Tab before the countdown ends.
  it('puts its buttons right after the verdict buttons in tab order', async () => {
    const user = userEvent.setup();
    const verdicts = document.createElement('div');
    document.body.appendChild(verdicts);
    render(
      <>
        <button type="button">Reject</button>
        <VerdictFollowUpNotice
          anchor={verdicts}
          step={{ kind: 'switch', name: 'task-b', seconds: 3, deadline: 1000 }}
          onCancel={vi.fn()}
          onProceed={vi.fn()}
        />
        <button type="button">Next control</button>
      </>,
    );
    screen.getByRole('button', { name: 'Reject' }).focus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Switch now' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('counts down to closing once every review has a verdict', () => {
    const element = anchor();
    const { rerender } = render(
      <VerdictFollowUpNotice
        anchor={element}
        step={{ kind: 'close', reviews: 3, seconds: 5, deadline: 1000 }}
        onCancel={vi.fn()}
        onProceed={vi.fn()}
      />,
    );
    expect(status()).toHaveTextContent('All 3 reviews have a verdict. Closing this tab in 5s');
    rerender(
      <VerdictFollowUpNotice
        anchor={element}
        step={{ kind: 'close', reviews: 1, seconds: 4, deadline: 1000 }}
        onCancel={vi.fn()}
        onProceed={vi.fn()}
      />,
    );
    expect(status()).toHaveTextContent('This review has a verdict. Closing this tab in 4s');
  });

  it('tells the reviewer the tab can be closed, and lets them dismiss it', () => {
    const onCancel = vi.fn();
    render(
      <VerdictFollowUpNotice
        anchor={anchor()}
        step={{ kind: 'closable', reviews: 2 }}
        onCancel={onCancel}
        onProceed={vi.fn()}
      />,
    );
    expect(status()).toHaveTextContent('All 2 reviews have a verdict. You can close this tab.');
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
