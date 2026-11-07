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
        step={{ kind: 'switch', name: 'task-b', seconds: 2 }}
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
        step={{ kind: 'close', reviews: 1, seconds: 9 }}
        onCancel={vi.fn()}
        onProceed={onProceed}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close now' }));
    expect(onProceed).toHaveBeenCalledOnce();
  });

  // Green means approval on the verdict buttons beside it; moving on is navigation.
  it('colors the notice and its default button blue, not the approval green', () => {
    render(
      <VerdictFollowUpNotice
        anchor={anchor()}
        step={{ kind: 'switch', name: 'task-b', seconds: 9 }}
        onCancel={vi.fn()}
        onProceed={vi.fn()}
      />,
    );
    const now = screen.getByRole('button', { name: 'Switch now' });
    expect(now).toHaveClass('bg-blue-600', 'text-white');
    expect(status()).toHaveClass('border-blue-600');
    for (const element of [now, status()]) expect(element.className).not.toMatch(/github-accent/);
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
        step={{ kind: 'close', reviews: 1, seconds: 5 }}
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
        <button type="button">Not yet</button>
        <VerdictFollowUpNotice
          anchor={verdicts}
          step={{ kind: 'switch', name: 'task-b', seconds: 3 }}
          onCancel={vi.fn()}
          onProceed={vi.fn()}
        />
        <button type="button">Next control</button>
      </>,
    );
    screen.getByRole('button', { name: 'Not yet' }).focus();
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
        step={{ kind: 'close', reviews: 3, seconds: 5 }}
        onCancel={vi.fn()}
        onProceed={vi.fn()}
      />,
    );
    expect(status()).toHaveTextContent('All 3 reviews have a verdict. Closing this tab in 5s');
    rerender(
      <VerdictFollowUpNotice
        anchor={element}
        step={{ kind: 'close', reviews: 1, seconds: 4 }}
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
