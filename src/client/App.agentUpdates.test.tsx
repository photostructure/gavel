import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { HotkeysProvider } from 'react-hotkeys-hook';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DiffCommentThread } from '../types/diff';
import type { ReviewApproval } from '../types/conversation';

import App from './App';
import { MockWebSocket } from './utils/liveConnection.testing';

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
  let otherThreads: DiffCommentThread[];
  let inline: boolean;
  let approvalState: ReviewApproval | null;
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    inline = false;
    approvalState = null;
    otherThreads = [];
    localStorage.clear();
    window.history.replaceState(null, '', '/?base=HEAD&target=.');
    vi.stubGlobal('WebSocket', MockWebSocket);
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
      if (url.pathname === '/api/diff' && url.searchParams.get('review') === 'other')
        return Promise.resolve(
          Response.json({
            commit: 'Review: other',
            repositoryId: 'repo',
            capture: {
              name: 'other',
              version: 1,
              patchDigest: 'other-digest',
              repositoryId: 'repo',
              baseCommit: 'other-base',
            },
            baseCommitish: 'other-base',
            targetCommitish: '.',
            requestedBaseCommitish: 'other-base',
            requestedTargetCommitish: '.',
            files: [],
          }),
        );
      if (url.pathname === '/api/comments-json' && url.searchParams.get('review') === 'other')
        return Promise.resolve(Response.json({ version: 1, threads: otherThreads }));
      if (url.pathname === '/api/diff')
        return Promise.resolve(
          Response.json({
            commit: 'fixture',
            title: 'Fixture review',
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
        return Promise.resolve(
          Response.json({
            cursor: 'stream:0',
            reviews: otherThreads.length
              ? [
                  {
                    id: 'open',
                    selection: { baseCommitish: 'HEAD', targetCommitish: '.' },
                    threads,
                    approval: {},
                    summary: { commitMessage: '', rationale: '', version: 0 },
                  },
                  {
                    id: 'other',
                    selection: {
                      baseCommitish: 'other-base',
                      targetCommitish: '.',
                      reviewName: 'other',
                    },
                    threads: otherThreads,
                    approval: {},
                    summary: { commitMessage: '', rationale: '', version: 0 },
                    capture: { name: 'other' },
                  },
                ]
              : [],
          }),
        );
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

  it('counts replies from every review and opens another review at its unread thread', async () => {
    otherThreads = [
      {
        id: 'elsewhere',
        scope: 'review',
        createdAt: time,
        updatedAt: time,
        messages: messages('elsewhere-answer', 'Agent answer in another review'),
      },
    ];
    mount();
    await expectUnread(3);

    otherThreads[0]!.messages.push({
      id: 'elsewhere-followup',
      origin: 'agent',
      body: 'A later answer in another review',
      createdAt: time,
      updatedAt: time,
    });
    await act(() => callbacks.comments!());
    await expectUnread(4);

    fireEvent.click(screen.getByRole('button', { name: 'Conversation' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Unread' }));
    expect(screen.getByRole('heading', { name: 'other' })).toBeVisible();
    const first = screen
      .getByText('Agent answer in another review')
      .closest<HTMLElement>('[data-comment-message-id]')!;
    fireEvent.click(within(first).getByRole('button', { name: 'Mark reply as read' }));
    await expectUnread(3);

    fireEvent.click(first.closest('[data-comment-thread-id]')!);
    await waitFor(() =>
      expect(
        vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('review=other')),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute(
        'data-comment-message-id',
        'elsewhere-followup',
      ),
    );
    expect(screen.getByRole('radio', { name: 'This review' })).toBeChecked();
    expect(screen.getByText('Write a reply...')).toBeVisible();

    // Returning to a review shows its cached threads before its unread state is ready.
    fireEvent.click(screen.getByRole('radio', { name: 'Unread' }));
    fireEvent.click(
      screen
        .getByText('Agent answer about the whole review')
        .closest<HTMLElement>('[data-comment-thread-id]')!,
    );
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute('data-comment-message-id', 'general-answer'),
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Unread' }));
    fireEvent.click(
      screen
        .getByText('A later answer in another review')
        .closest<HTMLElement>('[data-comment-thread-id]')!,
    );
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute(
        'data-comment-message-id',
        'elsewhere-followup',
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Mark this review read' }));
    await expectUnread(2);
    fireEvent.click(screen.getByRole('button', { name: 'Mark all reviews read' }));
    await expectUnread(0);
  });

  it('shows the unread count in the page title and pulses the badge for a new reply only', async () => {
    otherThreads = [
      {
        id: 'elsewhere',
        scope: 'review',
        createdAt: time,
        updatedAt: time,
        messages: messages('elsewhere-answer', 'Agent answer in another review'),
      },
    ];
    mount();
    await expectUnread(3);
    await waitFor(() => expect(document.title).toBe('(3) Fixture review'));
    const conversation = screen.getByRole('button', { name: 'Conversation' });
    expect(conversation.querySelector('[class*="unread-pulse"]')).toBeNull();
    expect(
      within(screen.getByRole('navigation', { name: 'Reviews on this server' })).getByRole(
        'button',
        { name: /other/ },
      ),
    ).toHaveTextContent('unread replies');

    otherThreads[0]!.messages.push({
      id: 'elsewhere-followup',
      origin: 'agent',
      body: 'A later answer in another review',
      createdAt: time,
      updatedAt: time,
    });
    await act(() => callbacks.comments!());
    await expectUnread(4);
    expect(document.title).toBe('(4) Fixture review');
    await waitFor(() =>
      expect(conversation.querySelector('[class*="unread-pulse-"]')).not.toBeNull(),
    );
    expect(conversation.className).not.toMatch(/unread-pulse/);

    fireEvent.click(conversation);
    fireEvent.click(screen.getByRole('button', { name: 'Mark all reviews read' }));
    await expectUnread(0);
    expect(document.title).toBe('Fixture review');
  });

  it('clears the approval label when an approval-change notification arrives', async () => {
    approvalState = { verdict: 'after-comments', conditionalSupported: true };
    mount();
    expect(await screen.findByRole('button', { name: 'Approved after comments' })).toBeVisible();
    approvalState = { conditionalSupported: true };
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
    const generalCard = screen
      .getByText('Agent answer about the whole review')
      .closest<HTMLElement>('[data-comment-thread-id]')!;
    fireEvent.click(within(generalCard).getByRole('button', { name: 'Collapse thread' }));
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

    // An edited reply can be jumped to again once its thread is collapsed.
    threads = structuredClone(threads);
    threads[1]!.messages[1]!.body = 'The final corrected answer';
    await act(async () => {
      await callbacks.comments?.();
    });
    await expectUnread(1);
    fireEvent.click(
      within(
        screen
          .getByText('The final corrected answer')
          .closest<HTMLElement>('[data-comment-thread-id]')!,
      ).getByRole('button', { name: 'Collapse thread' }),
    );
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
