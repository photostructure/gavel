import { describe, expect, it } from 'vitest';

import type { DiffCommentThread } from '../types/diff.js';

import { Conversation } from './conversation.js';

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

describe('approval after comments', () => {
  const resolved = { ...thread, resolution: { resolved: true, updatedAt: time } };
  const afterComments = { approved: true, requested: true, mode: 'after-comments' };

  it('is ready to commit as soon as the reviewer chooses it', () => {
    const { conversation } = setup();
    const approval = conversation.setApproval(selection, true, 'user', 'after-comments');
    expect(approval).toMatchObject({ ...afterComments, captureVersion: 1 });
    expect(approval).not.toHaveProperty('conditions');
    expect(approval).not.toHaveProperty('baselineCapture');
  });

  it('does not change when comments are added, edited, resolved, or reopened', () => {
    const { conversation } = setup();
    const approval = conversation.setApproval(selection, true, 'user', 'after-comments');
    const edited = structuredClone(thread);
    edited.messages[0]!.body = 'Actually, fix this other bug';
    conversation.update(selection, [thread], [edited], 'user');
    conversation.update(selection, [edited], [resolved], 'user');
    conversation.update(selection, [resolved], [thread], 'user');
    expect(conversation.getApproval(selection)).toEqual(approval);
  });

  it('follows the capture and summary as the agent revises them', () => {
    const { conversation } = setup();
    conversation.setApproval(selection, true, 'user', 'after-comments');
    conversation.setCapture(selection, { ...capture, version: 2, patchDigest: 'c'.repeat(64) });
    conversation.setSummary(
      selection,
      { commitMessage: 'revised message', rationale: '', version: 3 },
      'agent',
    );
    expect(conversation.getApproval(selection)).toMatchObject({
      ...afterComments,
      captureVersion: 2,
      patchDigest: 'c'.repeat(64),
      summaryVersion: 3,
    });
  });

  it('ends when the reviewer clears or replaces it', () => {
    const { conversation } = setup();
    conversation.setApproval(selection, true, 'user', 'after-comments');
    conversation.setApproval(selection, false, 'user');
    expect(conversation.getApproval(selection).requested).toBeUndefined();
    conversation.setApproval(selection, true, 'user', 'after-comments');
    expect(conversation.setNotYet(selection)).toMatchObject({ approved: false, notYet: true });
  });
});

describe('as-is approval', () => {
  it('survives resolving a thread and ends when it is reopened', () => {
    const { conversation } = setup();
    const resolved = { ...thread, resolution: { resolved: true, updatedAt: time } };
    conversation.setApproval(selection, true, 'user', 'as-is');
    conversation.update(selection, [thread], [resolved], 'user');
    expect(conversation.getApproval(selection).approved).toBe(true);
    conversation.update(selection, [resolved], [thread], 'user');
    expect(conversation.getApproval(selection).approved).toBe(false);
  });

  it('ends when the capture or summary changes', () => {
    const { conversation } = setup();
    conversation.setApproval(selection, true, 'user', 'as-is');
    conversation.setCapture(selection, { ...capture, version: 2 });
    expect(conversation.getApproval(selection).approved).toBe(false);
    conversation.setApproval(selection, true, 'user', 'as-is');
    conversation.setSummary(
      selection,
      { commitMessage: 'new message', rationale: '', version: 1 },
      'user',
    );
    expect(conversation.getApproval(selection).approved).toBe(false);
  });
});

describe('not-yet verdict', () => {
  it('records not yet against the displayed capture and emits it as an approval event', () => {
    const events: unknown[] = [];
    const conversation = new Conversation((event) => events.push(event));
    conversation.setCapture(selection, capture);
    const verdict = conversation.setNotYet(selection);
    expect(verdict).toMatchObject({
      approved: false,
      notYet: true,
      captureVersion: 1,
      patchDigest: capture.patchDigest,
    });
    expect(verdict.requested).toBeUndefined();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'review.approval',
        origin: 'user',
        approved: false,
        approval: expect.objectContaining({ notYet: true }),
      }),
    );
  });

  it('keeps not yet when the reviewer adds comments', () => {
    const { conversation } = setup();
    conversation.setNotYet(selection);
    const reply = structuredClone(thread);
    reply.messages.push({
      id: 'more',
      origin: 'user',
      body: 'Also rename this',
      createdAt: time,
      updatedAt: time,
    });
    conversation.update(selection, [thread], [reply], 'user');
    expect(conversation.getApproval(selection).notYet).toBe(true);
  });

  it('clears not yet when the agent recaptures or the summary changes', () => {
    const { conversation } = setup();
    conversation.setNotYet(selection);
    conversation.setCapture(selection, { ...capture, version: 2, patchDigest: 'c'.repeat(64) });
    expect(conversation.getApproval(selection).notYet).toBeUndefined();
    conversation.setNotYet(selection);
    conversation.setSummary(
      selection,
      { commitMessage: 'revised message', rationale: '', version: 1 },
      'agent',
    );
    expect(conversation.getApproval(selection).notYet).toBeUndefined();
  });

  it('replaces not yet with an approval, and an approval with not yet', () => {
    const { conversation } = setup();
    conversation.setNotYet(selection);
    expect(conversation.setApproval(selection, true, 'user', 'as-is')).toMatchObject({
      approved: true,
    });
    expect(conversation.getApproval(selection).notYet).toBeUndefined();
    expect(conversation.setNotYet(selection)).toMatchObject({ approved: false, notYet: true });
    expect(conversation.getApproval(selection).requested).toBeUndefined();
  });

  it('clears not yet on revocation', () => {
    const { conversation } = setup();
    conversation.setNotYet(selection);
    conversation.setApproval(selection, false, 'user');
    expect(conversation.getApproval(selection).notYet).toBeUndefined();
  });
});
