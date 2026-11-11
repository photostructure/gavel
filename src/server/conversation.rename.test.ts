import { describe, expect, it } from 'vitest';

import type { ConversationStreamEvent } from '../types/conversation.js';
import type { DiffCommentThread } from '../types/diff.js';
import type { NamedReviewMetadata } from '../types/review.js';

import { Conversation } from './conversation.js';

const base = 'a'.repeat(40);
const selection = (reviewName: string) => ({
  baseCommitish: base,
  targetCommitish: '.',
  reviewName,
});
const capture = (name: string): NamedReviewMetadata => ({
  name,
  version: 1,
  patchDigest: 'b'.repeat(64),
  baseCommit: base,
  repositoryId: 'c'.repeat(64),
});
const thread: DiffCommentThread = {
  id: 'thread',
  filePath: 'a.ts',
  position: { side: 'new', line: 3 },
  createdAt: '2026-11-10T00:00:00Z',
  updatedAt: '2026-11-10T00:00:00Z',
  messages: [
    {
      id: 'message',
      body: 'Keep this.',
      createdAt: '2026-11-10T00:00:00Z',
      updatedAt: '2026-11-10T00:00:00Z',
    },
  ],
};

function started(events: ConversationStreamEvent[] = []) {
  const conversation = new Conversation((event) => events.push(event));
  conversation.setCapture(selection('task'), capture('task'));
  conversation.update(selection('task'), [], [thread], 'user');
  conversation.setVerdict(selection('task'), 'reject');
  return conversation;
}

describe('renaming and deleting a named review', () => {
  it('keeps the review ID, threads and verdict under the new name', () => {
    const events: ConversationStreamEvent[] = [];
    const conversation = started(events);
    const { id } = conversation.snapshot().reviews[0]!;

    conversation.rename('task', selection('renamed'), capture('renamed'));

    const [review, ...rest] = conversation.snapshot().reviews;
    expect(rest).toEqual([]);
    expect(review).toMatchObject({
      id,
      selection: selection('renamed'),
      capture: capture('renamed'),
      threads: [expect.objectContaining({ id: 'thread' })],
      approval: expect.objectContaining({ verdict: 'reject' }),
    });
    expect(conversation.getThreads(selection('renamed')).map((entry) => entry.id)).toEqual([
      'thread',
    ]);
    expect(events.at(-1)).toMatchObject({
      type: 'review.renamed',
      origin: 'agent',
      reviewId: id,
      previousName: 'task',
      selection: selection('renamed'),
      capture: capture('renamed'),
    });
  });

  // Tabs and the next review needing a verdict follow the snapshot's order, which is creation order.
  it('keeps a renamed review in its place among the others', () => {
    const conversation = new Conversation(() => {});
    for (const name of ['part-a', 'part-b', 'part-c'])
      conversation.setCapture(selection(name), capture(name));

    conversation.rename('part-b', selection('part-b-fixed'), capture('part-b-fixed'));

    expect(conversation.snapshot().reviews.map((review) => review.selection.reviewName)).toEqual([
      'part-a',
      'part-b-fixed',
      'part-c',
    ]);
  });

  it('moves a deleted review out of reviews, keeps its threads read-only, and frees its name', () => {
    const events: ConversationStreamEvent[] = [];
    const conversation = started(events);
    const { id } = conversation.snapshot().reviews[0]!;

    conversation.delete(selection('task'));

    const snapshot = conversation.snapshot();
    expect(snapshot.reviews).toEqual([]);
    expect(snapshot.deletedReviews).toEqual([
      expect.objectContaining({
        id,
        selection: selection('task'),
        capture: capture('task'),
        threads: [expect.objectContaining({ id: 'thread' })],
        deletedAt: expect.any(String),
      }),
    ]);
    expect(conversation.findReview(id)).toBeUndefined();
    expect(events.at(-1)).toMatchObject({
      type: 'review.deleted',
      origin: 'agent',
      reviewId: id,
      selection: selection('task'),
    });

    // A new review with the old name starts empty and keeps the deleted one's threads apart.
    conversation.setCapture(selection('task'), capture('task'));
    const fresh = conversation.snapshot().reviews[0]!;
    expect(fresh.id).not.toBe(id);
    expect(fresh.threads).toEqual([]);
    expect(conversation.snapshot().deletedReviews?.[0]?.id).toBe(id);
  });

  it('omits deletedReviews from a snapshot until a review is deleted', () => {
    expect(started().snapshot()).not.toHaveProperty('deletedReviews');
  });
});
