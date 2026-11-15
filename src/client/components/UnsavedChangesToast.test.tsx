import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { UnsavedChanges } from '../hooks/useReviewOps';
import { UnsavedChangesToast } from './UnsavedChangesToast';

const one: UnsavedChanges = { count: 1, failure: 'Failed to fetch' };
const two: UnsavedChanges = { count: 2, failure: 'Failed to fetch' };

function mount(unsaved: UnsavedChanges | null, onSendNow = vi.fn(async () => {})) {
  const view = render(<UnsavedChangesToast unsaved={unsaved} onSendNow={onSendNow} />);
  return {
    onSendNow,
    show: (next: UnsavedChanges | null) =>
      view.rerender(<UnsavedChangesToast unsaved={next} onSendNow={onSendNow} />),
  };
}

describe('UnsavedChangesToast', () => {
  it('shows the dead robot, one waiting change, why its send failed, and what sends it again', () => {
    mount(one);
    const alert = screen.getByRole('alert');
    expect(alert.querySelector('[data-delivery-state="unreachable"]')).not.toBeNull();
    expect(alert).toHaveTextContent('1 change not saved');
    expect(alert).toHaveTextContent(
      'Sending failed (Failed to fetch). Gavel sends it again with your next change, when you reload, or when the live connection reopens.',
    );
  });

  it('counts several waiting changes and refers to them in the plural', () => {
    mount(two);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('2 changes not saved');
    expect(alert).toHaveTextContent(
      'Sending failed (Failed to fetch). Gavel sends them again with your next change, when you reload, or when the live connection reopens.',
    );
  });

  it('sends the waiting changes when the reviewer asks', async () => {
    const { onSendNow } = mount(one);
    await userEvent.click(screen.getByRole('button', { name: 'Send again now' }));
    expect(onSendNow).toHaveBeenCalledTimes(1);
  });

  // A send that fails again leaves the same count and failure, so without this the click would
  // change nothing on screen.
  it('says it is sending until the attempt ends, and ignores clicks meanwhile', async () => {
    let finish!: () => void;
    const onSendNow = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    mount(one, onSendNow);
    const button = screen.getByRole('button', { name: 'Send again now' });

    await userEvent.click(button);
    expect(button).toHaveTextContent('Sending…');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(button);
    expect(onSendNow).toHaveBeenCalledTimes(1);

    await act(async () => finish());
    expect(button).toHaveTextContent('Send again now');
    expect(button).not.toHaveAttribute('aria-disabled');
  });

  it('puts the close button after the action in tab order', () => {
    mount(one);
    expect(
      screen
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label') ?? button.textContent),
    ).toEqual(['Send again now', 'Dismiss']);
  });

  it('shows nothing while every change is saved', () => {
    mount(null);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('hides a dismissed toast and shows it again for a different count', async () => {
    const { show } = mount(one);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();

    show(two);
    expect(screen.getByRole('alert')).toHaveTextContent('2 changes not saved');
  });

  it('shows a dismissed toast again for a different failure', async () => {
    const { show } = mount(one);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    show({ count: 1, failure: '502 Bad Gateway' });
    expect(screen.getByRole('alert')).toHaveTextContent('Sending failed (502 Bad Gateway).');
  });

  it('keeps a dismissed toast hidden while the same changes still fail the same way', async () => {
    const { show } = mount(one);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    show({ ...one });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a dismissed toast again after the changes were sent and a later send fails', async () => {
    const { show } = mount(one);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    show(null);

    show(one);
    expect(screen.getByRole('alert')).toHaveTextContent('1 change not saved');
  });
});
