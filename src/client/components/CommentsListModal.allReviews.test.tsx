import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { HotkeysProvider } from 'react-hotkeys-hook';
import { describe, expect, it, vi } from 'vitest';

import type { CommentThread } from '../../types/diff';
import { createDiffSelection } from '../../utils/diffSelection';
import { AgentUpdatesContext } from '../contexts/AgentUpdatesContext';
import { CommentLinkContext } from '../contexts/CommentLinkContext';
import { agentMessageRevision, type AgentUpdate } from '../hooks/useAgentUpdates';

import { CommentsListModal, type OtherReviewConversation } from './CommentsListModal';

const time = '2026-11-09T00:00:00Z';
function thread(id: string): CommentThread {
  return {
    id,
    scope: 'review',
    createdAt: time,
    updatedAt: time,
    messages: [
      { id: `${id}-root`, origin: 'user', body: `Root ${id}`, createdAt: time, updatedAt: time },
      { id: `${id}-reply`, origin: 'agent', body: `Reply ${id}`, createdAt: time, updatedAt: time },
    ],
  };
}
function updates(threads: CommentThread[]): AgentUpdate[] {
  return threads.flatMap((item) =>
    item.messages
      .filter((message) => message.origin === 'agent')
      .map((message) => ({
        key: JSON.stringify([item.id, message.id]),
        thread: item,
        message,
        revision: agentMessageRevision(message),
      })),
  );
}
function otherReview(name: string, threads: CommentThread[]): OtherReviewConversation {
  return {
    key: name,
    name,
    selection: createDiffSelection('base', 'target', undefined, name),
    threads,
    showAuthorBadges: false,
  };
}

const current = thread('current');
const elsewhere = thread('elsewhere');
const unread = updates([current, elsewhere]);
const setRead = vi.fn();
const baseProps = {
  isOpen: true,
  onClose: vi.fn(),
  onNavigate: vi.fn(),
  onToggleThreadResolved: vi.fn(),
  onGenerateThreadPrompt: () => '',
  onReplyToThread: vi.fn(async () => {}),
  onRemoveMessage: vi.fn(),
  onUpdateMessage: vi.fn(),
  comments: [current],
  currentReviewName: 'first',
};
const others = [otherReview('second', [elsewhere])];
const readContext = { enabled: true, unreadKeys: new Set(unread.map((u) => u.key)), setRead };

function renderPanel(props: Partial<React.ComponentProps<typeof CommentsListModal>> = {}) {
  return render(
    <HotkeysProvider initiallyActiveScopes={['navigation']}>
      <AgentUpdatesContext.Provider value={readContext}>
        <CommentsListModal {...baseProps} {...props} />
      </AgentUpdatesContext.Provider>
    </HotkeysProvider>,
  );
}

describe('conversations across reviews', () => {
  it('labels the default filter This review and offers All reviews only with another review', () => {
    const { unmount } = renderPanel();
    expect(screen.getByRole('radio', { name: 'This review' })).toBeChecked();
    expect(screen.queryByRole('radio', { name: 'All reviews' })).not.toBeInTheDocument();
    unmount();
    renderPanel({ otherReviews: others });
    expect(screen.getByRole('radio', { name: 'All reviews' })).toBeVisible();
    expect(screen.getByText('Root current')).toBeVisible();
    expect(screen.queryByText('Root elsewhere')).not.toBeInTheDocument();
  });

  it('groups every review under its tab name in All reviews', () => {
    renderPanel({ otherReviews: others });
    fireEvent.click(screen.getByRole('radio', { name: 'All reviews' }));
    const first = screen.getByRole('heading', { name: 'first' });
    const second = screen.getByRole('heading', { name: 'second' });
    expect(first.compareDocumentPosition(screen.getByText('Root current'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(second.compareDocumentPosition(screen.getByText('Root elsewhere'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getByText('1 of 2 threads')).toBeVisible();
  });

  it('lists unread replies from every review under Unread', () => {
    const read = thread('already-read');
    renderPanel({
      otherReviews: [otherReview('second', [elsewhere, read])],
      unreadUpdates: unread,
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Unread' }));
    expect(screen.getByText('Root current')).toBeVisible();
    expect(screen.getByText('Root elsewhere')).toBeVisible();
    expect(screen.queryByText('Root already-read')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'second' })).toBeVisible();
  });

  it('keeps Open and Resolved on the open review', () => {
    renderPanel({ otherReviews: others, unreadUpdates: unread });
    fireEvent.click(screen.getByRole('radio', { name: 'Open' }));
    expect(screen.queryByText('Root elsewhere')).not.toBeInTheDocument();
  });

  it("offers only read controls and click-through on another review's thread", () => {
    const onOpenOtherReviewThread = vi.fn();
    renderPanel({ otherReviews: others, unreadUpdates: unread, onOpenOtherReviewThread });
    fireEvent.click(screen.getByRole('radio', { name: 'All reviews' }));
    const card = screen
      .getByText('Root elsewhere')
      .closest<HTMLElement>('[data-comment-thread-id]')!;
    expect(within(card).queryByText('Write a reply...')).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Resolve thread' })).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Thread actions' })).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Reply actions' })).toBeNull();

    fireEvent.click(within(card).getByRole('button', { name: 'Mark reply as read' }));
    expect(setRead).toHaveBeenCalledWith(
      'elsewhere',
      'elsewhere-reply',
      agentMessageRevision(elsewhere.messages[1]!),
      true,
    );
    expect(onOpenOtherReviewThread).not.toHaveBeenCalled();

    fireEvent.click(card);
    expect(onOpenOtherReviewThread).toHaveBeenCalledWith(others[0], 'elsewhere');
    expect(baseProps.onClose).not.toHaveBeenCalled();
  });

  it("keeps a reply unread when its text is clicked on another review's card", () => {
    const onOpenOtherReviewThread = vi.fn();
    setRead.mockClear();
    renderPanel({ otherReviews: others, unreadUpdates: unread, onOpenOtherReviewThread });
    fireEvent.click(screen.getByRole('radio', { name: 'Unread' }));
    fireEvent.click(screen.getByText('Reply elsewhere'));
    expect(setRead).not.toHaveBeenCalled();
    expect(onOpenOtherReviewThread).toHaveBeenCalledWith(others[0], 'elsewhere');
  });

  it("opens another review's thread with Enter and never resolves it with d", () => {
    const onOpenOtherReviewThread = vi.fn();
    const onToggleThreadResolved = vi.fn();
    renderPanel({ otherReviews: others, onOpenOtherReviewThread, onToggleThreadResolved });
    fireEvent.click(screen.getByRole('radio', { name: 'All reviews' }));
    fireEvent.keyDown(document.body, { key: 'j', code: 'KeyJ' });
    expect(screen.getByText('2 of 2 threads')).toBeVisible();
    fireEvent.keyDown(document.body, { key: 'd', code: 'KeyD' });
    expect(onToggleThreadResolved).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'Enter', code: 'Enter' });
    expect(onOpenOtherReviewThread).toHaveBeenCalledWith(others[0], 'elsewhere');
  });

  it("marks links in a deleted review's comments as coming from a deleted review", () => {
    const follow = vi.fn();
    const linked = {
      ...thread('linked'),
      messages: [{ ...thread('linked').messages[0]!, body: '[next](#thread=t9)' }],
    };
    const deleted = { ...otherReview('gone', [linked]), deleted: true as const };
    render(
      <HotkeysProvider initiallyActiveScopes={['navigation']}>
        <AgentUpdatesContext.Provider value={readContext}>
          <CommentLinkContext.Provider value={follow}>
            <CommentsListModal {...baseProps} otherReviews={[deleted]} />
          </CommentLinkContext.Provider>
        </AgentUpdatesContext.Provider>
      </HotkeysProvider>,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'All reviews' }));
    fireEvent.click(screen.getByRole('link', { name: 'next' }));
    expect(follow).toHaveBeenCalledWith(
      '#thread=t9',
      expect.objectContaining({ threadId: 'linked', deleted: true }),
    );
  });

  it("labels a deleted review's threads and does not open them", () => {
    const onOpenOtherReviewThread = vi.fn();
    const deleted = { ...otherReview('gone', [elsewhere]), deleted: true as const };
    renderPanel({ otherReviews: [deleted], onOpenOtherReviewThread });
    fireEvent.click(screen.getByRole('radio', { name: 'All reviews' }));
    expect(screen.getByRole('heading', { name: 'gone (deleted)' })).toBeVisible();
    fireEvent.click(
      screen.getByText('Root elsewhere').closest<HTMLElement>('[data-comment-thread-id]')!,
    );
    fireEvent.keyDown(document.body, { key: 'Enter', code: 'Enter' });
    expect(onOpenOtherReviewThread).not.toHaveBeenCalled();
  });

  it('marks one review or every review read with separate buttons', () => {
    const onMarkAllRead = vi.fn();
    const onMarkAllReviewsRead = vi.fn();
    renderPanel({
      otherReviews: others,
      unreadUpdates: updates([elsewhere]),
      onMarkAllRead,
      onMarkAllReviewsRead,
    });
    expect(screen.queryByRole('button', { name: 'Mark all read' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark this review read' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Mark all reviews read' }));
    expect(onMarkAllReviewsRead).toHaveBeenCalledOnce();
    expect(onMarkAllRead).not.toHaveBeenCalled();
  });

  it('focuses the requested thread once it arrives, showing it under This review', async () => {
    const onThreadFocused = vi.fn();
    const props = { focusThreadId: 'elsewhere', onThreadFocused };
    const { rerender } = renderPanel(props);
    expect(onThreadFocused).not.toHaveBeenCalled();
    rerender(
      <HotkeysProvider initiallyActiveScopes={['navigation']}>
        <AgentUpdatesContext.Provider value={readContext}>
          <CommentsListModal
            {...baseProps}
            {...props}
            comments={[elsewhere]}
            unreadUpdates={updates([elsewhere])}
          />
        </AgentUpdatesContext.Provider>
      </HotkeysProvider>,
    );
    expect(screen.getByRole('radio', { name: 'This review' })).toBeChecked();
    await waitFor(() =>
      expect(
        screen.getByText('Reply elsewhere').closest('[data-comment-message-id]'),
      ).toHaveFocus(),
    );
    expect(onThreadFocused).toHaveBeenCalledOnce();
    expect(screen.getByText('Write a reply...')).toBeVisible();
  });
});
