import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ConversationStreamEvent } from '../types/conversation.js';
import type { DiffCommentThread } from '../types/diff.js';

import { Conversation } from './conversation.js';

const selection = { baseCommitish: 'base-sha', targetCommitish: 'target-sha' };
const thread: DiffCommentThread = {
  id: 'thread-a',
  filePath: 'src/a.ts',
  position: { side: 'new', line: { start: 4, end: 6 } },
  codeSnapshot: { content: 'const answer = 42;' },
  createdAt: '2026-10-24T00:00:00Z',
  updatedAt: '2026-10-24T00:00:00Z',
  messages: [
    {
      id: 'question-a',
      body: 'Why 42?\nPlease explain.',
      author: 'User',
      createdAt: '2026-10-24T00:00:00Z',
      updatedAt: '2026-10-24T00:00:00Z',
    },
  ],
};

function observedConversation() {
  const events: ConversationStreamEvent[] = [];
  return { journal: new Conversation((event) => events.push(event)), events };
}

describe('Conversation state and events', () => {
  afterEach(() => vi.useRealTimers());

  it('replays retained events without sharing mutable state or acknowledging delivery', () => {
    const journal = new Conversation();
    const before = journal.cursor;
    journal.update(selection, [], [thread], 'user');
    const batch = journal.read(before);
    expect(batch.events).toHaveLength(1);
    expect(batch.cursor).toBe(journal.cursor);
    batch.events.length = 0;
    expect(journal.read(before).events).toHaveLength(1);
    expect(journal.snapshot().reviews[0]?.threads[0]?.messages[0]?.progress?.status).toBe('queued');
  });

  it('rejects expired, foreign, malformed and future cursors without discarding queued messages', () => {
    const journal = new Conversation(undefined, 2);
    const before = journal.cursor;
    journal.update(selection, [], [thread], 'user');
    journal.setVerdict(selection, 'approve');
    journal.clearVerdict(selection);
    expect(() => journal.read(before)).toThrow('expired');
    expect(journal.read(`${before.split(':')[0]}:1`).events).toHaveLength(2);
    for (const cursor of [
      new Conversation().cursor,
      `${journal.cursor}:extra`,
      `${before.split(':')[0]}:99`,
      `${before.split(':')[0]}:-1`,
    ])
      expect(() => journal.read(cursor)).toThrow('Invalid conversation cursor');
    expect(journal.snapshot().reviews[0]?.threads[0]?.messages[0]?.body).toBe(
      thread.messages[0]?.body,
    );
  });

  it('releases every waiter on activity and cleans up timers on timeout and disconnect', async () => {
    vi.useFakeTimers();
    const journal = new Conversation();
    const abort = new AbortController();
    const first = journal.wait(journal.cursor, 25000, abort.signal);
    const second = journal.wait(journal.cursor, 25000, abort.signal);
    expect(vi.getTimerCount()).toBe(2);
    journal.setVerdict(selection, 'approve');
    expect((await first).events).toHaveLength(1);
    expect((await second).events).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    const timeout = journal.wait(journal.cursor, 25000, abort.signal);
    await vi.advanceTimersByTimeAsync(25000);
    expect((await timeout).events).toEqual([]);
    const disconnected = journal.wait(journal.cursor, 25000, abort.signal);
    abort.abort();
    expect((await disconnected).events).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('emits a comment deletion when a reply is removed from a surviving thread', () => {
    const { journal, events } = observedConversation();
    const replied = {
      ...thread,
      messages: [
        ...thread.messages,
        { ...thread.messages[0]!, id: 'reply', body: 'Answer', origin: 'agent' as const },
      ],
    };
    journal.update(selection, [], [replied], 'user');
    const created = events[0]!;
    events.length = 0;
    journal.update(selection, [replied], [thread], 'user');
    expect(events).toEqual([
      expect.objectContaining({
        type: 'comment.deleted',
        reviewId: created.reviewId,
        threadId: thread.id,
        messageId: 'reply',
        selection,
        origin: 'user',
        cursor: expect.any(String),
        timestamp: expect.any(String),
      }),
    ]);
    expect(events[0]).not.toHaveProperty('body');
    expect(journal.snapshot().reviews[0]?.threads[0]?.messages).toHaveLength(1);
  });

  it('captures review summaries and notifies the event consumer', () => {
    const { journal, events } = observedConversation();
    expect(journal.getSummary(selection)).toEqual({ commitMessage: '', rationale: '', version: 0 });
    const summary = { commitMessage: 'fix: preserve intent', rationale: 'Review why.', version: 1 };
    journal.setSummary(selection, summary);
    expect(events).toEqual([
      expect.objectContaining({ type: 'review.summary', origin: 'agent', summary }),
    ]);
    summary.rationale = 'Changed outside the state';
    expect(journal.snapshot().reviews[0]?.summary.rationale).toBe('Review why.');
  });

  it('emits approval changes and treats repeated state as idempotent', () => {
    const { journal, events } = observedConversation();
    journal.setVerdict(selection, 'approve');
    expect(events).toEqual([
      expect.objectContaining({
        type: 'review.approval',
        approval: expect.objectContaining({ verdict: 'approve' }),
      }),
    ]);
    journal.setVerdict(selection, 'approve');
    expect(events).toHaveLength(1);
    journal.clearVerdict(selection);
    expect(journal.snapshot().reviews[0]?.approval.verdict).toBeUndefined();
    expect(events.slice(1)).toEqual([
      expect.objectContaining({
        type: 'review.approval',
        approval: expect.not.objectContaining({ verdict: expect.anything() }),
      }),
    ]);
    journal.clearVerdict(selection);
    expect(events).toHaveLength(2);
    expect(new Conversation().getApproval(selection).verdict).toBeUndefined();
  });

  it('captures review context, emits edits, and does not repeat unchanged messages', () => {
    const { journal, events } = observedConversation();
    journal.update(selection, [], [thread], 'user');
    const first = events[0]!;
    expect(events).toHaveLength(1);
    expect(first).toMatchObject({
      type: 'comment.created',
      origin: 'user',
      selection,
      threadId: 'thread-a',
      messageId: 'question-a',
      file: 'src/a.ts',
      side: 'new',
      line: { start: 4, end: 6 },
      body: 'Why 42?\nPlease explain.',
      codeSnapshot: thread.codeSnapshot,
    });
    journal.update(selection, [thread], [thread], 'user');
    expect(events).toHaveLength(1);
    const edited = structuredClone(thread);
    edited.messages[0]!.body = 'Why not 43?';
    journal.update(selection, [thread], [edited], 'user');
    expect(events.slice(1)).toEqual([
      expect.objectContaining({
        type: 'comment.updated',
        body: 'Why not 43?',
        reviewId: first.reviewId,
      }),
    ]);
    expect(first).toMatchObject({ body: 'Why 42?\nPlease explain.' });
  });

  it('emits progress per revision without regressing on duplicate receipts', () => {
    const { journal, events } = observedConversation();
    journal.update(selection, [], [thread], 'user');
    const event = events[0]!;
    if (event.type !== 'comment.created') throw new Error('Expected comment event');
    const set = (status: 'delivered' | 'thinking' | 'read' | 'replied') =>
      journal.setProgress(event.reviewId, event.threadId, event.messageId, event.cursor, status);
    const progress = () => journal.snapshot().reviews[0]!.threads[0]!.messages[0]!.progress;
    expect(progress()?.status).toBe('queued');
    set('delivered');
    set('thinking');
    set('read');
    expect(progress()?.status).toBe('thinking');
    expect(events.slice(1)).toEqual([
      expect.objectContaining({
        type: 'comment.progress',
        progress: expect.objectContaining({ status: 'delivered', cursor: event.cursor }),
      }),
      expect.objectContaining({
        type: 'comment.progress',
        progress: expect.objectContaining({ status: 'thinking', cursor: event.cursor }),
      }),
    ]);
    set('replied');
    set('delivered');
    expect(progress()?.status).toBe('replied');
    const edited = structuredClone(thread);
    edited.messages[0]!.body = 'Different question';
    journal.update(selection, [thread], [edited], 'user');
    expect(progress()?.status).toBe('queued');
    expect(() => set('thinking')).toThrow('Comment changed');
    journal.update(selection, [edited], [], 'user');
    expect(() => set('thinking')).toThrow('no longer exists');
  });

  it('notifies consumers only after all messages and progress are saved', () => {
    const observed: unknown[] = [];
    const journal = new Conversation(() => observed.push(journal.snapshot()));
    const second = { ...thread, id: 'second' };
    journal.update(selection, [], [thread, second], 'user');
    expect(observed).toHaveLength(2);
    for (const snapshot of observed)
      expect(snapshot).toMatchObject({
        reviews: [
          {
            threads: [
              { messages: [{ progress: { status: 'queued' } }] },
              { messages: [{ progress: { status: 'queued' } }] },
            ],
          },
        ],
      });
  });

  it('emits resolution, reopening, and thread deletion without repeating comments', () => {
    const { journal, events } = observedConversation();
    journal.update(selection, [], [thread], 'user');
    events.length = 0;
    const resolved = {
      ...thread,
      resolution: { resolved: true, updatedAt: new Date().toISOString() },
    };
    journal.update(selection, [thread], [resolved], 'user');
    journal.update(selection, [resolved], [thread], 'user');
    journal.update(selection, [thread], [], 'agent');
    expect(events.map((event) => event.type)).toEqual([
      'thread.resolved',
      'thread.reopened',
      'thread.deleted',
    ]);
    expect(journal.snapshot().reviews[0]?.threads).toEqual([]);
  });

  it('separates reviews and labels agent responses', () => {
    const { journal, events } = observedConversation();
    journal.update(selection, [], [thread], 'user');
    journal.update({ ...selection, targetCommitish: 'another-sha' }, [], [thread], 'agent');
    expect(events[0]!.reviewId).not.toBe(events[1]!.reviewId);
    expect(events[1]!.origin).toBe('agent');
    expect(journal.findReview(events[0]!.reviewId)?.selection).toEqual(selection);
  });

  it('gives snapshots the latest state cursor and independent servers distinct revision tokens', () => {
    const { journal, events } = observedConversation();
    journal.update(selection, [], [thread], 'user');
    expect(journal.snapshot().cursor).toBe(events.at(-1)?.cursor);
    const other = observedConversation();
    other.journal.update(selection, [], [thread], 'user');
    expect(other.events[0]?.cursor).not.toBe(events[0]?.cursor);
  });
});
