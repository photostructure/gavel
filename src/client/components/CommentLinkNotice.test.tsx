import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CommentLinkNotice } from './CommentLinkNotice';

const missingLine = 'Line 42 of "src/upload.ts" is not in this diff.';
const missingFile = '"src/gone.ts" is not in this diff.';

function mount(message: string | null) {
  const onDismiss = vi.fn();
  const view = render(<CommentLinkNotice message={message} onDismiss={onDismiss} />);
  const region = () => screen.getByRole('status', { name: 'Link not followed' });
  // The countdown bar is aria-hidden, so no role query reaches it.
  const countdown = () => view.container.querySelector('.toast-countdown');
  return {
    onDismiss,
    region,
    countdown,
    show: (next: string | null) =>
      view.rerender(<CommentLinkNotice message={next} onDismiss={onDismiss} />),
  };
}

describe('CommentLinkNotice', () => {
  it('keeps the empty live region mounted while there is no message', () => {
    const { region, countdown } = mount(null);
    expect(region()).toBeEmptyDOMElement();
    expect(countdown()).toBeNull();
  });

  it('shows the title and the reason the link was not followed', () => {
    const { region } = mount(missingLine);
    expect(region()).toHaveTextContent('Link not followed');
    expect(region()).toHaveTextContent(missingLine);
  });

  it('calls onDismiss when the reviewer clicks Dismiss', async () => {
    const { onDismiss } = mount(missingLine);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('calls onDismiss when the countdown bar finishes', () => {
    const { onDismiss, countdown } = mount(missingLine);
    const bar = countdown();
    expect(bar).not.toBeNull();
    fireEvent.animationEnd(bar as Element);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('ignores the end of the toast slide-in animation', () => {
    const { onDismiss, countdown } = mount(missingLine);
    const root = countdown()?.closest('.toast');
    expect(root).not.toBeNull();
    fireEvent.animationEnd(root as Element);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('restarts the countdown for a new message', () => {
    const { countdown, show } = mount(missingLine);
    const first = countdown();
    expect(first).not.toBeNull();

    show(missingFile);
    const second = countdown();
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
  });
});
