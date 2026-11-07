import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { HotkeysProvider } from 'react-hotkeys-hook';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CommentThread } from '../../types/diff';
import type { CommentSubmitOptions } from './CommentForm';
import { CommentsListModal } from './CommentsListModal';

// Reply and edit forms save unsent text to sessionStorage; start each test without it.
afterEach(() => sessionStorage.clear());

const time = '2026-10-24T00:00:00Z';
const threads: CommentThread[] = ['A', 'B', 'C'].map((id) => ({
  id,
  scope: 'review',
  createdAt: time,
  updatedAt: time,
  messages: [{ id, body: `Thread ${id}`, author: 'User', createdAt: time, updatedAt: time }],
}));
const props = {
  isOpen: true,
  onClose: vi.fn(),
  onNavigate: vi.fn(),
  onGenerateThreadPrompt: () => '',
  onReplyToThread: vi.fn(),
  onRemoveMessage: vi.fn(),
  onUpdateMessage: vi.fn(),
  onAddGeneralComment: vi.fn(),
};

function KeyboardHarness() {
  const [comments, setComments] = useState(threads);
  return (
    <HotkeysProvider initiallyActiveScopes={['global']}>
      <CommentsListModal
        {...props}
        comments={comments}
        onToggleThreadResolved={vi.fn()}
        onRemoveThread={(id) => setComments((items) => items.filter((thread) => thread.id !== id))}
      />
    </HotkeysProvider>
  );
}

const inline: CommentThread = {
  ...threads[0]!,
  scope: 'line',
  file: 'test.ts',
  line: 1,
  side: 'new',
};
function TriggerHarness({
  onNavigate,
  onAddGeneralComment,
}: {
  onNavigate: (thread: CommentThread) => void;
  onAddGeneralComment: (body: string, options: CommentSubmitOptions) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <HotkeysProvider initiallyActiveScopes={['global']}>
      <button onClick={() => setOpen(true)}>Open conversation</button>
      <CommentsListModal
        {...props}
        isOpen={open}
        onClose={() => setOpen(false)}
        comments={[inline]}
        onToggleThreadResolved={vi.fn()}
        onRemoveThread={vi.fn()}
        onNavigate={onNavigate}
        onAddGeneralComment={onAddGeneralComment}
      />
    </HotkeysProvider>
  );
}

function generalComposer() {
  return within(screen.getByPlaceholderText('Comment or ask about this review…').closest('form')!);
}

describe('Conversation keyboard navigation', () => {
  it('jumps once from a focused drawer without reactivating its opener', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<TriggerHarness onNavigate={onNavigate} onAddGeneralComment={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Open conversation' }));
    await user.keyboard('{Enter}');
    expect(onNavigate).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('sends from the focused Send button without triggering inline navigation', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const onAddGeneralComment = vi.fn().mockResolvedValue(undefined);
    render(<TriggerHarness onNavigate={onNavigate} onAddGeneralComment={onAddGeneralComment} />);
    await user.click(screen.getByRole('button', { name: 'Open conversation' }));
    await user.type(generalComposer().getByRole('textbox'), 'Why this approach?');
    await user.tab();
    expect(generalComposer().getByRole('button', { name: 'Send' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onAddGeneralComment).toHaveBeenCalledWith('Why this approach?', {
      isQuestion: false,
      intent: 'comment',
    });
    expect(onNavigate).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('keeps navigation shortcuts active after clicking a drawer button', async () => {
    const user = userEvent.setup();
    render(<KeyboardHarness />);
    await user.click(screen.getAllByRole('button', { name: 'Copy Prompt' })[0]!);
    await user.keyboard('j');
    expect(screen.getByText('2 of 3 threads')).toBeInTheDocument();
  });

  it('opens with navigation available instead of focusing the composer', async () => {
    const user = userEvent.setup();
    render(<KeyboardHarness />);
    expect(generalComposer().getByRole('textbox')).not.toHaveFocus();
    await user.keyboard('j');
    expect(screen.getByText('2 of 3 threads')).toBeInTheDocument();
    expect(generalComposer().getByRole('textbox')).toHaveValue('');
  });
});

it('deletes a general thread immediately without removing adjacent discussions', async () => {
  const user = userEvent.setup();
  render(<KeyboardHarness />);
  await user.click(screen.getAllByRole('button', { name: 'Delete thread' })[0]!);
  expect(screen.queryByText('Thread A')).not.toBeInTheDocument();
  expect(screen.getByText('Thread B')).toBeInTheDocument();
  expect(screen.getByText('Thread C')).toBeInTheDocument();
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

it('keeps a reply draft visible after a click outside the reply form', async () => {
  const user = userEvent.setup();
  render(<TriggerHarness onNavigate={vi.fn()} onAddGeneralComment={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: 'Open conversation' }));
  await user.click(screen.getByRole('button', { name: 'Write a reply...' }));
  const reply = screen.getByPlaceholderText('Write a reply...');
  await user.type(reply, 'Keep this reply');
  await user.click(screen.getByRole('button', { name: 'Copy Prompt' }));
  expect(reply).toBeVisible();
  expect(reply).toHaveValue('Keep this reply');
});

it('closes the panel on Escape in a reply with text and keeps the reply', async () => {
  const user = userEvent.setup();
  render(<TriggerHarness onNavigate={vi.fn()} onAddGeneralComment={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: 'Open conversation' }));
  await user.click(screen.getByRole('button', { name: 'Write a reply...' }));
  await user.type(screen.getByPlaceholderText('Write a reply...'), 'Keep this reply');
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Open conversation' }));
  expect(screen.getByPlaceholderText('Write a reply...')).toHaveValue('Keep this reply');
});

describe('Conversation drafts', () => {
  // Draft loss reproduced with pnpm test -- src/client/components/CommentsListModal.integration.test.tsx.
  it('preserves an unsent comment when visiting inline code and closing the drawer', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<TriggerHarness onNavigate={onNavigate} onAddGeneralComment={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Open conversation' }));
    await user.type(generalComposer().getByRole('textbox'), 'Why this approach?');
    await user.click(generalComposer().getByRole('radio', { name: 'Question' }));
    await user.click(generalComposer().getByRole('radio', { name: 'Change request' }));
    await user.click(screen.getByText('Thread A'));
    expect(onNavigate).toHaveBeenCalledWith(inline);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open conversation' }));
    expect(generalComposer().getByRole('textbox')).toHaveValue('Why this approach?');
    expect(generalComposer().getByRole('radio', { name: 'Change request' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Close conversation' }));
    await user.click(screen.getByRole('button', { name: 'Open conversation' }));
    expect(generalComposer().getByRole('textbox')).toHaveValue('Why this approach?');
    expect(generalComposer().getByRole('radio', { name: 'Change request' })).toBeChecked();
  });

  it('discards the draft when explicitly cancelling with Cancel', async () => {
    const user = userEvent.setup();
    render(<TriggerHarness onNavigate={vi.fn()} onAddGeneralComment={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Open conversation' }));
    await user.type(generalComposer().getByRole('textbox'), 'Never mind');
    await user.click(generalComposer().getByRole('radio', { name: 'Question' }));
    await user.click(generalComposer().getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open conversation' }));
    expect(generalComposer().getByRole('textbox')).toHaveValue('');
    expect(generalComposer().getByRole('radio', { name: 'Comment' })).toBeChecked();
  });

  // Escape never discards unsaved text: it closes the panel and keeps the draft.
  it('keeps the draft when Escape closes the panel', async () => {
    const user = userEvent.setup();
    render(<TriggerHarness onNavigate={vi.fn()} onAddGeneralComment={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Open conversation' }));
    await user.type(generalComposer().getByRole('textbox'), 'Not yet');
    await user.click(generalComposer().getByRole('radio', { name: 'Question' }));
    await user.click(generalComposer().getByRole('textbox'));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open conversation' }));
    expect(generalComposer().getByRole('textbox')).toHaveValue('Not yet');
    expect(generalComposer().getByRole('radio', { name: 'Question' })).toBeChecked();
  });

  it('clears the saved draft after sending successfully', async () => {
    const user = userEvent.setup();
    const onAddGeneralComment = vi.fn().mockResolvedValue(undefined);
    render(<TriggerHarness onNavigate={vi.fn()} onAddGeneralComment={onAddGeneralComment} />);
    await user.click(screen.getByRole('button', { name: 'Open conversation' }));
    await user.type(generalComposer().getByRole('textbox'), 'Why this approach?');
    await user.click(generalComposer().getByRole('radio', { name: 'Question' }));
    await user.click(generalComposer().getByRole('button', { name: 'Send' }));
    expect(onAddGeneralComment).toHaveBeenCalledWith('Why this approach?', {
      isQuestion: true,
      intent: 'question',
    });
    expect(generalComposer().getByRole('textbox')).toHaveValue('');
    expect(generalComposer().getByRole('radio', { name: 'Comment' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Close conversation' }));
    await user.click(screen.getByRole('button', { name: 'Open conversation' }));
    expect(generalComposer().getByRole('textbox')).toHaveValue('');
    expect(generalComposer().getByRole('radio', { name: 'Comment' })).toBeChecked();
  });

  it('keeps a newer draft if an earlier send finishes after reopening', async () => {
    const user = userEvent.setup();
    let finishSend!: () => void;
    const onAddGeneralComment = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSend = resolve;
        }),
    );
    render(<TriggerHarness onNavigate={vi.fn()} onAddGeneralComment={onAddGeneralComment} />);
    await user.click(screen.getByRole('button', { name: 'Open conversation' }));
    await user.type(generalComposer().getByRole('textbox'), 'First question');
    await user.click(generalComposer().getByRole('button', { name: 'Send' }));
    await user.click(screen.getByRole('button', { name: 'Close conversation' }));
    await user.click(screen.getByRole('button', { name: 'Open conversation' }));
    await user.clear(generalComposer().getByRole('textbox'));
    await user.type(generalComposer().getByRole('textbox'), 'Second question');
    await user.click(generalComposer().getByRole('radio', { name: 'Question' }));
    await user.click(generalComposer().getByRole('radio', { name: 'Change request' }));
    await act(async () => finishSend());
    expect(generalComposer().getByRole('textbox')).toHaveValue('Second question');
    expect(generalComposer().getByRole('radio', { name: 'Change request' })).toBeChecked();
  });

  it('retains a draft after a failed send and reopening the drawer', async () => {
    const user = userEvent.setup();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onAddGeneralComment = vi.fn().mockRejectedValue(new Error('offline'));
    render(<TriggerHarness onNavigate={vi.fn()} onAddGeneralComment={onAddGeneralComment} />);
    await user.click(screen.getByRole('button', { name: 'Open conversation' }));
    await user.type(generalComposer().getByRole('textbox'), 'Why this approach?');
    await user.click(generalComposer().getByRole('radio', { name: 'Question' }));
    await user.click(generalComposer().getByRole('button', { name: 'Send' }));
    expect(error).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Close conversation' }));
    await user.click(screen.getByRole('button', { name: 'Open conversation' }));
    expect(generalComposer().getByRole('textbox')).toHaveValue('Why this approach?');
    expect(generalComposer().getByRole('radio', { name: 'Question' })).toBeChecked();
  });
});
