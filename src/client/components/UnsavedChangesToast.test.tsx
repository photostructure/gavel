import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

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

  it('shows a dismissed message again after the changes were sent and a later send fails', async () => {
    const { show } = mount(one);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    show(null);

    show(one);
    expect(screen.getByRole('alert')).toHaveTextContent(one);
  });
});
