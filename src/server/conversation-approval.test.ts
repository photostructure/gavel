import { describe, expect, it } from 'vitest';

import type { DiffCommentThread } from '../types/diff.js';

import { Conversation, onRevision } from './conversation.js';

const selection = { baseCommitish: 'HEAD', targetCommitish: '.', reviewName: 'review' };
const time = '2026-11-03T00:00:00Z';
const thread: DiffCommentThread = {
  id: 'thread',
  scope: 'review',
  createdAt: time,
  updatedAt: time,
  messages: [
    {
      id: 'fix',
      origin: 'user',
      intent: 'change',
      body: 'Fix the bug',
      createdAt: time,
      updatedAt: time,
    },
    {
      id: 'question',
      origin: 'user',
      intent: 'question',
      body: 'Why this approach?',
      createdAt: time,
      updatedAt: time,
    },
  ],
};
const capture = {
  name: 'review',
  version: 1,
  patchDigest: 'a'.repeat(64),
  baseCommit: 'b'.repeat(40),
  repositoryId: 'repo',
};

function setup() {
  const conversation = new Conversation();
  conversation.setCapture(selection, capture);
  conversation.update(selection, [], [thread], 'user');
  const review = conversation.snapshot().reviews[0];
  if (!review) throw new Error('Missing fixture review');
  return { conversation, reviewId: review.id };
}

describe('approval', () => {
  const resolved = { ...thread, resolution: { resolved: true, updatedAt: time } };

  it('is ready to commit as soon as the reviewer chooses it', () => {
    const { conversation } = setup();
    const approval = conversation.setVerdict(selection, 'approve');
    expect(approval).toMatchObject({ verdict: 'approve', captureVersion: 1 });
    expect(approval).not.toHaveProperty('approved');
    expect(approval).not.toHaveProperty('conditions');
    expect(approval).not.toHaveProperty('baselineCapture');
  });

  it('does not change when comments are added, edited, resolved, or reopened', () => {
    const { conversation } = setup();
    const approval = conversation.setVerdict(selection, 'approve');
    const edited = structuredClone(thread);
    edited.messages[0]!.body = 'Actually, fix this other bug';
    conversation.update(selection, [thread], [edited], 'user');
    conversation.update(selection, [edited], [resolved], 'user');
    conversation.update(selection, [resolved], [thread], 'user');
    expect(conversation.getApproval(selection)).toEqual(approval);
  });

  it('follows the capture and summary as the agent revises them', () => {
    const { conversation } = setup();
    conversation.setVerdict(selection, 'approve');
    conversation.setCapture(selection, { ...capture, version: 2, patchDigest: 'c'.repeat(64) });
    conversation.setSummary(selection, {
      commitMessage: 'revised message',
      rationale: '',
      version: 3,
    });
    expect(conversation.getApproval(selection)).toMatchObject({
      verdict: 'approve',
      captureVersion: 2,
      patchDigest: 'c'.repeat(64),
      summaryVersion: 3,
    });
  });

  it('ends when the reviewer clears or replaces it', () => {
    const { conversation } = setup();
    conversation.setVerdict(selection, 'approve');
    conversation.clearVerdict(selection);
    expect(conversation.getApproval(selection).verdict).toBeUndefined();
    conversation.setVerdict(selection, 'approve');
    expect(conversation.setVerdict(selection, 'reject')).toMatchObject({ verdict: 'reject' });
  });
});

describe('reject verdict', () => {
  it('records reject against the displayed capture and emits it as an approval event', () => {
    const events: unknown[] = [];
    const conversation = new Conversation((event) => events.push(event));
    conversation.setCapture(selection, capture);
    const verdict = conversation.setVerdict(selection, 'reject');
    expect(verdict).toMatchObject({
      verdict: 'reject',
      captureVersion: 1,
      patchDigest: capture.patchDigest,
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'review.approval',
        origin: 'user',
        approval: expect.objectContaining({ verdict: 'reject' }),
      }),
    );
    expect(events.at(-1)).not.toHaveProperty('approved');
  });

  it('stays when the reviewer adds comments', () => {
    const { conversation } = setup();
    conversation.setVerdict(selection, 'reject');
    const reply = structuredClone(thread);
    reply.messages.push({
      id: 'more',
      origin: 'user',
      body: 'Also rename this',
      createdAt: time,
      updatedAt: time,
    });
    conversation.update(selection, [thread], [reply], 'user');
    expect(conversation.getApproval(selection).verdict).toBe('reject');
  });

  it('stays when the agent recaptures or the summary changes, since only the reviewer ends it', () => {
    const { conversation } = setup();
    const rejected = conversation.setVerdict(selection, 'reject');
    conversation.setCapture(selection, { ...capture, version: 2, patchDigest: 'c'.repeat(64) });
    conversation.setSummary(selection, {
      commitMessage: 'revised message',
      rationale: '',
      version: 1,
    });
    expect(conversation.getApproval(selection)).toEqual(rejected);
  });

  it('replaces an approval, and an approval replaces it', () => {
    const { conversation } = setup();
    conversation.setVerdict(selection, 'reject');
    expect(conversation.setVerdict(selection, 'approve')).toMatchObject({ verdict: 'approve' });
    expect(conversation.setVerdict(selection, 'reject')).toMatchObject({ verdict: 'reject' });
  });

  it('ends when the reviewer clears it', () => {
    const { conversation } = setup();
    conversation.setVerdict(selection, 'reject');
    conversation.clearVerdict(selection);
    expect(conversation.getApproval(selection).verdict).toBeUndefined();
  });
});

// A recapture or a proposal edit: approve follows the agent's revision, and a rejection stays until
// the reviewer clears it.
describe('onRevision', () => {
  it.each([
    ['approve', 'follow'],
    ['reject', 'keep'],
    [undefined, 'keep'],
  ] as const)('%s → %s', (verdict, outcome) => {
    expect(onRevision(verdict)).toBe(outcome);
  });
});
