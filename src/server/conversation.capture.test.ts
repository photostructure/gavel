import { describe, expect, it } from 'vitest';

import type { ConversationStreamEvent } from '../types/conversation.js';
import type { DiffCommentThread } from '../types/diff.js';
import type { NamedReviewMetadata } from '../types/review.js';

import { Conversation } from './conversation.js';

describe('capture-bound conversations', () => {
  it('keeps identity, proposal and original anchors across base changes and moves the approval to the new capture', () => {
    const events: ConversationStreamEvent[] = [];
    const conversation = new Conversation((event) => events.push(event));
    const selection = { baseCommitish: 'a'.repeat(40), targetCommitish: '.', reviewName: 'task' };
    const capture: NamedReviewMetadata = {
      name: 'task',
      version: 1,
      patchDigest: 'b'.repeat(64),
      baseCommit: selection.baseCommitish,
      repositoryId: 'c'.repeat(64),
    };
    conversation.setCapture(selection, capture);
    const original = conversation.snapshot().reviews[0]!;
    const thread: DiffCommentThread = {
      id: 'thread',
      filePath: 'a.ts',
      position: { side: 'new', line: 3 },
      capture: { version: 1, patchDigest: capture.patchDigest },
      createdAt: '2026-10-30T00:00:00Z',
      updatedAt: '2026-10-30T00:00:00Z',
      messages: [
        {
          id: 'message',
          body: 'Keep the original line.',
          createdAt: '2026-10-30T00:00:00Z',
          updatedAt: '2026-10-30T00:00:00Z',
        },
      ],
    };
    conversation.update(selection, [], [thread], 'user');
    conversation.setSummary(selection, {
      commitMessage: 'fix: retain context',
      rationale: 'Preserve task discussion.',
      version: 1,
    });
    expect(conversation.setVerdict(selection, 'approve')).toMatchObject({
      verdict: 'approve',
      captureVersion: 1,
      patchDigest: capture.patchDigest,
      summaryVersion: 1,
    });
    events.length = 0;
    const nextSelection = { ...selection, baseCommitish: 'd'.repeat(40) };
    const nextCapture = {
      ...capture,
      version: 2,
      patchDigest: 'e'.repeat(64),
      baseCommit: nextSelection.baseCommitish,
    };
    conversation.setCapture(nextSelection, nextCapture);
    const current = conversation.snapshot().reviews[0]!;
    expect(current.id).toBe(original.id);
    expect(current.selection).toEqual(nextSelection);
    expect(current.threads[0]?.capture).toEqual(thread.capture);
    expect(current.summary.commitMessage).toBe('fix: retain context');
    expect(current.approval).toMatchObject({
      verdict: 'approve',
      captureVersion: 2,
      patchDigest: nextCapture.patchDigest,
      summaryVersion: 1,
    });
    expect(events).toEqual([
      expect.objectContaining({
        type: 'review.approval',
        origin: 'agent',
        reviewId: original.id,
        approval: expect.objectContaining({ verdict: 'approve' }),
        capture: nextCapture,
        summaryVersion: 1,
      }),
      expect.objectContaining({
        type: 'review.capture',
        reviewId: original.id,
        capture: nextCapture,
      }),
    ]);
  });
});
