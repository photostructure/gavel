import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { CommentThread } from '../../types/diff';
import { AgentUpdatesContext, type AgentUpdatesReadState } from '../contexts/AgentUpdatesContext';

import { CommentThreadCard } from './CommentThreadCard';
import { copyTextToClipboard } from '../utils/clipboard';
vi.mock('../utils/clipboard', () => ({
  copyTextToClipboard: vi.fn().mockResolvedValue(undefined),
}));

const mockThread: CommentThread = {
  id: 'thread-1',
  file: 'src/client/components/CommentThreadCard.tsx',
  line: 80,
  side: 'new',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  codeContent: 'const value = 1;',
  messages: [
    {
      id: 'message-1',
      body: 'Root comment',
      author: 'User',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
    {
      id: 'message-2',
      body: 'Reply comment',
      author: 'Reviewer',
      createdAt: '2024-01-01T00:01:00Z',
      updatedAt: '2024-01-01T00:01:00Z',
    },
  ],
};

describe('CommentThreadCard', () => {
  it('resolves without invoking the explicit deletion callback', async () => {
    const user = userEvent.setup();
    const onToggleThreadResolved = vi.fn();
    const onRemoveThread = vi.fn();
    render(
      <CommentThreadCard
        thread={mockThread}
        onGeneratePrompt={() => ''}
        onToggleThreadResolved={onToggleThreadResolved}
        onRemoveThread={onRemoveThread}
        onReplyToThread={vi.fn()}
        onRemoveMessage={vi.fn()}
        onUpdateMessage={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Resolve thread' }));
    expect(onToggleThreadResolved).toHaveBeenCalledWith('thread-1');
    expect(onRemoveThread).not.toHaveBeenCalled();
  });
  it('keeps a resolved general conversation available to reopen', async () => {
    const user = userEvent.setup();
    const onToggleThreadResolved = vi.fn();
    render(
      <CommentThreadCard
        thread={{
          id: 'general',
          scope: 'review',
          createdAt: mockThread.createdAt,
          updatedAt: mockThread.updatedAt,
          messages: mockThread.messages,
          resolution: { resolved: true, updatedAt: mockThread.updatedAt },
        }}
        onGeneratePrompt={() => ''}
        onToggleThreadResolved={onToggleThreadResolved}
        onReplyToThread={vi.fn()}
        onRemoveMessage={vi.fn()}
        onUpdateMessage={vi.fn()}
      />,
    );
    expect(screen.getByText('Review conversation')).toBeInTheDocument();
    expect(screen.getByText('Resolved')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(onToggleThreadResolved).toHaveBeenCalledWith('general');
  });
  it('reopens an expanded resolved thread immediately', async () => {
    const user = userEvent.setup();
    const onToggleThreadResolved = vi.fn();
    render(
      <CommentThreadCard
        thread={{ ...mockThread, resolution: { resolved: true, updatedAt: mockThread.updatedAt } }}
        onGeneratePrompt={() => ''}
        onToggleThreadResolved={onToggleThreadResolved}
        onReplyToThread={vi.fn()}
        onRemoveMessage={vi.fn()}
        onUpdateMessage={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Expand thread' }));
    await user.click(screen.getByTitle('Reopen thread'));
    expect(onToggleThreadResolved).toHaveBeenCalledWith('thread-1');
  });

  it.each(['queued', 'delivered', 'read', 'thinking', 'replying', 'noted', 'replied'] as const)(
    'shows %s progress even when author badges are hidden',
    (status) => {
      render(
        <CommentThreadCard
          thread={{
            ...mockThread,
            messages: [
              {
                ...mockThread.messages[0]!,
                progress: { status, cursor: 'stream:1', updatedAt: '2026-10-24T00:00:00Z' },
              },
            ],
          }}
          onGeneratePrompt={() => ''}
          onToggleThreadResolved={vi.fn()}
          onReplyToThread={vi.fn()}
          onRemoveMessage={vi.fn()}
          onUpdateMessage={vi.fn()}
        />,
      );
      expect(screen.getByRole('status')).toHaveTextContent(
        status[0]!.toUpperCase() + status.slice(1),
      );
    },
  );

  it('does not show delete action for replies authored by someone else', () => {
    render(
      <CommentThreadCard
        thread={mockThread}
        onGeneratePrompt={() => 'thread prompt'}
        onToggleThreadResolved={vi.fn()}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={vi.fn()}
        onUpdateMessage={vi.fn()}
      />,
    );

    expect(screen.getByText('Reply comment')).toBeInTheDocument();
    expect(screen.queryByTitle('Delete reply')).not.toBeInTheDocument();
  });

  it('allows resolving and updating intent on imported root comments', () => {
    render(
      <CommentThreadCard
        thread={{
          ...mockThread,
          messages: [
            {
              ...mockThread.messages[0]!,
              author: 'Reviewer',
            },
          ],
        }}
        onGeneratePrompt={() => 'thread prompt'}
        onToggleThreadResolved={vi.fn()}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={vi.fn()}
        onUpdateMessage={vi.fn()}
      />,
    );

    expect(screen.getByTitle('Resolve thread')).toBeInTheDocument();
    expect(screen.getByTitle('Edit message')).toBeInTheDocument();
  });

  it('resolves on the first click, collapses, and reopens on the first click', async () => {
    const user = userEvent.setup();
    const onToggleThreadResolved = vi.fn();
    const props = {
      onGeneratePrompt: () => 'thread prompt',
      onToggleThreadResolved,
      onReplyToThread: vi.fn().mockResolvedValue(undefined),
      onRemoveMessage: vi.fn(),
      onUpdateMessage: vi.fn(),
    };
    const view = render(<CommentThreadCard {...props} thread={mockThread} />);
    await user.click(screen.getByTitle('Resolve thread'));
    expect(onToggleThreadResolved).toHaveBeenCalledWith('thread-1');
    expect(screen.queryByText('Resolve?')).not.toBeInTheDocument();
    view.rerender(
      <CommentThreadCard
        {...props}
        thread={{ ...mockThread, resolution: { resolved: true, updatedAt: mockThread.updatedAt } }}
      />,
    );
    expect(screen.queryByText('Reply comment')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(onToggleThreadResolved).toHaveBeenCalledTimes(2);
    view.rerender(<CommentThreadCard {...props} thread={mockThread} />);
    expect(screen.getByText('Reply comment')).toBeVisible();
  });

  it('collapses a deleted thread and offers Undelete without navigating', async () => {
    const user = userEvent.setup();
    const onRestoreComment = vi.fn();
    const onClick = vi.fn();
    render(
      <CommentThreadCard
        thread={{ ...mockThread, deleted: true }}
        onGeneratePrompt={() => ''}
        onToggleThreadResolved={vi.fn()}
        onReplyToThread={vi.fn()}
        onRemoveMessage={vi.fn()}
        onUpdateMessage={vi.fn()}
        onRestoreComment={onRestoreComment}
        onClick={onClick}
      />,
    );
    expect(screen.getByText('Deleted')).toBeVisible();
    expect(screen.queryByText('Reply comment')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undelete' }));
    expect(onRestoreComment).toHaveBeenCalledWith('thread-1');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('shows a compact deleted reply with its own Undelete action', async () => {
    const user = userEvent.setup();
    const onRestoreComment = vi.fn();
    render(
      <CommentThreadCard
        thread={{ ...mockThread, deletedMessageIds: ['message-2'] }}
        onGeneratePrompt={() => ''}
        onToggleThreadResolved={vi.fn()}
        onReplyToThread={vi.fn()}
        onRemoveMessage={vi.fn()}
        onUpdateMessage={vi.fn()}
        onRestoreComment={onRestoreComment}
      />,
    );
    expect(screen.getByText('Reply deleted')).toBeVisible();
    expect(screen.queryByText('Reply comment')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undelete' }));
    expect(onRestoreComment).toHaveBeenCalledWith('thread-1', 'message-2');
  });

  it('collapses the thread into a single line and expands it back', async () => {
    const user = userEvent.setup();

    render(
      <CommentThreadCard
        thread={mockThread}
        onGeneratePrompt={() => 'thread prompt'}
        onToggleThreadResolved={vi.fn()}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={vi.fn()}
        onUpdateMessage={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Collapse thread' }));

    // Messages and actions are hidden; a one-line summary with the count remains
    expect(screen.queryByText('Reply comment')).not.toBeInTheDocument();
    expect(screen.queryByText(/Copy Prompt/)).not.toBeInTheDocument();
    expect(screen.queryByTitle('Resolve thread')).not.toBeInTheDocument();
    expect(screen.getByText('Root comment')).toBeInTheDocument();
    expect(screen.getByLabelText('2 messages in thread')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Expand thread' }));

    expect(screen.getByText('Reply comment')).toBeInTheDocument();
    expect(screen.getByTitle('Resolve thread')).toBeInTheDocument();
  });

  it('expands a collapsed thread by clicking the summary line', async () => {
    const user = userEvent.setup();

    render(
      <CommentThreadCard
        thread={mockThread}
        onGeneratePrompt={() => 'thread prompt'}
        onToggleThreadResolved={vi.fn()}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={vi.fn()}
        onUpdateMessage={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Collapse thread' }));
    await user.click(screen.getByText('Root comment'));

    expect(screen.getByText('Reply comment')).toBeInTheDocument();
  });

  it('does not trigger the card click when toggling collapse', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(
      <CommentThreadCard
        thread={mockThread}
        onGeneratePrompt={() => 'thread prompt'}
        onToggleThreadResolved={vi.fn()}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={vi.fn()}
        onUpdateMessage={vi.fn()}
        onClick={onClick}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Collapse thread' }));

    expect(onClick).not.toHaveBeenCalled();
  });

  it('shows the "Outdated" badge when the thread is marked outdated', () => {
    render(
      <CommentThreadCard
        thread={{ ...mockThread, isOutdated: true }}
        onGeneratePrompt={() => 'thread prompt'}
        onToggleThreadResolved={vi.fn()}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={vi.fn()}
        onUpdateMessage={vi.fn()}
      />,
    );

    const badge = screen.getByLabelText('Outdated comment');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('Outdated');
    expect(badge).toHaveAttribute('title', 'Code has changed since this comment was made');
  });

  it('does not render the "Outdated" badge when the thread is up to date', () => {
    render(
      <CommentThreadCard
        thread={mockThread}
        onGeneratePrompt={() => 'thread prompt'}
        onToggleThreadResolved={vi.fn()}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={vi.fn()}
        onUpdateMessage={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText('Outdated comment')).not.toBeInTheDocument();
  });

  it('deletes a user-authored reply on the first click', async () => {
    const user = userEvent.setup();
    const onRemoveMessage = vi.fn();

    render(
      <CommentThreadCard
        thread={{
          ...mockThread,
          messages: [
            mockThread.messages[0]!,
            {
              ...mockThread.messages[1]!,
              author: 'User',
            },
          ],
        }}
        onGeneratePrompt={() => 'thread prompt'}
        onToggleThreadResolved={vi.fn()}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={onRemoveMessage}
        onUpdateMessage={vi.fn()}
      />,
    );

    await user.click(screen.getByTitle('Delete reply'));

    expect(onRemoveMessage).toHaveBeenCalledWith('thread-1', 'message-2');
  });

  it('deletes the root thread on the first click', async () => {
    const user = userEvent.setup();
    const onRemoveThread = vi.fn();
    const onToggleThreadResolved = vi.fn();

    render(
      <CommentThreadCard
        thread={mockThread}
        onGeneratePrompt={() => 'thread prompt'}
        onToggleThreadResolved={onToggleThreadResolved}
        onRemoveThread={onRemoveThread}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={vi.fn()}
        onUpdateMessage={vi.fn()}
      />,
    );

    await user.click(screen.getByTitle('Delete thread'));

    expect(onRemoveThread).toHaveBeenCalledWith('thread-1');
    expect(onToggleThreadResolved).not.toHaveBeenCalled();
  });

  it('edits legacy question intent through the same group without a header toggle', async () => {
    const user = userEvent.setup();
    const onUpdateMessage = vi.fn();
    const root = mockThread.messages[0]!;
    render(
      <CommentThreadCard
        thread={{
          ...mockThread,
          isQuestion: true,
          messages: [{ ...root, author: 'Reviewer', origin: 'agent' }],
        }}
        onGeneratePrompt={() => 'thread prompt'}
        onToggleThreadResolved={vi.fn()}
        onReplyToThread={vi.fn()}
        onRemoveMessage={vi.fn()}
        onUpdateMessage={onUpdateMessage}
      />,
    );
    expect(screen.getByText('Question', { selector: 'span' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Change to a normal comment' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    await user.click(screen.getByTitle('Edit message'));
    const editForm = within(screen.getByPlaceholderText('Edit your message...').closest('form')!);
    expect(editForm.getByRole('radio', { name: 'Question' })).toBeChecked();
    await user.click(editForm.getByRole('radio', { name: 'Comment' }));
    await user.click(editForm.getByRole('button', { name: 'Save' }));
    expect(onUpdateMessage).toHaveBeenCalledWith('thread-1', root.id, root.body, 'comment');
  });
});

describe('reply copy actions', () => {
  it('copies the body of a reply authored by someone else', async () => {
    const user = userEvent.setup();

    render(
      <CommentThreadCard
        thread={mockThread}
        onGeneratePrompt={() => 'thread prompt'}
        onToggleThreadResolved={vi.fn()}
        onRemoveThread={vi.fn()}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={vi.fn()}
        onUpdateMessage={vi.fn()}
      />,
    );

    await user.click(screen.getByTitle('Copy message'));

    expect(copyTextToClipboard).toHaveBeenCalledWith('Reply comment');
    expect(screen.getByTitle('Copied!')).toBeInTheDocument();
  });

  it('places the copy action before edit on a user-authored reply', () => {
    render(
      <CommentThreadCard
        thread={{
          ...mockThread,
          messages: [
            mockThread.messages[0]!,
            {
              ...mockThread.messages[1]!,
              author: 'User',
            },
          ],
        }}
        onGeneratePrompt={() => 'thread prompt'}
        onToggleThreadResolved={vi.fn()}
        onRemoveThread={vi.fn()}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={vi.fn()}
        onUpdateMessage={vi.fn()}
      />,
    );

    const copyButton = screen.getByTitle('Copy message');
    const editButtons = screen.getAllByTitle('Edit message');
    const replyEditButton = editButtons[editButtons.length - 1]!;

    expect(copyButton.nextElementSibling).toBe(replyEditButton);
  });

  it('does not show the copy action on the root comment', () => {
    render(
      <CommentThreadCard
        thread={{ ...mockThread, messages: [mockThread.messages[0]!] }}
        onGeneratePrompt={() => 'thread prompt'}
        onToggleThreadResolved={vi.fn()}
        onRemoveThread={vi.fn()}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={vi.fn()}
        onUpdateMessage={vi.fn()}
      />,
    );

    expect(screen.queryByTitle('Copy message')).not.toBeInTheDocument();
  });
});

describe('reply read state', () => {
  const agentThread: CommentThread = {
    ...mockThread,
    messages: [
      mockThread.messages[0]!,
      { ...mockThread.messages[1]!, origin: 'agent', author: 'Agent' },
    ],
  };

  const renderWithReadState = (readState: AgentUpdatesReadState) =>
    render(
      <AgentUpdatesContext.Provider value={readState}>
        <CommentThreadCard
          thread={agentThread}
          onGeneratePrompt={() => ''}
          onToggleThreadResolved={vi.fn()}
          onRemoveThread={vi.fn()}
          onReplyToThread={vi.fn().mockResolvedValue(undefined)}
          onRemoveMessage={vi.fn()}
          onUpdateMessage={vi.fn()}
        />
      </AgentUpdatesContext.Provider>,
    );

  it.each([
    { unread: true, name: 'Mark reply as read', dot: 'bg-blue-500' },
    { unread: false, name: 'Mark reply as unread', dot: 'border-blue-500' },
  ])(
    'shows the $dot dot first among the reply actions (unread: $unread)',
    ({ unread, name, dot }) => {
      const setRead = vi.fn();
      renderWithReadState({
        enabled: true,
        unreadKeys: new Set(unread ? [JSON.stringify(['thread-1', 'message-2'])] : []),
        setRead,
      });

      const button = screen.getByRole('button', { name });
      expect(button).toHaveAttribute('title', name);
      expect(button).toHaveTextContent('');
      expect(button.querySelector('span')).toHaveClass(dot);
      expect(button.nextElementSibling).toBe(screen.getByTitle('Copy message'));

      fireEvent.click(button);
      expect(setRead).toHaveBeenCalledWith('thread-1', 'message-2', expect.any(String), unread);
    },
  );
});

describe('thread disclosure and replies', () => {
  function renderThread(props: Partial<ComponentProps<typeof CommentThreadCard>> = {}) {
    return render(
      <>
        <button type="button">Outside thread</button>
        <CommentThreadCard
          thread={mockThread}
          onGeneratePrompt={() => 'thread prompt'}
          onToggleThreadResolved={vi.fn()}
          onReplyToThread={vi.fn().mockResolvedValue(undefined)}
          onRemoveMessage={vi.fn()}
          onUpdateMessage={vi.fn()}
          {...props}
        />
      </>,
    );
  }
  const agentAnswered: CommentThread = {
    ...mockThread,
    messages: [
      mockThread.messages[0]!,
      { ...mockThread.messages[1]!, author: 'Codex', origin: 'agent' },
    ],
  };

  it('offers quick replies beside the reply field when the agent replied last', () => {
    renderThread({ thread: agentAnswered });

    const row = screen.getByRole('group', { name: 'Reply' });
    expect(
      within(row)
        .getAllByRole('button')
        .map((button) => [button.textContent, button.getAttribute('title')]),
    ).toEqual([
      ['👍 Agreed', 'Send "👍 Agreed: no reply needed." as a comment'],
      [
        '❓ Still unclear',
        'Send "❓ Still unclear: please explain again in different words." as a question',
      ],
      ['👎 Disagree', 'Send "👎 Disagree: please reconsider, or defend the point." as a question'],
      ['Write a reply...', null],
    ]);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it.each([
    ['👍 Agreed', '👍 Agreed: no reply needed.', 'comment'],
    ['❓ Still unclear', '❓ Still unclear: please explain again in different words.', 'question'],
    ['👎 Disagree', '👎 Disagree: please reconsider, or defend the point.', 'question'],
  ])('sends %s as an ordinary reply with one click', async (label, body, intent) => {
    const user = userEvent.setup();
    const onReplyToThread = vi.fn().mockResolvedValue(undefined);
    const onClick = vi.fn();
    renderThread({ thread: agentAnswered, onReplyToThread, onClick });

    await user.click(screen.getByRole('button', { name: label }));

    expect(onReplyToThread).toHaveBeenCalledWith('thread-1', body, intent);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('offers only the reply field when the newest visible message is not an agent reply', () => {
    renderThread({
      thread: { ...agentAnswered, deletedMessageIds: [agentAnswered.messages[1]!.id] },
    });
    expect(screen.queryByRole('button', { name: '👍 Agreed' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Write a reply...' })).toBeInTheDocument();

    cleanup();
    renderThread();
    expect(screen.queryByRole('button', { name: '👍 Agreed' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Write a reply...' })).toBeInTheDocument();
  });

  it('opens a focused reply form and collapses it after sending', async () => {
    const user = userEvent.setup();
    const onReplyToThread = vi.fn().mockResolvedValue(undefined);
    const onClick = vi.fn();
    renderThread({ thread: agentAnswered, onReplyToThread, onClick });

    await user.click(screen.getByRole('button', { name: 'Write a reply...' }));
    const reply = screen.getByPlaceholderText('Write a reply...');
    expect(reply).toHaveFocus();
    expect(screen.queryByRole('button', { name: '👍 Agreed' })).not.toBeInTheDocument();
    await user.type(reply, 'A new reply');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(onReplyToThread).toHaveBeenCalledWith('thread-1', 'A new reply', 'comment');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Write a reply...' })).toBeInTheDocument();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('closes an empty reply form on Escape and returns focus to the reply field', async () => {
    const user = userEvent.setup();
    renderThread();

    await user.click(screen.getByRole('button', { name: 'Write a reply...' }));
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Write a reply...' })).toHaveFocus();
  });

  it('discards a reply draft with Cancel', async () => {
    const user = userEvent.setup();
    const onReplyToThread = vi.fn().mockResolvedValue(undefined);
    renderThread({ onReplyToThread });

    await user.click(screen.getByRole('button', { name: 'Write a reply...' }));
    await user.type(screen.getByPlaceholderText('Write a reply...'), 'Never mind');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(onReplyToThread).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Write a reply...' }));
    expect(screen.getByPlaceholderText('Write a reply...')).toHaveValue('');
  });

  it('keeps a reply draft open across Escape and outside clicks', async () => {
    const user = userEvent.setup();
    renderThread();

    await user.click(screen.getByRole('button', { name: 'Write a reply...' }));
    const reply = screen.getByPlaceholderText('Write a reply...');
    await user.type(reply, 'Keep this draft');
    await user.click(screen.getByRole('radio', { name: 'Question' }));
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Outside thread' }));

    expect(reply).toBeVisible();
    expect(reply).toHaveValue('Keep this draft');
    expect(screen.getByRole('radio', { name: 'Question' })).toBeChecked();
    expect(reply.closest('form')).toHaveAttribute('data-empty', 'false');
  });

  it.each([
    { thread: mockThread, heading: `${mockThread.file}:80` },
    {
      thread: {
        id: 'review-thread',
        scope: 'review' as const,
        createdAt: mockThread.createdAt,
        updatedAt: mockThread.updatedAt,
        messages: mockThread.messages,
      },
      heading: 'Review conversation',
    },
  ])(
    'toggles the full $heading heading without invoking card navigation',
    async ({ thread, heading }) => {
      const user = userEvent.setup();
      const onClick = vi.fn();
      renderThread({ thread, onClick });

      const disclosure = screen.getByRole('button', { name: 'Collapse thread' });
      const contentId = disclosure.getAttribute('aria-controls')!;
      expect(document.getElementById(contentId)).toContainElement(
        screen.getByText('Reply comment'),
      );
      await user.click(screen.getByText(heading));

      expect(disclosure).toHaveAttribute('aria-expanded', 'false');
      expect(document.getElementById(contentId)).not.toBeVisible();
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(onClick).not.toHaveBeenCalled();

      await user.click(screen.getByText(heading));
      expect(disclosure).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('button', { name: 'Write a reply...' })).toBeVisible();
      expect(onClick).not.toHaveBeenCalled();
    },
  );

  it('supports Enter and Space on the heading without stealing focus', async () => {
    const user = userEvent.setup();
    renderThread();

    const disclosure = screen.getByRole('button', { name: 'Collapse thread' });
    disclosure.focus();
    await user.keyboard('{Enter}');
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard(' ');
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(disclosure).toHaveFocus();
  });

  it('keeps Copy Prompt independent from disclosure and navigation', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderThread({ onClick });

    await user.click(screen.getByRole('button', { name: 'Copy Prompt' }));

    expect(copyTextToClipboard).toHaveBeenCalledWith('thread prompt');
    expect(screen.getByRole('button', { name: 'Collapse thread' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(onClick).not.toHaveBeenCalled();
  });
});

it('cancels copied feedback when the thread unmounts', async () => {
  vi.useFakeTimers();
  try {
    const view = render(
      <CommentThreadCard
        thread={mockThread}
        onGeneratePrompt={() => 'thread prompt'}
        onToggleThreadResolved={vi.fn()}
        onReplyToThread={vi.fn()}
        onRemoveMessage={vi.fn()}
        onUpdateMessage={vi.fn()}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy Prompt' }));
    });
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
