import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UnsavedChangesToast } from './UnsavedChangesToast';

const one = '1 change is not saved to the server (Failed to fetch).';
const two = '2 changes are not saved to the server (Failed to fetch).';

function mount(message: string | null) {
  const anchor = document.createElement('div');
  document.body.append(anchor);
  const view = render(<UnsavedChangesToast anchor={anchor} message={message} />);
  return {
    show: (next: string | null) =>
      view.rerender(<UnsavedChangesToast anchor={anchor} message={next} />),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('UnsavedChangesToast', () => {
  it('shows the message as an alert outside the page flow', () => {
    mount(one);
    expect(screen.getByRole('alert')).toHaveTextContent(one);
  });

  it('shows nothing while every change is saved', () => {
    mount(null);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('hides a dismissed message and shows a different one', async () => {
    const { show } = mount(one);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();

    show(two);
    expect(screen.getByRole('alert')).toHaveTextContent(two);
  });

  // A transition from its first placement would slide it in from the window's top-left corner.
  // The frames are held so the check of its first place cannot run after the next frame.
  it('glides to a new place only from the frame after its first placement', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((frame) => frames.push(frame));
    mount(one);
    const toast = screen.getByRole('alert');
    await waitFor(() => expect(toast.style.transform).not.toBe('translate(0px, 0px)'));
    expect(toast).not.toHaveAttribute('data-glide');

    act(() => {
      for (const frame of frames.splice(0)) frame(performance.now());
    });
    expect(toast).toHaveAttribute('data-glide');
  });

  // Floating UI keeps the old place while the toast is closed, so a reopened toast that still
  // glided would slide there from the window's top-left corner.
  it('takes its first place again without gliding when a dismissed toast reopens', async () => {
    const { show } = mount(one);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveAttribute('data-glide'));
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
    show(two);
    expect(screen.getByRole('alert')).not.toHaveAttribute('data-glide');
  });

  it('shows a dismissed message again after the changes were sent and a later send fails', async () => {
    const { show } = mount(one);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    show(null);

    show(one);
    expect(screen.getByRole('alert')).toHaveTextContent(one);
  });
});
