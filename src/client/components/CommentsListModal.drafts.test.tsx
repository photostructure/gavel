import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CommentThread } from '../../types/diff';
import { CommentDraftScope, useCommentDraft, type DraftAnchor } from '../hooks/useCommentDrafts';

import { CommentsListModal } from './CommentsListModal';

vi.mock('react-hotkeys-hook', () => ({
  useHotkeys: vi.fn(),
  useHotkeysContext: vi.fn(() => ({ enableScope: vi.fn(), disableScope: vi.fn() })),
  HotkeysProvider: ({ children }: { children: ReactNode }) => children,
}));

const thread: CommentThread = {
  id: 'thread-1',
  file: 'src/file1.ts',
  line: 10,
  side: 'new',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  messages: [
    {
      id: 'message-1',
      body: 'Root comment',
      author: 'User',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
  ],
};

const inDiff: DraftAnchor = { kind: 'line', filePath: 'src/file1.ts', side: 'new', lineNumber: 12 };
const gone: DraftAnchor = { kind: 'line', filePath: 'src/gone.ts', side: 'new', lineNumber: 3 };
const reply: DraftAnchor = { kind: 'reply', threadId: 'thread-1' };

function seed(drafts: [DraftAnchor, string][]) {
  for (const [anchor, body] of drafts) {
    const { result, unmount } = renderHook(() => useCommentDraft(anchor), {
      wrapper: ({ children }) => <CommentDraftScope value="review-a">{children}</CommentDraftScope>,
    });
    act(() => result.current.setBody(body));
    unmount();
  }
}

function renderPanel(overrides: Partial<Parameters<typeof CommentsListModal>[0]> = {}) {
  const props = {
    isOpen: true,
    onClose: vi.fn(),
    onNavigate: vi.fn(),
    unsentDrafts: {
      onNavigateToLine: vi.fn(),
      onAddComment: vi.fn(async () => {}),
      diffFilePaths: new Set(['src/file1.ts']),
      codeFor: () => undefined,
    },
    comments: [thread],
    onToggleThreadResolved: vi.fn(),
    onGenerateThreadPrompt: () => '',
    onReplyToThread: vi.fn(async () => {}),
    onRemoveMessage: vi.fn(),
    onUpdateMessage: vi.fn(),
    ...overrides,
  };
  const { rerender } = render(
    <CommentDraftScope value="review-a">
      <CommentsListModal {...props} />
    </CommentDraftScope>,
  );
  return { props, rerender };
}

const draftsSection = () => within(screen.getByRole('region', { name: 'Unsent drafts' }));

afterEach(() => localStorage.clear());

describe('Conversation unsent drafts', () => {
  it('lists every unsent draft, including ones the diff shows', () => {
    seed([
      [inDiff, 'In the diff'],
      [gone, 'File left the diff'],
      [reply, 'Half a reply'],
    ]);
    renderPanel();
    const section = draftsSection();
    expect(
      section.getAllByRole('textbox').map((box) => (box as HTMLTextAreaElement).value),
    ).toEqual(['In the diff', 'File left the diff']);
    expect(section.getByText('Comment on src/file1.ts line 12')).toBeInTheDocument();
    expect(
      section.getByText('Comment on src/gone.ts line 3, which is not in this diff'),
    ).toBeInTheDocument();
    expect(section.getByRole('button', { name: /Reply on src\/file1\.ts:10/ })).toHaveTextContent(
      'Half a reply',
    );
  });

  it('shows no section without drafts', () => {
    renderPanel();
    expect(screen.queryByRole('region', { name: 'Unsent drafts' })).not.toBeInTheDocument();
  });

  it('sends a draft whose file left the diff and forgets it', async () => {
    seed([[gone, 'File left the diff']]);
    const { props } = renderPanel();
    fireEvent.click(draftsSection().getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(props.unsentDrafts.onAddComment).toHaveBeenCalledWith(
        'src/gone.ts',
        3,
        'File left the diff',
        undefined,
        'new',
        { isQuestion: false, intent: 'comment' },
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Unsent drafts' })).not.toBeInTheDocument(),
    );
  });

  it('closes the panel on Escape and keeps the draft', () => {
    seed([[gone, 'Keep me']]);
    const { props } = renderPanel();
    fireEvent.keyDown(draftsSection().getByRole('textbox'), { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(draftsSection().getByRole('textbox')).toHaveValue('Keep me');
  });

  it('jumps to a draft line the diff shows', () => {
    seed([[inDiff, 'In the diff']]);
    const { props } = renderPanel();
    fireEvent.click(draftsSection().getByRole('button', { name: 'Go to line' }));
    expect(props.unsentDrafts.onNavigateToLine).toHaveBeenCalledWith(inDiff);
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it('offers no jump for a draft whose file left the diff', () => {
    seed([[gone, 'File left the diff']]);
    renderPanel();
    expect(draftsSection().queryByRole('button', { name: 'Go to line' })).not.toBeInTheDocument();
  });

  // The diff may not draw the thread (a later capture dropped its hunk), but its card
  // in the panel always holds the reply form.
  it('shows the thread of a reply draft in the panel, even when its file is in the diff', () => {
    seed([[reply, 'Half a reply']]);
    const { props } = renderPanel();
    fireEvent.click(draftsSection().getByRole('button', { name: /Reply on src\/file1\.ts:10/ }));
    expect(props.onNavigate).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('marks a draft on a deleted thread or message and offers only Discard', () => {
    seed([
      [reply, 'Reply to a deleted thread'],
      [{ kind: 'edit', threadId: 'thread-2', messageId: 'message-2' }, 'Edit of a deleted message'],
    ]);
    const second: CommentThread = {
      ...thread,
      id: 'thread-2',
      messages: [{ ...thread.messages[0]!, id: 'message-2' }],
      deletedMessageIds: ['message-2'],
    };
    renderPanel({ comments: [{ ...thread, deleted: true }, second] });
    const section = draftsSection();
    expect(section.getByRole('button', { name: /Reply on a deleted thread/ })).toBeDisabled();
    expect(section.getByRole('button', { name: /Edit of a deleted message/ })).toBeDisabled();
    expect(section.getAllByRole('button', { name: 'Discard' })).toHaveLength(2);
  });

  it('keeps focus in the panel after a draft is discarded', () => {
    seed([[{ kind: 'reply', threadId: 'deleted-thread' }, 'Orphaned reply']]);
    renderPanel();
    const discard = draftsSection().getByRole('button', { name: 'Discard' });
    discard.focus();
    fireEvent.click(discard);
    expect(screen.getByRole('dialog')).toHaveFocus();
  });

  it('discards a reply draft whose thread is gone', () => {
    seed([[{ kind: 'reply', threadId: 'deleted-thread' }, 'Orphaned reply']]);
    renderPanel();
    const section = draftsSection();
    expect(section.getByText(/a thread that is not loaded/)).toBeInTheDocument();
    fireEvent.click(section.getByRole('button', { name: 'Discard' }));
    expect(screen.queryByRole('region', { name: 'Unsent drafts' })).not.toBeInTheDocument();
    expect(localStorage.length).toBe(0);
  });

  it('sends the code the diff shows now for a draft whose file is in the diff', async () => {
    seed([[inDiff, 'In the diff']]);
    const codeFor = vi.fn(() => 'line 12, as shown now');
    const { props } = renderPanel({
      unsentDrafts: {
        onNavigateToLine: vi.fn(),
        onAddComment: vi.fn(async () => {}),
        diffFilePaths: new Set(['src/file1.ts']),
        codeFor,
      },
    });
    fireEvent.click(draftsSection().getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(props.unsentDrafts.onAddComment).toHaveBeenCalledWith(
        'src/file1.ts',
        12,
        'In the diff',
        'line 12, as shown now',
        'new',
        { isQuestion: false, intent: 'comment' },
      ),
    );
    expect(codeFor).toHaveBeenCalledWith(inDiff);
  });

  it('keeps the panel open and shows the thread there when its file left the diff', async () => {
    seed([[reply, 'Half a reply']]);
    // This thread sorts first, so the panel starts with it selected, not the target.
    const first: CommentThread = {
      ...thread,
      id: 'thread-0',
      file: 'src/a.ts',
      messages: [{ ...thread.messages[0]!, id: 'message-0', body: 'Earlier comment' }],
    };
    const { props } = renderPanel({
      comments: [first, thread],
      unsentDrafts: {
        onNavigateToLine: vi.fn(),
        onAddComment: vi.fn(async () => {}),
        diffFilePaths: new Set(),
        codeFor: () => undefined,
      },
    });
    expect(screen.getByText('Root comment').closest('.ring-blue-500')).toBeNull();
    fireEvent.click(draftsSection().getByRole('button', { name: /Reply on src\/file1\.ts:10/ }));
    expect(props.onNavigate).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByText('Root comment').closest('.ring-blue-500')).not.toBeNull(),
    );
    expect(screen.getByText('Earlier comment').closest('.ring-blue-500')).toBeNull();
  });

  it('closes the panel on Escape in an edit with text and keeps the edit', async () => {
    const { props } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Thread actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit comment' }));
    fireEvent.change(screen.getByPlaceholderText('Edit your message...'), {
      target: { value: 'Reworded' },
    });
    fireEvent.keyDown(screen.getByPlaceholderText('Edit your message...'), { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(screen.getByPlaceholderText('Edit your message...')).toHaveValue('Reworded');
  });

  it('still discards a panel edit on Cancel', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Thread actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit comment' }));
    fireEvent.change(screen.getByPlaceholderText('Edit your message...'), {
      target: { value: 'Reworded' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByPlaceholderText('Edit your message...')).not.toBeInTheDocument();
    expect(localStorage.length).toBe(0);
  });

  // A draft typed in the panel would otherwise add the section above the form being
  // typed in and push it down.
  it('lists a draft started while the panel is open only after the panel reopens', () => {
    const { props, rerender } = renderPanel();
    seed([[reply, 'Started in the panel']]);
    expect(screen.queryByRole('region', { name: 'Unsent drafts' })).not.toBeInTheDocument();
    rerender(
      <CommentDraftScope value="review-a">
        <CommentsListModal {...props} isOpen={false} />
      </CommentDraftScope>,
    );
    rerender(
      <CommentDraftScope value="review-a">
        <CommentsListModal {...props} isOpen />
      </CommentDraftScope>,
    );
    expect(
      draftsSection().getByRole('button', { name: /Reply on src\/file1\.ts:10/ }),
    ).toBeVisible();
  });

  it('drops a listed draft at once when it is sent elsewhere', () => {
    seed([[reply, 'Half a reply']]);
    renderPanel();
    expect(screen.getByRole('region', { name: 'Unsent drafts' })).toBeInTheDocument();
    const { result, unmount } = renderHook(() => useCommentDraft(reply), {
      wrapper: ({ children }) => <CommentDraftScope value="review-a">{children}</CommentDraftScope>,
    });
    act(() => result.current.clear());
    unmount();
    expect(screen.queryByRole('region', { name: 'Unsent drafts' })).not.toBeInTheDocument();
  });

  it('does not list a draft started in the panel after a listed draft with the same key was sent', async () => {
    seed([[reply, 'Half a reply']]);
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Unsent drafts' })).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Write a reply...' }));
    fireEvent.change(screen.getByPlaceholderText('Write a reply...'), {
      target: { value: 'A second reply, started in the panel' },
    });
    expect(screen.queryByRole('region', { name: 'Unsent drafts' })).not.toBeInTheDocument();
  });
});
