import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CommentForm } from './CommentForm';

describe('CommentForm', () => {
  // The new-comment box renders inside the font-mono diff table, like the thread cards.
  it('sets the sans-serif font on the new-comment box', () => {
    const { container } = render(
      <div className="font-mono">
        <CommentForm onSubmit={vi.fn()} onCancel={vi.fn()} />
      </div>,
    );
    expect(container.querySelector('form')).toHaveClass('font-sans');
  });

  it('dismisses an empty form on reset', () => {
    const onCancel = vi.fn();
    const { container } = render(<CommentForm onSubmit={vi.fn()} onCancel={onCancel} />);
    fireEvent.reset(container.querySelector('form')!);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('discards a partial draft with Cancel without submitting it', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    render(<CommentForm onSubmit={onSubmit} onCancel={onCancel} />);
    await user.type(screen.getByRole('textbox'), 'Half a thought');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledExactlyOnceWith('');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('tabs from the textarea to Send before Cancel', async () => {
    const user = userEvent.setup();
    render(<CommentForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    await user.type(screen.getByRole('textbox'), 'Draft');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Send' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });
});
