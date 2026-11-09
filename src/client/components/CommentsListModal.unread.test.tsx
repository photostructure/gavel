import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useMemo } from 'react';
import { HotkeysProvider } from 'react-hotkeys-hook';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CommentThread } from '../../types/diff';
import { agentMessageRevision, type AgentUpdate } from '../hooks/useAgentUpdates';
import { AgentUpdatesContext } from '../contexts/AgentUpdatesContext';

import { CommentsListModal } from './CommentsListModal';

const time = '2026-11-04T00:00:00Z';
function thread(id: string, replies = 1): CommentThread {
  return {
    id,
    scope: 'review',
    createdAt: time,
    updatedAt: time,
    messages: [
      { id: `${id}-root`, origin: 'user', body: `Root ${id}`, createdAt: time, updatedAt: time },
      ...Array.from({ length: replies }, (_, index) => ({
        id: `${id}-reply-${index}`,
        origin: 'agent' as const,
        body: `Reply ${id} ${index}`,
        createdAt: time,
        updatedAt: time,
      })),
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
const props = {
  isOpen: true,
  onClose: vi.fn(),
  onNavigate: vi.fn(),
  onToggleThreadResolved: vi.fn(),
  onGenerateThreadPrompt: () => '',
  onReplyToThread: vi.fn(async () => {}),
  onRemoveMessage: vi.fn(),
  onUpdateMessage: vi.fn(),
};
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <HotkeysProvider initiallyActiveScopes={['navigation']}>{children}</HotkeysProvider>
);

describe('unread conversations', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('filters current unread threads, including resolved/outdated replies', () => {
    const a = thread('a', 2);
    const b: CommentThread = {
      ...thread('b'),
      scope: 'line',
      file: 'file-b.ts',
      line: 1,
      side: 'new',
      resolution: { resolved: true, updatedAt: time },
      isOutdated: true,
    };
    const read = thread('read');
    const { rerender } = render(
      <CommentsListModal {...props} comments={[a, b, read]} unreadUpdates={updates([a, b])} />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Unread' }));
    expect(
      screen.getByRole('button', {
        name: 'Jump to 2 unread agent messages in review conversation',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Jump to 1 unread agent message in file-b.ts:1' }),
    ).toBeVisible();
    expect(screen.getByLabelText('Outdated comment')).toBeVisible();
    expect(screen.queryByText('Root read')).not.toBeInTheDocument();
    rerender(<CommentsListModal {...props} comments={[a, b, read]} unreadUpdates={[]} />);
    expect(screen.getByText('No unread threads')).toBeVisible();
  });

  it('does not mark replies read on visibility, navigation, filtering, or panel close', async () => {
    const a = thread('a', 2);
    const allUpdates = updates([a]);
    const setRead = vi.fn();
    const onMarkAllRead = vi.fn();
    const visible: (() => void)[] = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(readonly callback: IntersectionObserverCallback) {}
        observe(node: Element) {
          visible.push(() =>
            this.callback(
              [
                {
                  target: node,
                  isIntersecting: true,
                  intersectionRatio: 1,
                } as IntersectionObserverEntry,
              ],
              this as unknown as IntersectionObserver,
            ),
          );
        }
        disconnect() {}
      },
    );
    function View({ isOpen }: { isOpen: boolean }) {
      const readState = useMemo(
        () => ({
          enabled: true,
          unreadKeys: new Set(allUpdates.map((update) => update.key)),
          setRead,
        }),
        [],
      );
      return (
        <AgentUpdatesContext.Provider value={readState}>
          <CommentsListModal
            {...props}
            isOpen={isOpen}
            comments={[a]}
            unreadUpdates={allUpdates}
            onMarkAllRead={onMarkAllRead}
          />
        </AgentUpdatesContext.Provider>
      );
    }
    const { rerender } = render(<View isOpen />, { wrapper });
    act(() => visible.forEach((show) => show()));
    fireEvent.scroll(screen.getByRole('dialog', { name: 'Conversation' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Unread' }));
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Jump to 2 unread agent messages in review conversation',
      }),
    );
    await waitFor(() =>
      expect(screen.getByText('Reply a 0').closest('[data-comment-message-id]')).toHaveFocus(),
    );
    fireEvent.click(screen.getByRole('radio', { name: 'This review' }));
    rerender(<View isOpen={false} />);
    expect(setRead).not.toHaveBeenCalled();
    expect(onMarkAllRead).not.toHaveBeenCalled();
  });

  it('requires an explicit click for Mark all read and disables it when nothing is unread', () => {
    const a = thread('a');
    const onMarkAllRead = vi.fn();
    const { rerender } = render(
      <CommentsListModal
        {...props}
        comments={[a]}
        unreadUpdates={updates([a])}
        onMarkAllRead={onMarkAllRead}
      />,
      { wrapper },
    );
    expect(onMarkAllRead).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(onMarkAllRead).toHaveBeenCalledOnce();
    rerender(
      <CommentsListModal
        {...props}
        comments={[a]}
        unreadUpdates={[]}
        onMarkAllRead={onMarkAllRead}
      />,
    );
    expect(screen.getByRole('button', { name: 'Mark all read' })).toBeDisabled();
  });

  it('clears explicit message focus when switching reviews with overlapping IDs', async () => {
    const a = thread('shared-id');
    const { rerender } = render(
      <CommentsListModal
        {...props}
        readScope="review-a"
        comments={[a]}
        unreadUpdates={updates([a])}
      />,
      { wrapper },
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Jump to 1 unread agent message in review conversation' }),
    );
    const message = screen.getByText('Reply shared-id 0').closest('[data-comment-message-id]');
    await waitFor(() => expect(message).toHaveFocus());
    expect(message).toHaveClass('ring-2');
    const b = { ...thread('shared-id'), resolution: { resolved: true, updatedAt: time } };
    rerender(
      <CommentsListModal {...props} readScope="review-b" comments={[b]} unreadUpdates={[]} />,
    );
    expect(screen.getByRole('button', { name: 'Expand thread' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Expand thread' }));
    expect(
      screen.getByText('Reply shared-id 0').closest('[data-comment-message-id]'),
    ).not.toHaveClass('ring-2');
  });

  it('keeps Tab focus inside Conversation and restores the opener on close', () => {
    const view = (isOpen: boolean) => (
      <>
        <button type="button">Opener</button>
        <CommentsListModal {...props} isOpen={isOpen} comments={[]} />
      </>
    );
    const { rerender } = render(view(false), { wrapper });
    const opener = screen.getByRole('button', { name: 'Opener' });
    opener.focus();
    rerender(view(true));
    const panel = screen.getByRole('dialog', { name: 'Conversation' });
    const close = within(panel).getByRole('button', { name: 'Close conversation' });
    const filter = within(panel).getByRole('radio', { name: 'This review' });
    expect(panel).toHaveFocus();
    fireEvent.keyDown(panel, { key: 'Tab', shiftKey: true });
    expect(filter).toHaveFocus();
    fireEvent.keyDown(filter, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(filter).toHaveFocus();
    rerender(view(false));
    expect(opener).toHaveFocus();
  });
});
