import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CommentForm } from './CommentForm';

describe('CommentForm', () => {
  it.each([
    ['Comment', 'comment', false],
    ['Change request', 'change', false],
    ['Question', 'question', true],
  ] as const)('submits %s from the single intent group', async (label, intent, isQuestion) => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<CommentForm onSubmit={onSubmit} onCancel={vi.fn()} />);
    expect(screen.getByRole('radiogroup', { name: 'Comment intent' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: label }));
    await user.type(screen.getByRole('textbox'), 'Review feedback');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit).toHaveBeenCalledWith('Review feedback', { isQuestion, intent });
  });

  it('supports arrow-key intent selection', async () => {
    const user = userEvent.setup();
    render(<CommentForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    await user.click(screen.getByRole('radio', { name: 'Comment' }));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Change request' })).toBeChecked();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Question' })).toBeChecked();
  });

  it('keeps selections independent between composers', async () => {
    const user = userEvent.setup();
    render(
      <>
        <CommentForm onSubmit={vi.fn()} onCancel={vi.fn()} />
        <CommentForm onSubmit={vi.fn()} onCancel={vi.fn()} />
      </>,
    );
    await user.click(screen.getAllByRole('radio', { name: 'Question' })[0]!);
    expect(screen.getAllByRole('radio', { name: 'Comment' })[1]).toBeChecked();
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

  it('preserves intent after a failed send', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('offline'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<CommentForm onSubmit={onSubmit} onCancel={vi.fn()} initialIntent="question" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Why?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(error).toHaveBeenCalled());
    expect(screen.getByRole('radio', { name: 'Question' })).toBeChecked();
    expect(screen.getByRole('textbox')).toHaveValue('Why?');
  });
});
