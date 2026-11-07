import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { HotkeysProvider } from 'react-hotkeys-hook';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DiffCommentThread } from '../types/diff';
import type { ReviewApproval } from '../types/conversation';

import App from './App';

const callbacks = vi.hoisted(() => ({
  comments: undefined as (() => Promise<void>) | undefined,
  approval: undefined as (() => Promise<void>) | undefined,
}));
vi.mock('./hooks/useFileWatch', () => ({
  useFileWatch: (
    _reload: unknown,
    comments: () => Promise<void>,
    approval: () => Promise<void>,
  ) => {
    callbacks.comments = comments;
    callbacks.approval = approval;
    return {
      shouldReload: false,
      isConnected: true,
      error: null,
      reload: vi.fn(),
      watchState: { isWatchEnabled: false },
    };
  },
}));

const time = '2026-11-03T00:00:00Z';
const messages = (id: string, body: string) => [
  {
    id: `${id}-question`,
    origin: 'user' as const,
    body: 'Please explain',
    createdAt: time,
    updatedAt: time,
  },
  { id, origin: 'agent' as const, author: 'Agent', body, createdAt: time, updatedAt: time },
];

describe('navigating unseen agent replies', () => {
  let threads: DiffCommentThread[];
  let inline: boolean;
  let approvalState: ReviewApproval | null;
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    inline = false;
    approvalState = null;
    localStorage.clear();
    window.history.replaceState(null, '', '/?base=HEAD&target=.');
    vi.stubGlobal(
      'EventSource',
      class {
        close() {}
      },
    );
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    threads = [
      {
        id: 'general',
        scope: 'review',
        createdAt: time,
        updatedAt: time,
        messages: messages('general-answer', 'Agent answer about the whole review'),
      },
      {
        id: 'hidden',
        filePath: 'not-in-diff.ts',
        position: { side: 'new', line: 999 },
        createdAt: time,
        updatedAt: time,
        resolution: { resolved: true, updatedAt: time },
        messages: messages('hidden-answer', 'Agent answer about the hidden file'),
      },
    ];
    vi.mocked(fetch).mockImplementation((input) => {
      const url = new URL(String(input), window.location.origin);
      if (url.pathname === '/api/diff')
        return Promise.resolve(
          Response.json({
            commit: 'fixture',
            repositoryId: 'repo',
            baseCommitish: 'HEAD',
            targetCommitish: '.',
            requestedBaseCommitish: 'HEAD',
            requestedTargetCommitish: '.',
            shipIt: approvalState !== null,
            files: [
              {
                path: 'a.ts',
                status: 'modified',
                additions: 1,
                deletions: 0,
                chunks: inline
                  ? [
                      {
                        header: '@@ -0,0 +1 @@',
                        oldStart: 0,
                        oldLines: 0,
                        newStart: 1,
                        newLines: 1,
                        lines: [
                          { type: 'add', content: 'const example = true;', newLineNumber: 1 },
                        ],
                      },
                    ]
                  : [],
              },
            ],
          }),
        );
      if (url.pathname === '/api/comments-json')
        return Promise.resolve(Response.json({ version: 1, threads }));
      if (url.pathname === '/api/comments')
        return Promise.resolve(Response.json({ success: true, version: 1, threads }));
      if (url.pathname === '/api/conversation/snapshot')
        return Promise.resolve(Response.json({ cursor: 'stream:0', reviews: [] }));
      if (url.pathname === '/api/review-summary')
        return Promise.resolve(Response.json({ commitMessage: '', rationale: '', version: 0 }));
      if (url.pathname === '/api/approval' && approvalState)
        return Promise.resolve(Response.json(approvalState));
      return Promise.resolve(new Response(null, { status: 404 }));
    });
  });

  const mount = () =>
    render(
      <HotkeysProvider initiallyActiveScopes={['navigation']}>
        <App />
      </HotkeysProvider>,
    );

  const expectUnread = (count: number) =>
    waitFor(() =>
      expect(screen.getByRole('button', { name: 'Conversation' })).toHaveAccessibleDescription(
        count
          ? `${count} unread agent message${count === 1 ? '' : 's'}`
          : 'No unread agent messages',
      ),
    );

  it('updates the pending approval label when an approval-change notification arrives', async () => {
    approvalState = {
      approved: false,
      requested: true,
      mode: 'after-comments',
      conditionalSupported: true,
      conditions: threads.map((thread) => ({
        threadId: thread.id,
        messageId: thread.messages[0]?.id ?? '',
        cursor: 'stream:1',
        intent: 'change',
      })),
    };
    mount();
    expect(await screen.findByRole('button', { name: 'Approved · 2 pending' })).toBeVisible();
    const condition = approvalState.conditions?.[0];
    if (!condition) throw new Error('Missing condition');
    condition.addressed = {
      outcome: 'confirmed-by-reviewer',
      evidence: 'Resolved by reviewer',
      updatedAt: time,
    };
    await act(async () => {
      await callbacks.approval?.();
    });
    expect(screen.getByRole('button', { name: 'Approved · 1 pending' })).toBeVisible();
    approvalState = { approved: false, conditionalSupported: true };
    await act(async () => {
      await callbacks.approval?.();
    });
    expect(screen.getByRole('button', { name: 'Approve as-is' })).toHaveClass(
      'bg-github-bg-tertiary',
    );
  });

  it('keeps an inline agent reply unseen while About covers it', async () => {
    inline = true;
    threads.push({
      id: 'inline',
      filePath: 'a.ts',
      position: { side: 'new', line: 1 },
      createdAt: time,
      updatedAt: time,
      messages: messages('inline-answer', 'Inline agent response'),
    });
    const probes: Probe[] = [];
    class Probe {
      active = false;
      node?: Element;
      constructor(readonly callback: IntersectionObserverCallback) {}
      observe(node: Element) {
        this.node = node;
        this.active = true;
        probes.push(this);
      }
      disconnect() {
        this.active = false;
      }
      unobserve() {
        this.active = false;
      }
    }
    vi.stubGlobal('IntersectionObserver', Probe);
    const showInline = () =>
      act(() => {
        for (const probe of probes)
          if (
            probe.active &&
            probe.node?.getAttribute('data-comment-message-id') === 'inline-answer'
          )
            probe.callback(
              [
                {
                  isIntersecting: true,
                  intersectionRatio: 0.5,
                  target: probe.node,
                } as IntersectionObserverEntry,
              ],
              probe as unknown as IntersectionObserver,
            );
      });
    mount();
    await expectUnread(3);
    fireEvent.click(screen.getByRole('button', { name: 'About' }));
    showInline();
    await expectUnread(3);
    fireEvent.click(screen.getByRole('button', { name: 'Close About' }));
    showInline();
    await expectUnread(3);
    const reply = screen
      .getByText('Inline agent response')
      .closest<HTMLElement>('[data-comment-message-id]')!;
    fireEvent.click(within(reply).getByRole('button', { name: 'Mark reply as read' }));
    await expectUnread(2);
  });

  it('changes one reply at a time, ignores closing, and marks all read across filters', async () => {
    threads[0]!.messages.push({
      id: 'second-general-answer',
      origin: 'agent',
      author: 'Agent',
      body: 'Another agent reply in the same thread',
      createdAt: time,
      updatedAt: time,
    });
    mount();
    await expectUnread(3);
    fireEvent.click(screen.getByRole('button', { name: 'Conversation' }));
    const firstReply = screen
      .getByText('Agent answer about the whole review')
      .closest<HTMLElement>('[data-comment-message-id]')!;
    const selection = document.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(screen.getByText('Agent answer about the whole review'));
    selection.addRange(range);
    try {
      fireEvent.click(screen.getByText('Agent answer about the whole review'));
      await expectUnread(3);
    } finally {
      selection.removeAllRanges();
    }
    fireEvent.click(screen.getByText('Agent answer about the whole review'));
    await expectUnread(2);
    fireEvent.click(within(firstReply).getByRole('button', { name: 'Mark reply as unread' }));
    await expectUnread(3);
    fireEvent.click(within(firstReply).getByRole('button', { name: 'Mark reply as read' }));
    await expectUnread(2);
    expect(within(firstReply).getByRole('button', { name: 'Mark reply as unread' })).toBeVisible();
    const sibling = screen
      .getByText('Another agent reply in the same thread')
      .closest<HTMLElement>('[data-comment-message-id]')!;
    expect(within(sibling).getByRole('button', { name: 'Mark reply as read' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Close conversation' }));
    await expectUnread(2);
    fireEvent.click(screen.getByRole('button', { name: 'Conversation' }));
    const reopened = screen
      .getByText('Agent answer about the whole review')
      .closest<HTMLElement>('[data-comment-message-id]')!;
    fireEvent.click(within(reopened).getByRole('button', { name: 'Mark reply as unread' }));
    await expectUnread(3);
    fireEvent.click(screen.getByRole('radio', { name: 'Resolved' }));
    expect(screen.queryByText('Another agent reply in the same thread')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    await expectUnread(0);
    expect(screen.getByRole('button', { name: 'Mark all read' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'Unread' }));
    expect(screen.getByText('No unread threads')).toBeVisible();
    expect(
      vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/api/conversation/status')),
    ).toBe(false);
  });

  it('finds unread replies in Conversation and remembers explicitly marked revisions', async () => {
    const first = mount();
    await expectUnread(2);
    expect(
      screen.queryByRole('button', { name: /Agent updates|new agent update/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Conversation' }));
    const panel = screen.getByRole('dialog', { name: 'Conversation' });
    const filter = within(panel).getByRole('radio', { name: 'Unread' });
    fireEvent.click(filter);
    expect(screen.queryByText('Agent answer about the hidden file')).not.toBeInTheDocument();
    fireEvent.click(
      within(panel).getByRole('button', {
        name: 'Jump to 1 unread agent message in not-in-diff.ts:999',
      }),
    );
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute('data-comment-message-id', 'hidden-answer'),
    );
    await expectUnread(2);
    expect(filter).toBeChecked();
    expect(screen.getByText('Agent answer about the hidden file')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeVisible();
    fireEvent.click(
      within(panel).getByRole('button', {
        name: 'Jump to 1 unread agent message in review conversation',
      }),
    );
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute('data-comment-message-id', 'general-answer'),
    );
    await expectUnread(2);
    // Read threads remain in this reading session instead of disappearing mid-conversation.
    expect(screen.getByText('Agent answer about the hidden file')).toBeVisible();
    expect(screen.getByText('Agent answer about the whole review')).toBeVisible();
    const hiddenReply = screen
      .getByText('Agent answer about the hidden file')
      .closest<HTMLElement>('[data-comment-message-id]')!;
    fireEvent.click(within(hiddenReply).getByRole('button', { name: 'Mark reply as read' }));
    await expectUnread(1);
    const generalReply = screen
      .getByText('Agent answer about the whole review')
      .closest<HTMLElement>('[data-comment-message-id]')!;
    fireEvent.click(within(generalReply).getByRole('button', { name: 'Mark reply as read' }));
    await expectUnread(0);
    fireEvent.click(screen.getByRole('button', { name: 'Close conversation' }));
    await expectUnread(0);
    fireEvent.click(screen.getByRole('button', { name: 'Conversation' }));
    expect(screen.getByText('No unread threads')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Close conversation' }));
    first.unmount();

    mount();
    await expectUnread(0);
    threads = structuredClone(threads);
    threads[1]!.messages[1]!.body = 'A corrected answer about the hidden file';
    await act(async () => {
      await callbacks.comments?.();
    });
    await expectUnread(1);
    fireEvent.click(screen.getByRole('button', { name: 'Conversation' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Unread' }));
    expect(screen.queryByText('Agent answer about the whole review')).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Jump to 1 unread agent message in not-in-diff.ts:999',
      }),
    );
    await expectUnread(1);
    expect(screen.getByText('A corrected answer about the hidden file')).toBeVisible();

    // An edited reply in the same focused thread can be opened again after collapsing it.
    fireEvent.click(screen.getByRole('button', { name: 'Collapse thread' }));
    threads = structuredClone(threads);
    threads[1]!.messages[1]!.body = 'Another corrected answer';
    await act(async () => {
      await callbacks.comments?.();
    });
    await expectUnread(1);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Jump to 1 unread agent message in not-in-diff.ts:999',
      }),
    );
    await expectUnread(1);
    expect(screen.getByText('Another corrected answer')).toBeVisible();

    // Jumping to an edited reply again also works while its thread stays expanded.
    threads = structuredClone(threads);
    threads[1]!.messages[1]!.body = 'The final corrected answer';
    await act(async () => {
      await callbacks.comments?.();
    });
    await expectUnread(1);
    const unreadButton = screen.getByRole('button', {
      name: 'Jump to 1 unread agent message in not-in-diff.ts:999',
    });
    unreadButton.focus();
    fireEvent.click(unreadButton);
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute('data-comment-message-id', 'hidden-answer'),
    );
    await expectUnread(1);
    expect(screen.getByText('The final corrected answer')).toBeVisible();
    const finalReply = screen
      .getByText('The final corrected answer')
      .closest<HTMLElement>('[data-comment-message-id]')!;
    fireEvent.click(within(finalReply).getByRole('button', { name: 'Mark reply as read' }));
    await expectUnread(0);
    fireEvent.click(screen.getByRole('button', { name: 'Close conversation' }));
    await expectUnread(0);
    expect(
      vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/api/conversation/status')),
    ).toBe(false);
  });
});
