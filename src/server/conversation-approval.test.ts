import type { Server } from 'node:http';
import express from 'express';
import { fetch as realFetch } from 'undici';
import { describe, expect, it, vi } from 'vitest';

import type { ApprovalCondition } from '../types/conversation.js';
import type { DiffCommentThread } from '../types/diff.js';

import { createCommentCommand } from '../cli/comment.js';
import { Conversation, registerConversationRoutes } from './conversation.js';

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
function address(conversation: Conversation, reviewId: string, condition: ApprovalCondition) {
  conversation.setProgress(
    reviewId,
    condition.threadId,
    condition.messageId,
    condition.cursor,
    'replied',
  );
  const approval = conversation.getApproval(selection);
  if (!approval.cursor) throw new Error('Missing approval cursor');
  return conversation.addressCondition({
    reviewId,
    approvalCursor: approval.cursor,
    threadId: condition.threadId,
    messageId: condition.messageId,
    cursor: condition.cursor,
    outcome: condition.intent === 'change' ? 'fixed' : 'answered',
    evidence: 'Implemented the fix, checked behavior, and posted the explanation.',
  });
}

describe('conditional review approval', () => {
  it('keeps repeated conditional approval idempotent while evidence is still pending', () => {
    const { conversation, reviewId } = setup();
    const first = conversation.setApproval(selection, true, 'user', 'after-comments');
    conversation.setCapture(selection, { ...capture, version: 2, patchDigest: 'c'.repeat(64) });
    const condition = first.conditions?.[0];
    if (!condition) throw new Error('Missing condition');
    const partial = address(conversation, reviewId, condition);
    const repeated = conversation.setApproval(selection, true, 'user', 'after-comments');
    expect(repeated).toEqual(partial);
    expect(repeated.baselineCapture?.version).toBe(1);
    expect(repeated.conditions?.[0]?.addressed).toBeDefined();
  });

  it('preserves as-is approval on resolution and lets the reviewer confirm conditional work', () => {
    const { conversation } = setup();
    const resolved = { ...thread, resolution: { resolved: true, updatedAt: time } };
    conversation.setApproval(selection, true, 'user', 'as-is');
    conversation.update(selection, [thread], [resolved], 'user');
    expect(conversation.getApproval(selection).approved).toBe(true);
    conversation.update(selection, [resolved], [thread], 'user');
    expect(conversation.getApproval(selection).approved).toBe(false);
    conversation.setApproval(selection, true, 'user', 'after-comments');
    conversation.update(selection, [thread], [resolved], 'user');
    const approval = conversation.getApproval(selection);
    expect(approval).toMatchObject({ approved: true, requested: true, mode: 'after-comments' });
    expect(
      approval.conditions?.every(
        (condition) => condition.addressed?.outcome === 'confirmed-by-reviewer',
      ),
    ).toBe(true);
    expect(conversation.snapshot().reviews[0]?.threads[0]?.messages[0]?.progress?.status).toBe(
      'queued',
    );
  });
  it('retains reviewer confirmations across recapture while the remaining work is completed', () => {
    const { conversation, reviewId } = setup();
    const message = thread.messages[0];
    if (!message) throw new Error('Missing fixture message');
    const other = { ...thread, id: 'other', messages: [message] };
    conversation.update(selection, [thread], [thread, other], 'user');
    conversation.setApproval(selection, true, 'user', 'after-comments');
    const resolved = { ...thread, resolution: { resolved: true, updatedAt: time } };
    conversation.update(selection, [thread, other], [resolved, other], 'user');
    conversation.setCapture(selection, { ...capture, version: 2, patchDigest: 'c'.repeat(64) });
    const updated = conversation.getApproval(selection);
    expect(updated).toMatchObject({ approved: false, captureVersion: 2 });
    expect(updated.conditions?.filter((condition) => condition.addressed)).toHaveLength(2);
    expect(
      updated.conditions
        ?.filter((condition) => condition.threadId === thread.id)
        .every((condition) => condition.addressed?.outcome === 'confirmed-by-reviewer'),
    ).toBe(true);
    const remaining = updated.conditions?.find((condition) => !condition.addressed);
    if (!remaining) throw new Error('Missing remaining condition');
    expect(address(conversation, reviewId, remaining)).toMatchObject({
      approved: true,
      captureVersion: 2,
      baselineCapture: { version: 1 },
    });
  });

  it('keeps reviewer-confirmed conditions complete when recapturing the approved scope', () => {
    const { conversation, reviewId } = setup();
    conversation.setApproval(selection, true, 'user', 'after-comments');
    conversation.update(
      selection,
      [thread],
      [{ ...thread, resolution: { resolved: true, updatedAt: time } }],
      'user',
    );
    conversation.setCapture(selection, { ...capture, version: 2, patchDigest: 'c'.repeat(64) });
    const approval = conversation.getApproval(selection);
    expect(approval).toMatchObject({
      approved: true,
      captureVersion: 2,
      baselineCapture: { version: 1 },
    });
    const condition = approval.conditions?.[0];
    if (!condition || !approval.cursor) throw new Error('Missing approval condition');
    expect(
      conversation.addressCondition({
        reviewId,
        approvalCursor: approval.cursor,
        ...condition,
        outcome: 'fixed',
        evidence: 'An unnecessary agent attestation cannot replace reviewer confirmation.',
      }),
    ).toEqual(approval);
  });

  it('retains reviewer confirmation when the thread was already completed by the agent', () => {
    const { conversation, reviewId } = setup();
    const approval = conversation.setApproval(selection, true, 'user', 'after-comments');
    for (const condition of approval.conditions ?? []) address(conversation, reviewId, condition);
    conversation.update(
      selection,
      [thread],
      [{ ...thread, resolution: { resolved: true, updatedAt: time } }],
      'user',
    );
    conversation.setCapture(selection, { ...capture, version: 2, patchDigest: 'c'.repeat(64) });
    expect(conversation.getApproval(selection).approved).toBe(true);
    expect(
      conversation
        .getApproval(selection)
        .conditions?.every((condition) => condition.addressed?.outcome === 'confirmed-by-reviewer'),
    ).toBe(true);
  });

  it('addresses exact revisions through the CLI and HTTP endpoint without resolving threads', async () => {
    const { conversation, reviewId } = setup();
    let approval = conversation.setApproval(selection, true, 'user', 'after-comments');
    const app = express();
    app.use(express.json());
    registerConversationRoutes(
      app,
      conversation,
      (nextSelection, threads) => {
        const previous =
          conversation.snapshot().reviews.find((review) => review.id === reviewId)?.threads ?? [];
        conversation.update(nextSelection, previous, threads, 'agent');
      },
      () => {},
    );
    const server = await new Promise<Server>((resolve) => {
      const started = app.listen(0, '127.0.0.1', () => resolve(started));
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal('fetch', realFetch);
    try {
      for (const condition of approval.conditions ?? []) {
        await createCommentCommand().parseAsync([
          'node',
          'difit',
          'reply',
          JSON.stringify({
            reviewId,
            threadId: condition.threadId,
            inReplyTo: condition.messageId,
            cursor: condition.cursor,
            body: 'The requested fix and explanation are complete; the checks passed.',
          }),
          '--host',
          '127.0.0.1',
          '--port',
          String(address.port),
        ]);
        await createCommentCommand().parseAsync([
          'node',
          'difit',
          'address',
          JSON.stringify({
            reviewId,
            approvalCursor: approval.cursor,
            ...condition,
            outcome: condition.intent === 'change' ? 'fixed' : 'answered',
            evidence: 'The fix is checked and the answer is posted.',
          }),
          '--host',
          '127.0.0.1',
          '--port',
          String(address.port),
        ]);
        const output: unknown = JSON.parse(String(log.mock.lastCall?.[0]));
        expect(output).toMatchObject({ success: true });
        approval = conversation.getApproval(selection);
      }
      expect(approval.approved).toBe(true);
      expect(conversation.snapshot().reviews[0]?.threads[0]?.resolution).toBeUndefined();
      const stale = await realFetch(`http://127.0.0.1:${address.port}/api/conversation/address`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewId,
          approvalCursor: 'stale',
          threadId: 'thread',
          messageId: 'fix',
          cursor: 'stale',
          outcome: 'fixed',
          evidence: 'Checked',
        }),
      });
      expect(stale.status).toBe(409);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      vi.unstubAllGlobals();
      log.mockRestore();
      process.exitCode = 0;
    }
  });
  it('keeps legacy approved false until every exact comment revision has explicit evidence', () => {
    const { conversation, reviewId } = setup();
    const approval = conversation.setApproval(selection, true, 'user', 'after-comments');
    expect(approval).toMatchObject({
      approved: false,
      requested: true,
      mode: 'after-comments',
      baselineCapture: { version: 1 },
    });
    expect(approval.conditions).toHaveLength(2);
    const [fix, question] = approval.conditions ?? [];
    if (!fix || !question) throw new Error('Missing conditions');
    conversation.setProgress(reviewId, fix.threadId, fix.messageId, fix.cursor, 'noted');
    conversation.setProgress(
      reviewId,
      question.threadId,
      question.messageId,
      question.cursor,
      'replied',
    );
    expect(conversation.getApproval(selection).approved).toBe(false);
    expect(address(conversation, reviewId, fix).approved).toBe(false);
    expect(address(conversation, reviewId, question).approved).toBe(true);
    expect(conversation.snapshot().reviews[0]?.threads[0]?.resolution).toBeUndefined();
  });

  it('does not let an acknowledgement satisfy a change request or accept a stale approval', () => {
    const { conversation, reviewId } = setup();
    const approval = conversation.setApproval(selection, true, 'user', 'after-comments');
    const condition = approval.conditions?.[0];
    if (!condition || !approval.cursor) throw new Error('Missing condition');
    const input = {
      reviewId,
      approvalCursor: approval.cursor,
      ...condition,
      outcome: 'acknowledged' as const,
      evidence: 'Noted',
    };
    expect(() => conversation.addressCondition(input)).toThrow('Change requests require fixed');
    conversation.setApproval(selection, false);
    expect(() => conversation.addressCondition({ ...input, outcome: 'fixed' })).toThrow(
      'Conditional approval changed',
    );
  });

  it('retains conditional permission across a capture update but requires fresh completion evidence', () => {
    const { conversation, reviewId } = setup();
    const approval = conversation.setApproval(selection, true, 'user', 'after-comments');
    for (const condition of approval.conditions ?? []) address(conversation, reviewId, condition);
    expect(conversation.getApproval(selection).approved).toBe(true);
    conversation.setCapture(selection, { ...capture, version: 2, patchDigest: 'c'.repeat(64) });
    const updated = conversation.getApproval(selection);
    expect(updated).toMatchObject({
      approved: false,
      requested: true,
      captureVersion: 2,
      baselineCapture: { version: 1 },
    });
    expect(updated.conditions?.every((item) => !item.addressed)).toBe(true);
    for (const condition of updated.conditions ?? []) address(conversation, reviewId, condition);
    expect(conversation.getApproval(selection)).toMatchObject({
      approved: true,
      captureVersion: 2,
    });
  });

  it('revokes pending permission on new or edited human feedback and summary changes', () => {
    const { conversation } = setup();
    conversation.setApproval(selection, true, 'user', 'after-comments');
    const edited = structuredClone(thread);
    const first = edited.messages[0];
    if (!first) throw new Error('Missing message');
    first.body = 'Actually, fix this other bug';
    conversation.update(selection, [thread], [edited], 'user');
    expect(conversation.getApproval(selection)).toMatchObject({ approved: false });
    expect(conversation.getApproval(selection).requested).not.toBe(true);
    conversation.setApproval(selection, true, 'user', 'after-comments');
    conversation.setSummary(
      selection,
      { commitMessage: 'new message', rationale: '', version: 1 },
      'user',
    );
    expect(conversation.getApproval(selection).requested).not.toBe(true);
  });

  it('keeps as-is approval bound to its capture and does not mutate stored conditions through snapshots', () => {
    const { conversation } = setup();
    conversation.setApproval(selection, true, 'user', 'after-comments');
    const copy = conversation.snapshot().reviews[0]?.approval;
    copy?.conditions?.splice(0);
    expect(conversation.getApproval(selection).conditions).toHaveLength(2);
    conversation.setApproval(selection, true, 'user', 'as-is');
    expect(conversation.getApproval(selection).approved).toBe(true);
    conversation.setCapture(selection, { ...capture, version: 2 });
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
