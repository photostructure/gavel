import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { HotkeysProvider } from 'react-hotkeys-hook';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { CommentThread } from '../../types/diff';

import { CommentsListModal } from './CommentsListModal';

vi.mock('react-hotkeys-hook', () => ({
  useHotkeys: vi.fn(),
  useHotkeysContext: vi.fn(() => ({
    enableScope: vi.fn(),
    disableScope: vi.fn(),
  })),
  HotkeysProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const mockThreads: CommentThread[] = [
  {
    id: 'thread-1',
    file: 'src/file1.ts',
    line: 10,
    side: 'new',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    codeContent: 'const value = 1;',
    messages: [
      {
        id: 'thread-1',
        body: 'First root comment',
        author: 'User',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
      {
        id: 'reply-1',
        body: 'First reply',
        author: 'Reviewer',
        createdAt: '2024-01-01T00:01:00Z',
        updatedAt: '2024-01-01T00:01:00Z',
      },
    ],
  },
  {
    id: 'thread-2',
    file: 'src/file2.ts',
    line: [20, 25],
    side: 'new',
    createdAt: '2024-01-01T00:02:00Z',
    updatedAt: '2024-01-01T00:02:00Z',
    messages: [
      {
        id: 'thread-2',
        body: 'Second root comment',
        author: 'User',
        createdAt: '2024-01-01T00:02:00Z',
        updatedAt: '2024-01-01T00:02:00Z',
      },
    ],
  },
];

const mockRemoveThread = vi.fn();
const mockGenerateThreadPrompt = vi.fn().mockReturnValue('thread prompt');
const mockReplyToThread = vi.fn().mockResolvedValue(undefined);
const mockRemoveMessage = vi.fn();
const mockUpdateMessage = vi.fn();

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <HotkeysProvider initiallyActiveScopes={['global']}>{children}</HotkeysProvider>
);

describe('CommentsListModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a general question and filters resolved conversations without navigating', async () => {
    const user = userEvent.setup();
    const onAddGeneralComment = vi.fn();
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    const general: CommentThread = {
      id: 'general',
      scope: 'review',
      createdAt: '2024-01-01',
      updatedAt: '2024-01-02',
      resolution: { resolved: true, updatedAt: '2024-01-02' },
      messages: [
        {
          id: 'general-msg',
          body: 'Review-wide question',
          intent: 'question',
          author: 'User',
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
        },
      ],
    };
    render(
      <CommentsListModal
        isOpen
        onClose={onClose}
        onNavigate={onNavigate}
        comments={[...mockThreads, general]}
        onToggleThreadResolved={mockRemoveThread}
        onRemoveThread={vi.fn()}
        onGenerateThreadPrompt={mockGenerateThreadPrompt}
        onReplyToThread={mockReplyToThread}
        onRemoveMessage={mockRemoveMessage}
        onUpdateMessage={mockUpdateMessage}
        onAddGeneralComment={onAddGeneralComment}
      />,
      { wrapper },
    );
    await user.type(
      screen.getByPlaceholderText('Comment or ask about this review…'),
      'How does this work?',
    );
    const composer = within(
      screen.getByPlaceholderText('Comment or ask about this review…').closest('form')!,
    );
    await user.click(composer.getByRole('radio', { name: 'Question' }));
    await user.click(composer.getByRole('button', { name: 'Send' }));
    expect(onAddGeneralComment).toHaveBeenCalledWith('How does this work?', {
      isQuestion: true,
      intent: 'question',
    });
    await user.click(screen.getByRole('radio', { name: 'Resolved' }));
    expect(screen.queryByText('First root comment')).not.toBeInTheDocument();
    await user.click(screen.getByText('Review conversation'));
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(mockRemoveThread).toHaveBeenCalledWith('general');
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('radio', { name: 'Open' }));
    expect(screen.getByText('First root comment')).toBeInTheDocument();
    expect(screen.queryByText('Review conversation')).not.toBeInTheDocument();
  });

  it('does not render when closed', () => {
    const { container } = render(
      <CommentsListModal
        isOpen={false}
        onClose={vi.fn()}
        onNavigate={vi.fn()}
        comments={mockThreads}
        onToggleThreadResolved={mockRemoveThread}
        onGenerateThreadPrompt={mockGenerateThreadPrompt}
        onReplyToThread={mockReplyToThread}
        onRemoveMessage={mockRemoveMessage}
        onUpdateMessage={mockUpdateMessage}
      />,
      { wrapper },
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders thread content when open', () => {
    render(
      <CommentsListModal
        isOpen={true}
        onClose={vi.fn()}
        onNavigate={vi.fn()}
        comments={mockThreads}
        onToggleThreadResolved={mockRemoveThread}
        onGenerateThreadPrompt={mockGenerateThreadPrompt}
        onReplyToThread={mockReplyToThread}
        onRemoveMessage={mockRemoveMessage}
        onUpdateMessage={mockUpdateMessage}
      />,
      { wrapper },
    );

    expect(screen.getByText('Conversation')).toBeInTheDocument();
    expect(screen.getByText('First root comment')).toBeInTheDocument();
    expect(screen.getByText('First reply')).toBeInTheDocument();
    expect(screen.getByText('Second root comment')).toBeInTheDocument();
    expect(screen.getByText('src/file1.ts:10')).toBeInTheDocument();
    expect(screen.getByText('src/file2.ts:20-25')).toBeInTheDocument();
  });

  it('heads the panel with its title, then actions, then filters, outside the scrolling threads', () => {
    render(
      <CommentsListModal
        isOpen
        onClose={vi.fn()}
        onNavigate={vi.fn()}
        comments={mockThreads}
        onToggleThreadResolved={mockRemoveThread}
        onGenerateThreadPrompt={mockGenerateThreadPrompt}
        onReplyToThread={mockReplyToThread}
        onRemoveMessage={mockRemoveMessage}
        onUpdateMessage={mockUpdateMessage}
        headerActions={<button type="button">Copy All Prompt</button>}
      />,
      { wrapper },
    );
    const title = screen.getByRole('heading', { name: 'Conversation' });
    const action = screen.getByRole('button', { name: 'Copy All Prompt' });
    const filter = screen.getByRole('radiogroup', { name: 'Conversation filter' });
    expect(title.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(action.compareDocumentPosition(filter) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(filter.closest('.overflow-y-auto')).toBeNull();
  });

  it('shows author badges when enabled', () => {
    render(
      <CommentsListModal
        isOpen={true}
        onClose={vi.fn()}
        onNavigate={vi.fn()}
        comments={mockThreads}
        showAuthorBadges={true}
        onToggleThreadResolved={mockRemoveThread}
        onGenerateThreadPrompt={mockGenerateThreadPrompt}
        onReplyToThread={mockReplyToThread}
        onRemoveMessage={mockRemoveMessage}
        onUpdateMessage={mockUpdateMessage}
      />,
      { wrapper },
    );

    expect(screen.getAllByText('User').length).toBeGreaterThan(0);
    expect(screen.getByText('Reviewer')).toBeInTheDocument();
  });

  it('navigates when clicking a thread', () => {
    const onClose = vi.fn();
    const onNavigate = vi.fn();

    render(
      <CommentsListModal
        isOpen={true}
        onClose={onClose}
        onNavigate={onNavigate}
        comments={mockThreads}
        onToggleThreadResolved={mockRemoveThread}
        onGenerateThreadPrompt={mockGenerateThreadPrompt}
        onReplyToThread={mockReplyToThread}
        onRemoveMessage={mockRemoveMessage}
        onUpdateMessage={mockUpdateMessage}
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByText('First root comment'));

    expect(onNavigate).toHaveBeenCalledWith(mockThreads[0]);
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps the modal open when the click finishes a text selection inside a thread', () => {
    const onClose = vi.fn();
    const onNavigate = vi.fn();

    render(
      <CommentsListModal
        isOpen={true}
        onClose={onClose}
        onNavigate={onNavigate}
        comments={mockThreads}
        onToggleThreadResolved={mockRemoveThread}
        onRemoveThread={mockRemoveThread}
        onGenerateThreadPrompt={mockGenerateThreadPrompt}
        onReplyToThread={mockReplyToThread}
        onRemoveMessage={mockRemoveMessage}
        onUpdateMessage={mockUpdateMessage}
      />,
      { wrapper },
    );

    const commentText = screen.getByText('First root comment');
    const range = document.createRange();
    range.selectNodeContents(commentText);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(selection.toString()).toBe('First root comment');

    fireEvent.click(commentText);

    expect(onNavigate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    selection.removeAllRanges();
    fireEvent.click(commentText);

    expect(onNavigate).toHaveBeenCalledWith(mockThreads[0]);
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps the modal open when clicking inside the reply form', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onNavigate = vi.fn();

    render(
      <CommentsListModal
        isOpen={true}
        onClose={onClose}
        onNavigate={onNavigate}
        comments={mockThreads}
        onToggleThreadResolved={mockRemoveThread}
        onGenerateThreadPrompt={mockGenerateThreadPrompt}
        onReplyToThread={mockReplyToThread}
        onRemoveMessage={mockRemoveMessage}
        onUpdateMessage={mockUpdateMessage}
      />,
      { wrapper },
    );

    await user.click(screen.getAllByRole('button', { name: 'Write a reply...' })[0]!);
    await user.click(screen.getByPlaceholderText('Write a reply...'));

    expect(
      within(screen.getByPlaceholderText('Write a reply...').closest('form')!).getByText(
        'Reply to thread',
      ),
    ).toBeInTheDocument();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('toggles a thread from its filename without closing or navigating', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onNavigate = vi.fn();
    render(
      <CommentsListModal
        isOpen
        onClose={onClose}
        onNavigate={onNavigate}
        comments={mockThreads}
        onToggleThreadResolved={mockRemoveThread}
        onGenerateThreadPrompt={mockGenerateThreadPrompt}
        onReplyToThread={mockReplyToThread}
        onRemoveMessage={mockRemoveMessage}
        onUpdateMessage={mockUpdateMessage}
      />,
      { wrapper },
    );

    const heading = screen.getByText(`${mockThreads[0]!.file}:${mockThreads[0]!.line}`);
    const disclosure = within(heading.closest<HTMLElement>('[data-comment-thread-id]')!).getByRole(
      'button',
      { name: 'Collapse thread' },
    );
    await user.click(heading);
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await user.click(heading);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  // Escape in a panel form that holds text closes the panel; an unchanged edit has
  // nothing to keep, so the panel just closes.
  it('closes the modal without navigating on Escape in an unchanged edit', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onNavigate = vi.fn();

    render(
      <CommentsListModal
        isOpen={true}
        onClose={onClose}
        onNavigate={onNavigate}
        comments={mockThreads}
        onToggleThreadResolved={mockRemoveThread}
        onGenerateThreadPrompt={mockGenerateThreadPrompt}
        onReplyToThread={mockReplyToThread}
        onRemoveMessage={mockRemoveMessage}
        onUpdateMessage={mockUpdateMessage}
      />,
      { wrapper },
    );

    await user.click(screen.getAllByRole('button', { name: 'Thread actions' })[0]!);
    await user.click(screen.getByRole('menuitem', { name: 'Edit comment' }));
    await user.keyboard('{Escape}');

    expect(onNavigate).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('resolves with one inline confirmation from the resolve button', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal('confirm', confirmSpy);

    render(
      <CommentsListModal
        isOpen={true}
        onClose={vi.fn()}
        onNavigate={vi.fn()}
        comments={mockThreads}
        onToggleThreadResolved={mockRemoveThread}
        onGenerateThreadPrompt={mockGenerateThreadPrompt}
        onReplyToThread={mockReplyToThread}
        onRemoveMessage={mockRemoveMessage}
        onUpdateMessage={mockUpdateMessage}
      />,
      { wrapper },
    );

    await user.click(screen.getAllByTitle('Resolve thread')[0]!);

    expect(mockRemoveThread).toHaveBeenCalledWith('thread-1');
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('shows empty state when there are no threads', () => {
    render(
      <CommentsListModal
        isOpen={true}
        onClose={vi.fn()}
        onNavigate={vi.fn()}
        comments={[]}
        onToggleThreadResolved={mockRemoveThread}
        onGenerateThreadPrompt={mockGenerateThreadPrompt}
        onReplyToThread={mockReplyToThread}
        onRemoveMessage={mockRemoveMessage}
        onUpdateMessage={mockUpdateMessage}
      />,
      { wrapper },
    );

    expect(screen.getByText('No comments yet')).toBeInTheDocument();
  });
});
