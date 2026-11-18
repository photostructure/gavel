import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ComponentProps, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CommentThread } from '../../types/diff';
import { AgentUpdatesContext, type AgentUpdatesReadState } from '../contexts/AgentUpdatesContext';
import { CommentLinkContext } from '../contexts/CommentLinkContext';
import { CommentDeliveryContext, type CommentDelivery } from '../contexts/CommentDeliveryContext';
import { agentMessageRevision } from '../hooks/useAgentUpdates';
import { CommentDraftScope, draftKey } from '../hooks/useCommentDrafts';

import { deliveryColor } from './AgentDeliveryStatus';
import { CommentThreadCard } from './CommentThreadCard';
import { copyTextToClipboard } from '../utils/clipboard';
vi.mock('../utils/clipboard', () => ({
  copyTextToClipboard: vi.fn().mockResolvedValue(undefined),
}));

// Reply and edit forms save unsent text to localStorage; start each test without it.
afterEach(() => localStorage.clear());

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

// Opens one of the card's action menus and picks an item. Menus render in a portal.
async function chooseAction(
  user: ReturnType<typeof userEvent.setup>,
  menu: 'Thread actions' | 'Reply actions',
  item: string,
  container: HTMLElement = document.body,
) {
  await user.click(within(container).getByRole('button', { name: menu }));
  await user.click(screen.getByRole('menuitem', { name: item }));
}

// Renders `ui` as the review page provides comment delivery to its cards.
const renderWithDelivery = (delivery: CommentDelivery, ui: ReactElement) =>
  render(<CommentDeliveryContext.Provider value={delivery}>{ui}</CommentDeliveryContext.Provider>);

const menuItems = () => screen.getAllByRole('menuitem').map((item) => item.textContent);

const messageElement = (id: string) =>
  document.querySelector<HTMLElement>(`[data-comment-message-id="${id}"]`)!;

describe('thread and reply actions', () => {
  const props = {
    onGeneratePrompt: () => 'thread prompt',
    onToggleThreadResolved: vi.fn(),
    onReplyToThread: vi.fn().mockResolvedValue(undefined),
    onRemoveMessage: vi.fn(),
    onUpdateMessage: vi.fn(),
  };

  it('puts Resolve and the thread actions in the heading row, leaving the root comment full width', () => {
    render(<CommentThreadCard {...props} thread={mockThread} onRemoveThread={vi.fn()} />);

    const headingRow = screen.getByRole('button', { name: 'Collapse thread' }).parentElement!
      .parentElement!;
    expect(within(headingRow).getByRole('button', { name: 'Resolve thread' })).toBeVisible();
    expect(within(headingRow).getByRole('button', { name: 'Thread actions' })).toBeVisible();
    expect(within(messageElement('message-1')).queryAllByRole('button')).toEqual([]);
  });

  // Touch screens show no tooltips, so the menu names every action, the heading's icons included.
  it('lists every thread action, Resolve included, in the thread menu', async () => {
    const user = userEvent.setup();
    const onToggleThreadResolved = vi.fn();
    render(
      <CommentThreadCard
        {...props}
        thread={mockThread}
        onRemoveThread={vi.fn()}
        onToggleThreadResolved={onToggleThreadResolved}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Thread actions' }));
    expect(menuItems()).toEqual(['Resolve thread', 'Copy prompt', 'Edit comment', 'Delete thread']);
    await user.click(screen.getByRole('menuitem', { name: 'Resolve thread' }));

    expect(onToggleThreadResolved).toHaveBeenCalledWith('thread-1');
  });

  it('offers Reopen thread in the menu of an expanded resolved thread', async () => {
    const user = userEvent.setup();
    const onToggleThreadResolved = vi.fn();
    render(
      <CommentThreadCard
        {...props}
        thread={{ ...mockThread, resolution: { resolved: true, updatedAt: mockThread.updatedAt } }}
        onToggleThreadResolved={onToggleThreadResolved}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Expand thread' }));
    await chooseAction(user, 'Thread actions', 'Reopen thread');

    expect(onToggleThreadResolved).toHaveBeenCalledWith('thread-1');
  });

  // The heading acts on the whole thread, so its read toggle covers every agent message in it.
  describe('the thread read toggle', () => {
    const answered: CommentThread = {
      ...mockThread,
      messages: [
        mockThread.messages[0]!,
        { ...mockThread.messages[1]!, origin: 'agent', author: 'Agent' },
        {
          id: 'message-3',
          body: 'Second answer',
          author: 'Agent',
          origin: 'agent',
          createdAt: '2024-01-01T00:02:00Z',
          updatedAt: '2024-01-01T00:02:00Z',
        },
      ],
    };
    const renderWithRead = (readState: AgentUpdatesReadState, thread: CommentThread) =>
      render(
        <AgentUpdatesContext.Provider value={readState}>
          <CommentThreadCard {...props} thread={thread} />
        </AgentUpdatesContext.Provider>,
      );
    const unreadKeys = (...ids: string[]) =>
      new Set(ids.map((id) => JSON.stringify(['thread-1', id])));
    const marks = (setRead: ReturnType<typeof vi.fn>) =>
      setRead.mock.calls.map(([threadId, messageId, , read]) => [threadId, messageId, read]);
    const headingRow = () =>
      screen.getByRole('button', { name: 'Collapse thread' }).parentElement!.parentElement!;

    it('marks every agent message read from the heading while any is unread', async () => {
      const user = userEvent.setup();
      const setRead = vi.fn();
      renderWithRead({ enabled: true, unreadKeys: unreadKeys('message-3'), setRead }, answered);

      await user.click(within(headingRow()).getByRole('button', { name: 'Mark thread as read' }));

      expect(marks(setRead)).toEqual([
        ['thread-1', 'message-2', true],
        ['thread-1', 'message-3', true],
      ]);
    });

    it('marks every agent message unread from the thread menu once all are read', async () => {
      const user = userEvent.setup();
      const setRead = vi.fn();
      renderWithRead({ enabled: true, unreadKeys: new Set(), setRead }, answered);

      await user.click(screen.getByRole('button', { name: 'Thread actions' }));
      expect(menuItems()).toEqual([
        'Resolve thread',
        'Mark thread as unread',
        'Copy prompt',
        'Edit comment',
      ]);
      await user.click(screen.getByRole('menuitem', { name: 'Mark thread as unread' }));

      expect(marks(setRead)).toEqual([
        ['thread-1', 'message-2', false],
        ['thread-1', 'message-3', false],
      ]);
    });

    it('covers an agent-written root comment too', async () => {
      const user = userEvent.setup();
      const setRead = vi.fn();
      renderWithRead(
        { enabled: true, unreadKeys: unreadKeys('message-1'), setRead },
        {
          ...mockThread,
          messages: [{ ...mockThread.messages[0]!, author: 'Agent', origin: 'agent' }],
        },
      );

      await user.click(within(headingRow()).getByRole('button', { name: 'Mark thread as read' }));

      expect(marks(setRead)).toEqual([['thread-1', 'message-1', true]]);
    });

    it('is absent from a thread without agent messages', () => {
      renderWithRead({ enabled: true, unreadKeys: new Set(), setRead: vi.fn() }, mockThread);

      expect(screen.queryByRole('button', { name: /^Mark thread as/ })).not.toBeInTheDocument();
    });

    it('leaves the menu item out while read state is unavailable', async () => {
      const user = userEvent.setup();
      renderWithRead({ enabled: false, unreadKeys: new Set(), setRead: vi.fn() }, answered);

      expect(
        within(headingRow()).getByRole('button', { name: 'Mark thread as unread' }),
      ).toBeDisabled();
      await user.click(screen.getByRole('button', { name: 'Thread actions' }));
      expect(menuItems()).toEqual(['Resolve thread', 'Copy prompt', 'Edit comment']);
    });
  });

  it('opens the root comment editor from the thread menu', async () => {
    const user = userEvent.setup();
    render(<CommentThreadCard {...props} thread={mockThread} />);

    await chooseAction(user, 'Thread actions', 'Edit comment');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Edit your message...')).toHaveFocus();
  });

  it('keeps menu keys from the page hotkeys and returns focus to the trigger on Escape', async () => {
    const user = userEvent.setup();
    const pageKeys = vi.fn();
    document.addEventListener('keydown', pageKeys);
    try {
      render(<CommentThreadCard {...props} thread={mockThread} onRemoveThread={vi.fn()} />);
      const trigger = screen.getByRole('button', { name: 'Thread actions' });
      trigger.focus();

      await user.keyboard('{ArrowDown}');
      expect(screen.getByRole('menuitem', { name: 'Resolve thread' })).toHaveFocus();
      await user.keyboard('{ArrowDown}');
      expect(screen.getByRole('menuitem', { name: 'Copy prompt' })).toHaveFocus();
      await user.keyboard('{Escape}');

      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
      expect(pageKeys).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', pageKeys);
    }
  });

  it('offers copy, edit and delete for your own reply', async () => {
    const user = userEvent.setup();
    const onRemoveMessage = vi.fn();
    render(
      <CommentThreadCard
        {...props}
        onRemoveMessage={onRemoveMessage}
        thread={{
          ...mockThread,
          messages: [mockThread.messages[0]!, { ...mockThread.messages[1]!, author: 'User' }],
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Reply actions' }));
    expect(menuItems()).toEqual(['Copy reply', 'Edit reply', 'Delete reply']);
    await user.click(screen.getByRole('menuitem', { name: 'Delete reply' }));

    expect(onRemoveMessage).toHaveBeenCalledWith('thread-1', 'message-2');
  });

  // GitHub shows deleted accounts as ghost; their imported comments are no agent's.
  it('shows a comment from a deleted GitHub account as hat-and-glasses, not the robot', () => {
    render(
      <CommentThreadCard
        {...props}
        thread={{
          ...mockThread,
          messages: [{ ...mockThread.messages[0]!, author: 'ghost', origin: 'agent' }],
        }}
      />,
    );

    const icon = screen.getByRole('img', { name: 'Deleted GitHub account' }).querySelector('svg');
    expect(icon).toHaveClass('lucide-hat-glasses');
    expect(icon).not.toHaveAttribute('data-robot');
  });

  it('shows the robot on an agent comment that names no author', () => {
    render(
      <CommentThreadCard
        {...props}
        thread={{
          ...mockThread,
          messages: [{ ...mockThread.messages[0]!, author: undefined, origin: 'agent' }],
        }}
      />,
    );

    const icon = screen.getByRole('img', { name: 'Agent' });
    expect(icon.querySelector('svg[data-robot]')).not.toBeNull();
  });

  it('tells your replies from the agent by origin, not by the author name', async () => {
    const user = userEvent.setup();
    render(
      <CommentThreadCard
        {...props}
        thread={{
          ...mockThread,
          messages: [
            mockThread.messages[0]!,
            { ...mockThread.messages[1]!, id: 'yours', author: 'Ada Lovelace' },
            { ...mockThread.messages[1]!, id: 'agent', author: 'User', origin: 'agent' },
          ],
        }}
      />,
    );

    const [yours, agent] = screen.getAllByRole('button', { name: 'Reply actions' });
    await user.click(yours!);
    expect(menuItems()).toEqual(['Copy reply', 'Edit reply', 'Delete reply']);
    await user.keyboard('{Escape}');
    await user.click(agent!);
    expect(menuItems()).toEqual(['Copy reply']);
    // The icon follows origin too; the name is its label.
    const robot = (element: HTMLElement) => element.querySelector('svg[data-robot]') !== null;
    expect(robot(screen.getByRole('img', { name: 'Ada Lovelace' }))).toBe(false);
    expect(screen.getAllByRole('img', { name: 'User' }).map(robot)).toEqual([false, true]);
  });

  it('shows no actions on a thread from another review', () => {
    render(<CommentThreadCard {...props} thread={mockThread} readOnly onRemoveThread={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Resolve thread' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thread actions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reply actions' })).not.toBeInTheDocument();
  });
});

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
    expect(screen.queryByRole('button', { name: 'Resolve thread' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(onToggleThreadResolved).toHaveBeenCalledWith('thread-1');
  });

  // Your comment's progress has three looks: unplugged while it cannot reach the agent, dashed
  // while it waits to be sent, and a spinner once the agent has it. Noted or replied shows none.
  it.each([
    ['queued', false, 'lucide-circle-dashed', 'Queued'],
    ['queued', true, 'lucide-unplug', "Not sent: the agent can't be reached"],
    ['delivered', false, 'lucide-loader-circle', 'Delivered'],
    ['read', false, 'lucide-loader-circle', 'Read'],
    ['thinking', false, 'lucide-loader-circle', 'Thinking'],
    ['replying', true, 'lucide-loader-circle', 'Replying'],
  ] as const)('shows %s progress (delivery down: %s) as %s', (status, down, icon, label) => {
    renderWithDelivery(
      { down, unsent: new Set() },
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

    const progress = screen.getByRole('status');
    expect(progress).toHaveTextContent(label);
    expect(progress.querySelector('svg')).toHaveClass(icon);
    // Unplugged takes the dead header robot's red.
    if (icon === 'lucide-unplug')
      expect(progress.querySelector('svg')).toHaveClass(deliveryColor('disconnected'));
    // Progress takes the author icon's place until the agent is done.
    expect(screen.queryByRole('img', { name: 'User' })).not.toBeInTheDocument();
  });

  // A reply made offline waits in the page with no progress from the server yet.
  it.each([
    [true, 'lucide-unplug', "Not sent: the agent can't be reached"],
    [false, 'lucide-circle-dashed', 'Waiting to send'],
  ] as const)(
    'shows a message still in this page (delivery down: %s) as %s',
    (down, icon, label) => {
      const root = mockThread.messages[0]!;
      renderWithDelivery(
        { down, unsent: new Set([root.id]) },
        <CommentThreadCard
          thread={{ ...mockThread, messages: [root] }}
          onGeneratePrompt={() => ''}
          onToggleThreadResolved={vi.fn()}
          onReplyToThread={vi.fn()}
          onRemoveMessage={vi.fn()}
          onUpdateMessage={vi.fn()}
        />,
      );

      const progress = screen.getByRole('status');
      expect(progress).toHaveTextContent(label);
      expect(progress.querySelector('svg')).toHaveClass(icon);
    },
  );

  it.each(['noted', 'replied'] as const)('shows no progress once %s', (status) => {
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

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'User' })).toBeInTheDocument();
  });

  it('does not show delete action for replies authored by someone else', async () => {
    const user = userEvent.setup();
    render(
      <CommentThreadCard
        thread={{
          ...mockThread,
          messages: [mockThread.messages[0]!, { ...mockThread.messages[1]!, origin: 'agent' }],
        }}
        onGeneratePrompt={() => 'thread prompt'}
        onToggleThreadResolved={vi.fn()}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={vi.fn()}
        onUpdateMessage={vi.fn()}
      />,
    );

    expect(screen.getByText('Reply comment')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reply actions' }));
    expect(menuItems()).toEqual(['Copy reply']);
  });

  it('allows resolving and editing imported root comments', async () => {
    const user = userEvent.setup();
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
    await user.click(screen.getByRole('button', { name: 'Thread actions' }));
    expect(screen.getByRole('menuitem', { name: 'Edit comment' })).toBeInTheDocument();
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
    expect(screen.queryByRole('button', { name: 'Thread actions' })).not.toBeInTheDocument();
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

  // The diff table sets font-mono; the card must not inherit it for comment prose.
  it('sets the sans-serif font on the card and keeps inline code monospace', () => {
    const thread: CommentThread = {
      ...mockThread,
      messages: [{ ...mockThread.messages[0]!, body: 'Rename `value` here' }],
    };
    const { container } = render(
      <div className="font-mono">
        <CommentThreadCard
          thread={thread}
          onGeneratePrompt={() => 'thread prompt'}
          onToggleThreadResolved={vi.fn()}
          onReplyToThread={vi.fn().mockResolvedValue(undefined)}
          onRemoveMessage={vi.fn()}
          onUpdateMessage={vi.fn()}
        />
      </div>,
    );

    expect(container.querySelector('[data-comment-thread-id="thread-1"]')).toHaveClass('font-sans');
    expect(screen.getByText('value', { selector: 'code' })).toHaveClass('font-mono');
  });

  it('deletes the root thread from the thread menu', async () => {
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

    await chooseAction(user, 'Thread actions', 'Delete thread');

    expect(onRemoveThread).toHaveBeenCalledWith('thread-1');
    expect(onToggleThreadResolved).not.toHaveBeenCalled();
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

    await chooseAction(user, 'Reply actions', 'Copy reply');

    expect(copyTextToClipboard).toHaveBeenCalledWith('Reply comment');
    expect(screen.getByRole('button', { name: 'Copied!' })).toBeInTheDocument();
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
      expect(button.nextElementSibling).toBe(screen.getByRole('button', { name: 'Reply actions' }));

      fireEvent.click(button);
      expect(setRead).toHaveBeenCalledWith('thread-1', 'message-2', expect.any(String), unread);
    },
  );

  it('keeps the read dot beside the reply and labels it in the reply menu', async () => {
    const user = userEvent.setup();
    const setRead = vi.fn();
    renderWithReadState({
      enabled: true,
      unreadKeys: new Set([JSON.stringify(['thread-1', 'message-2'])]),
      setRead,
    });
    const reply = messageElement('message-2');

    expect(
      within(reply)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Mark reply as read', 'Reply actions']);
    await user.click(within(reply).getByRole('button', { name: 'Reply actions' }));
    expect(menuItems()).toEqual(['Mark reply as read', 'Copy reply']);
    await user.click(screen.getByRole('menuitem', { name: 'Mark reply as read' }));

    expect(setRead).toHaveBeenCalledWith('thread-1', 'message-2', expect.any(String), true);
  });

  // Following a link means the reader read the message, as a click on its text does.
  describe('links in an agent reply', () => {
    const linkedThread: CommentThread = {
      ...agentThread,
      messages: [
        agentThread.messages[0]!,
        {
          ...agentThread.messages[1]!,
          // mailto: rather than https:, which happy-dom would fetch over the network.
          body: 'See [the parser](#thread=tour-2) or [email the author](mailto:author@example.com).',
        },
      ],
    };
    const renderWithLinks = (
      readState: AgentUpdatesReadState,
      follow: () => void,
      props: Partial<ComponentProps<typeof CommentThreadCard>>,
    ) =>
      render(
        <AgentUpdatesContext.Provider value={readState}>
          <CommentLinkContext.Provider value={follow}>
            <CommentThreadCard
              thread={linkedThread}
              onGeneratePrompt={() => ''}
              onToggleThreadResolved={vi.fn()}
              onReplyToThread={vi.fn().mockResolvedValue(undefined)}
              onRemoveMessage={vi.fn()}
              onUpdateMessage={vi.fn()}
              {...props}
            />
          </CommentLinkContext.Provider>
        </AgentUpdatesContext.Provider>,
      );
    const renderLinked = (props: Partial<ComponentProps<typeof CommentThreadCard>> = {}) => {
      const follow = vi.fn();
      const setRead = vi.fn();
      renderWithLinks(
        {
          enabled: true,
          unreadKeys: new Set([JSON.stringify(['thread-1', 'message-2'])]),
          setRead,
        },
        follow,
        props,
      );
      return { follow, setRead };
    };

    it.each(['the parser', 'email the author'])(
      'marks the reply read when %s is clicked',
      (name) => {
        const { setRead } = renderLinked();
        fireEvent.click(screen.getByRole('link', { name }));
        expect(setRead).toHaveBeenCalledWith(
          'thread-1',
          'message-2',
          agentMessageRevision(linkedThread.messages[1]!),
          true,
        );
      },
    );

    it('still follows the gavel link', () => {
      const { follow } = renderLinked();
      fireEvent.click(screen.getByRole('link', { name: 'the parser' }));
      expect(follow).toHaveBeenCalledWith('#thread=tour-2', { threadId: 'thread-1' });
    });

    it("leaves another review's reply to its read controls, as a click on its text does", () => {
      const { setRead } = renderLinked({ readOnly: true });
      fireEvent.click(screen.getByRole('link', { name: 'email the author' }));
      expect(setRead).not.toHaveBeenCalled();
    });
  });
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

  // Resolve closes a thread that needs nothing more without waking the agent; a typed reply
  // says anything else.
  it('offers only an empty reply box after an agent reply', () => {
    renderThread({ thread: agentAnswered });

    const reply = screen.getByPlaceholderText('Write a reply...');
    expect(reply).toHaveValue('');
    expect(reply).not.toHaveFocus();
    expect(within(reply.closest('form')!).queryAllByRole('button')).toEqual([]);
  });

  it('shows Send once the reply box has text and empties the box after sending', async () => {
    const user = userEvent.setup();
    const onReplyToThread = vi.fn().mockResolvedValue(undefined);
    const onClick = vi.fn();
    renderThread({ thread: agentAnswered, onReplyToThread, onClick });

    const reply = screen.getByPlaceholderText('Write a reply...');
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    await user.type(reply, 'A new reply');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(onReplyToThread).toHaveBeenCalledWith('thread-1', 'A new reply');
    expect(screen.getByPlaceholderText('Write a reply...')).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    expect(localStorage.length).toBe(0);
    expect(onClick).not.toHaveBeenCalled();
  });

  // Escape leaves the empty box, so page keys and the Conversation panel's Escape work again.
  it('forgets an emptied reply draft on Escape and leaves the empty box', async () => {
    const user = userEvent.setup();
    renderThread();

    const reply = screen.getByPlaceholderText('Write a reply...');
    await user.type(reply, 'x');
    await user.clear(reply);
    expect(localStorage.length).toBe(1);
    await user.keyboard('{Escape}');

    expect(localStorage.length).toBe(0);
    expect(reply).toHaveValue('');
    expect(reply).not.toHaveFocus();
  });

  it('discards a reply draft with Cancel and keeps the empty box', async () => {
    const user = userEvent.setup();
    const onReplyToThread = vi.fn().mockResolvedValue(undefined);
    renderThread({ onReplyToThread });

    await user.type(screen.getByPlaceholderText('Write a reply...'), 'Never mind');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onReplyToThread).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('Write a reply...')).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(localStorage.length).toBe(0);
  });

  it('keeps a reply draft across Escape and outside clicks', async () => {
    const user = userEvent.setup();
    const onEscapeKeepingDraft = vi.fn();
    renderThread({ onEscapeKeepingDraft });

    const reply = screen.getByPlaceholderText('Write a reply...');
    await user.type(reply, 'Keep this draft');
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Outside thread' }));

    expect(onEscapeKeepingDraft).toHaveBeenCalledOnce();
    expect(reply).toBeVisible();
    expect(reply).toHaveValue('Keep this draft');
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
      expect(screen.getByPlaceholderText('Write a reply...')).toBeVisible();
      expect(onClick).not.toHaveBeenCalled();
    },
  );

  describe('heading row', () => {
    const heading = `${mockThread.file}:${mockThread.line}`;
    const resolved: CommentThread = {
      ...mockThread,
      resolution: { resolved: true, updatedAt: mockThread.updatedAt },
    };

    // Clicking non-interactive heading text focuses the nearest focusable ancestor. The card's
    // focus handler expands a collapsed thread, which the click would then collapse again.
    it('expands a collapsed thread with one click on the heading', async () => {
      const user = userEvent.setup();
      renderThread({ thread: resolved });

      await user.click(screen.getByText(heading));

      expect(screen.getByRole('button', { name: 'Collapse thread' })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
    });

    it('toggles from the empty space in the row', () => {
      renderThread();
      const disclosure = screen.getByRole('button', { name: 'Collapse thread' });

      fireEvent.click(disclosure.parentElement!.parentElement!);

      expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    });

    it('keeps the file path selectable by leaving it outside the disclosure button', () => {
      renderThread();

      expect(screen.getByText(heading).closest('button')).toBeNull();
    });

    it('leaves the thread alone when the click ends a text selection', () => {
      renderThread();
      const path = screen.getByText(heading);
      const selection = document.getSelection()!;
      const range = document.createRange();
      range.selectNodeContents(path);
      // An earlier user.click leaves a caret range behind, and addRange ignores a second range.
      selection.removeAllRanges();
      selection.addRange(range);

      try {
        fireEvent.click(path);
      } finally {
        selection.removeAllRanges();
      }

      expect(screen.getByRole('button', { name: 'Collapse thread' })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
    });

    it('does nothing when the heading of a deleted thread is clicked', () => {
      const onClick = vi.fn();
      renderThread({ thread: { ...mockThread, deleted: true }, onClick });

      fireEvent.click(screen.getByText(heading));

      expect(screen.getByRole('button', { name: 'Expand thread' })).toBeDisabled();
      expect(screen.queryByText('Reply comment')).not.toBeInTheDocument();
      expect(onClick).not.toHaveBeenCalled();
    });
  });

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

  it('keeps Copy prompt independent from disclosure and navigation', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderThread({ onClick });

    await chooseAction(user, 'Thread actions', 'Copy prompt');

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
  const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
  const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
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
    fireEvent.click(screen.getByRole('button', { name: 'Thread actions' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Copy prompt' }));
    });
    // The menu's focus handling schedules timers of its own, so look for the copy's 2 s reset.
    const resetIndex = setTimeoutSpy.mock.calls.findIndex(([, delay]) => delay === 2000);
    expect(resetIndex).not.toBe(-1);
    const reset: unknown = setTimeoutSpy.mock.results[resetIndex]!.value;
    expect(clearTimeoutSpy).not.toHaveBeenCalledWith(reset);
    view.unmount();
    expect(clearTimeoutSpy).toHaveBeenCalledWith(reset);
  } finally {
    setTimeoutSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
    vi.useRealTimers();
  }
});

describe('thread drafts', () => {
  const renderCard = () =>
    render(
      <CommentDraftScope value="review-a">
        <CommentThreadCard
          thread={mockThread}
          onGeneratePrompt={() => 'thread prompt'}
          onToggleThreadResolved={vi.fn()}
          onReplyToThread={vi.fn().mockResolvedValue(undefined)}
          onRemoveMessage={vi.fn()}
          onUpdateMessage={vi.fn()}
        />
      </CommentDraftScope>,
    );

  const replyAnchor = { kind: 'reply', threadId: 'thread-1' } as const;
  const editAnchor = { kind: 'edit', threadId: 'thread-1', messageId: 'message-1' } as const;
  const draftsKey = 'gavel:comment-drafts:review-a';
  const storedDraft = (anchor: typeof replyAnchor | typeof editAnchor, body: string) =>
    JSON.stringify({
      [draftKey(anchor)]: { anchor, body, updatedAt: Date.now() },
    });
  const announceOtherTabChange = () =>
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: draftsKey }));
    });

  it('shows the text of a reply another tab starts', async () => {
    const user = userEvent.setup();
    renderCard();
    expect(screen.getByPlaceholderText('Write a reply...')).toHaveValue('');

    localStorage.setItem(draftsKey, storedDraft(replyAnchor, 'From the other tab'));
    announceOtherTabChange();

    const form = screen.getByPlaceholderText('Write a reply...');
    expect(form).toHaveValue('From the other tab');
    expect(form).not.toHaveFocus();
    await user.type(form, ', continued here');
    expect(screen.getByPlaceholderText('Write a reply...')).toHaveValue(
      'From the other tab, continued here',
    );
  });

  it('empties a restored reply box when another tab sends that reply', () => {
    localStorage.setItem(draftsKey, storedDraft(replyAnchor, 'Sent from the other tab'));
    renderCard();
    expect(screen.getByPlaceholderText('Write a reply...')).toHaveValue('Sent from the other tab');

    localStorage.removeItem(draftsKey);
    announceOtherTabChange();

    expect(screen.getByPlaceholderText('Write a reply...')).toHaveValue('');
  });

  it('opens a closed edit form when another tab starts that edit', async () => {
    const user = userEvent.setup();
    renderCard();
    expect(screen.queryByPlaceholderText('Edit your message...')).not.toBeInTheDocument();

    localStorage.setItem(draftsKey, storedDraft(editAnchor, 'Edited in the other tab'));
    announceOtherTabChange();

    const form = screen.getByPlaceholderText('Edit your message...');
    expect(form).toHaveValue('Edited in the other tab');
    expect(form).not.toHaveFocus();
    await user.type(form, ', continued here');
    expect(screen.getByPlaceholderText('Edit your message...')).toHaveValue(
      'Edited in the other tab, continued here',
    );
  });

  it('closes a restored edit form when another tab saves that edit', () => {
    localStorage.setItem(draftsKey, storedDraft(editAnchor, 'Saved from the other tab'));
    renderCard();
    expect(screen.getByPlaceholderText('Edit your message...')).toBeInTheDocument();

    localStorage.removeItem(draftsKey);
    announceOtherTabChange();

    expect(screen.queryByPlaceholderText('Edit your message...')).not.toBeInTheDocument();
  });

  it('restores the text of a reply draft after the page remounts', async () => {
    const user = userEvent.setup();
    const first = renderCard();
    await user.type(screen.getByPlaceholderText('Write a reply...'), 'Half a reply');
    first.unmount();

    renderCard();
    expect(screen.getByPlaceholderText('Write a reply...')).toHaveValue('Half a reply');
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('reopens an unsaved edit with its text after the page remounts', async () => {
    const user = userEvent.setup();
    const first = renderCard();
    await chooseAction(user, 'Thread actions', 'Edit comment');
    const box = screen.getByPlaceholderText('Edit your message...');
    await user.clear(box);
    await user.type(box, 'Reworded root');
    first.unmount();

    renderCard();
    expect(screen.getByPlaceholderText('Edit your message...')).toHaveValue('Reworded root');
  });

  it('forgets an unsaved edit on Cancel', async () => {
    const user = userEvent.setup();
    const first = renderCard();
    await chooseAction(user, 'Thread actions', 'Edit comment');
    await user.type(screen.getByPlaceholderText('Edit your message...'), ' and more');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    first.unmount();

    renderCard();
    expect(screen.queryByPlaceholderText('Edit your message...')).not.toBeInTheDocument();
  });

  it('keeps an edit open on Escape in the diff', async () => {
    const user = userEvent.setup();
    const first = renderCard();
    await chooseAction(user, 'Thread actions', 'Edit comment');
    await user.type(screen.getByPlaceholderText('Edit your message...'), ' and more');
    await user.keyboard('{Escape}');
    expect(screen.getByPlaceholderText('Edit your message...')).toHaveValue(
      'Root comment and more',
    );
    first.unmount();
    renderCard();
    expect(screen.getByPlaceholderText('Edit your message...')).toHaveValue(
      'Root comment and more',
    );
  });

  // Nothing is unsaved, so Escape closes the editor; the posted message stays.
  it('closes an unchanged edit on Escape in the diff', async () => {
    const user = userEvent.setup();
    renderCard();
    await chooseAction(user, 'Thread actions', 'Edit comment');
    await user.keyboard('{Escape}');
    expect(screen.queryByPlaceholderText('Edit your message...')).not.toBeInTheDocument();
    expect(screen.getByText('Root comment')).toBeInTheDocument();
  });
});

describe('thread drafts across saves, copies, and resolution', () => {
  const resolved: CommentThread = {
    ...mockThread,
    resolution: { resolved: true, updatedAt: mockThread.updatedAt },
  };
  const card = (thread: CommentThread) => (
    <CommentThreadCard
      thread={thread}
      onGeneratePrompt={() => 'thread prompt'}
      onToggleThreadResolved={vi.fn()}
      onReplyToThread={vi.fn().mockResolvedValue(undefined)}
      onRemoveMessage={vi.fn()}
      onUpdateMessage={vi.fn()}
    />
  );

  it('forgets an edit once it is saved', async () => {
    const user = userEvent.setup();
    const first = render(
      <CommentDraftScope value="review-a">{card(mockThread)}</CommentDraftScope>,
    );
    await chooseAction(user, 'Thread actions', 'Edit comment');
    await user.type(screen.getByPlaceholderText('Edit your message...'), ' and more');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    first.unmount();
    render(<CommentDraftScope value="review-a">{card(mockThread)}</CommentDraftScope>);
    expect(screen.queryByPlaceholderText('Edit your message...')).not.toBeInTheDocument();
    expect(localStorage.length).toBe(0);
  });

  it('shows a reply typed in one copy of the thread in the other, keeping focus where it was typed', async () => {
    const user = userEvent.setup();
    render(
      <CommentDraftScope value="review-a">
        <div data-testid="panel">{card(mockThread)}</div>
        <div data-testid="diff">{card(mockThread)}</div>
      </CommentDraftScope>,
    );
    const panel = within(screen.getByTestId('panel'));
    const diff = within(screen.getByTestId('diff'));
    await user.type(panel.getByPlaceholderText('Write a reply...'), 'Typed here');
    expect(panel.getByPlaceholderText('Write a reply...')).toHaveFocus();
    expect(panel.getByPlaceholderText('Write a reply...')).toHaveValue('Typed here');
    expect(diff.getByPlaceholderText('Write a reply...')).toHaveValue('Typed here');
    expect(diff.getByPlaceholderText('Write a reply...')).not.toHaveFocus();
  });

  function otherTabSavesAnotherDraft() {
    const storageKey = 'gavel:comment-drafts:review-a';
    const anchor = { kind: 'reply', threadId: 'another-thread' } as const;
    const drafts = JSON.parse(localStorage.getItem(storageKey)!) as Record<string, unknown>;
    drafts[draftKey(anchor)] = {
      anchor,
      body: 'From the other tab',
      updatedAt: Date.now(),
    };
    localStorage.setItem(storageKey, JSON.stringify(drafts));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: storageKey }));
    });
  }

  it('keeps a reply in both copies of the thread when another tab changes a different draft', async () => {
    const user = userEvent.setup();
    render(
      <CommentDraftScope value="review-a">
        <div data-testid="panel">{card(mockThread)}</div>
        <div data-testid="diff">{card(mockThread)}</div>
      </CommentDraftScope>,
    );
    const panel = within(screen.getByTestId('panel'));
    await user.type(panel.getByPlaceholderText('Write a reply...'), 'Typed here');

    otherTabSavesAnotherDraft();

    expect(panel.getByPlaceholderText('Write a reply...')).toHaveValue('Typed here');
    expect(panel.getByPlaceholderText('Write a reply...')).toHaveFocus();
    expect(within(screen.getByTestId('diff')).getByPlaceholderText('Write a reply...')).toHaveValue(
      'Typed here',
    );
  });

  it('keeps the other copy of an edit closed when another tab changes a different draft', async () => {
    const user = userEvent.setup();
    render(
      <CommentDraftScope value="review-a">
        <div data-testid="panel">{card(mockThread)}</div>
        <div data-testid="diff">{card(mockThread)}</div>
      </CommentDraftScope>,
    );
    const panel = within(screen.getByTestId('panel'));
    await chooseAction(user, 'Thread actions', 'Edit comment', screen.getByTestId('panel'));
    await user.type(panel.getByPlaceholderText('Edit your message...'), ' and more');

    otherTabSavesAnotherDraft();

    expect(panel.getByPlaceholderText('Edit your message...')).toHaveValue('Root comment and more');
    expect(
      within(screen.getByTestId('diff')).queryByPlaceholderText('Edit your message...'),
    ).not.toBeInTheDocument();
  });

  it('opens an edit only in the copy where Edit was clicked', async () => {
    const user = userEvent.setup();
    render(
      <CommentDraftScope value="review-a">
        <div data-testid="panel">{card(mockThread)}</div>
        <div data-testid="diff">{card(mockThread)}</div>
      </CommentDraftScope>,
    );
    const panel = within(screen.getByTestId('panel'));
    await chooseAction(user, 'Thread actions', 'Edit comment', screen.getByTestId('panel'));
    await user.clear(panel.getByPlaceholderText('Edit your message...'));
    expect(
      within(screen.getByTestId('diff')).queryByPlaceholderText('Edit your message...'),
    ).not.toBeInTheDocument();
    expect(panel.getByPlaceholderText('Edit your message...')).toHaveValue('');
  });

  it('expands a resolved thread that holds a reply draft', async () => {
    const user = userEvent.setup();
    const first = render(<CommentDraftScope value="review-a">{card(resolved)}</CommentDraftScope>);
    await user.click(screen.getByRole('button', { name: 'Expand thread' }));
    await user.type(screen.getByPlaceholderText('Write a reply...'), 'Reopen this');
    first.unmount();
    render(<CommentDraftScope value="review-a">{card(resolved)}</CommentDraftScope>);
    expect(screen.getByPlaceholderText('Write a reply...')).toHaveValue('Reopen this');
  });

  it('keeps a restored reply box editable after its text is cleared', async () => {
    const user = userEvent.setup();
    const first = render(
      <CommentDraftScope value="review-a">{card(mockThread)}</CommentDraftScope>,
    );
    await user.type(screen.getByPlaceholderText('Write a reply...'), 'Half a reply');
    first.unmount();
    render(<CommentDraftScope value="review-a">{card(mockThread)}</CommentDraftScope>);
    await user.clear(screen.getByPlaceholderText('Write a reply...'));
    expect(screen.getByPlaceholderText('Write a reply...')).toHaveFocus();
    await user.type(screen.getByPlaceholderText('Write a reply...'), 'Rewritten');
    expect(screen.getByPlaceholderText('Write a reply...')).toHaveValue('Rewritten');
  });

  it('marks reply and edit forms with their draft keys', async () => {
    const user = userEvent.setup();
    render(<CommentDraftScope value="review-a">{card(mockThread)}</CommentDraftScope>);
    await chooseAction(user, 'Thread actions', 'Edit comment');
    expect(screen.getByPlaceholderText('Write a reply...').closest('form')).toHaveAttribute(
      'data-draft-key',
      draftKey({ kind: 'reply', threadId: 'thread-1' }),
    );
    expect(screen.getByPlaceholderText('Edit your message...').closest('form')).toHaveAttribute(
      'data-draft-key',
      draftKey({ kind: 'edit', threadId: 'thread-1', messageId: 'message-1' }),
    );
  });
});
