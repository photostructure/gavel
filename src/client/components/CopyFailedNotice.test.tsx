import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HotkeysProvider } from 'react-hotkeys-hook';
import { describe, expect, it, vi } from 'vitest';

import { CopyFailedNotice } from './CopyFailedNotice';

function mount(failure: number | null) {
  const onDismiss = vi.fn();
  // Escape is a navigation hotkey, as in the app.
  const view = render(<CopyFailedNotice failure={failure} onDismiss={onDismiss} />, {
    wrapper: ({ children }) => (
      <HotkeysProvider initiallyActiveScopes={['navigation']}>{children}</HotkeysProvider>
    ),
  });
  const region = () => screen.getByRole('status', { name: 'Copy failed' });
  // The countdown bar is aria-hidden, so no role query reaches it.
  const countdown = () => view.container.querySelector('.toast-countdown');
  return {
    onDismiss,
    region,
    countdown,
    show: (next: number | null) =>
      view.rerender(<CopyFailedNotice failure={next} onDismiss={onDismiss} />),
  };
}

describe('CopyFailedNotice', () => {
  it('keeps the empty live region mounted while no copy has failed', () => {
    const { region, countdown } = mount(null);
    expect(region()).toBeEmptyDOMElement();
    expect(countdown()).toBeNull();
  });

  it('says the copy failed and what to do instead', () => {
    const { region } = mount(1);
    expect(region()).toHaveTextContent('Copy failed');
    expect(region()).toHaveTextContent(
      'The browser blocked clipboard access. Select the text and copy it yourself, or try again.',
    );
  });

  it('calls onDismiss when the reviewer clicks Dismiss', async () => {
    const { onDismiss } = mount(1);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('calls onDismiss when the reviewer presses Escape', async () => {
    const { onDismiss } = mount(1);
    await userEvent.keyboard('{Escape}');
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('calls onDismiss when the countdown bar finishes', () => {
    const { onDismiss, countdown } = mount(1);
    fireEvent.animationEnd(countdown() as Element);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('restarts the countdown when another copy fails', () => {
    const { countdown, show } = mount(1);
    const first = countdown();
    expect(first).not.toBeNull();

    show(2);
    const second = countdown();
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
  });
});
