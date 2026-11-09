import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import type { CommentThread } from '../../types/diff';

import { useAgentUpdates } from './useAgentUpdates';

const thread: CommentThread = {
  id: 'thread',
  scope: 'review',
  createdAt: '2026-11-03T00:00:00Z',
  updatedAt: '2026-11-03T00:00:00Z',
  messages: [
    {
      id: 'question',
      origin: 'user',
      body: 'Why?',
      createdAt: '2026-11-03T00:00:00Z',
      updatedAt: '2026-11-03T00:00:00Z',
    },
    {
      id: 'answer',
      origin: 'agent',
      body: 'Because...',
      createdAt: '2026-11-03T00:01:00Z',
      updatedAt: '2026-11-03T00:01:00Z',
    },
  ],
};

describe('unseen agent updates', () => {
  beforeEach(() => localStorage.clear());

  it('keeps replies unseen until explicitly marked read and retains seen revisions across reloads', async () => {
    const first = renderHook(() => useAgentUpdates([thread], 'repo/review'));
    await waitFor(() => expect(first.result.current.updates).toHaveLength(1));
    const update = first.result.current.updates[0]!;
    act(() =>
      first.result.current.setRead(update.thread.id, update.message.id, update.revision, true),
    );
    expect(first.result.current.updates).toHaveLength(0);
    first.unmount();
    const reloaded = renderHook(() => useAgentUpdates([thread], 'repo/review'));
    await waitFor(() => expect(reloaded.result.current.updates).toHaveLength(0));
  });

  it('treats edited agent content as unseen even if its timestamp did not change', async () => {
    const { result, rerender } = renderHook(({ threads }) => useAgentUpdates(threads, 'review'), {
      initialProps: { threads: [thread] },
    });
    await waitFor(() => expect(result.current.updates).toHaveLength(1));
    const update = result.current.updates[0]!;
    act(() => result.current.setRead(thread.id, update.message.id, update.revision, true));
    const edited = structuredClone(thread);
    edited.messages[1]!.body = 'A corrected answer';
    rerender({ threads: [edited] });
    expect(result.current.updates).toHaveLength(1);
    act(() => result.current.setRead(thread.id, update.message.id, update.revision, true));
    expect(result.current.updates).toHaveLength(1);
  });

  it('keeps review scopes separate and ignores a stale control from another review', async () => {
    const { result, rerender } = renderHook(({ scope }) => useAgentUpdates([thread], scope), {
      initialProps: { scope: 'first' },
    });
    await waitFor(() => expect(result.current.updates).toHaveLength(1));
    const stale = result.current.setRead;
    const update = result.current.updates[0]!;
    act(() => result.current.setRead(thread.id, update.message.id, update.revision, true));
    rerender({ scope: 'second' });
    await waitFor(() => expect(result.current.updates).toHaveLength(1));
    act(() => stale(thread.id, update.message.id, update.revision, true));
    expect(result.current.updates).toHaveLength(1);
    rerender({ scope: 'first' });
    await waitFor(() => expect(result.current.updates).toHaveLength(0));
  });

  it('excludes deleted content and keeps identical message IDs in distinct threads separate', async () => {
    const other = { ...thread, id: 'other' };
    const removed = { ...thread, id: 'deleted', deleted: true };
    const { result } = renderHook(() => useAgentUpdates([thread, other, removed], 'review'));
    await waitFor(() => expect(result.current.updates).toHaveLength(2));
    const first = result.current.updates[0]!;
    act(() => result.current.setRead(first.thread.id, first.message.id, first.revision, true));
    expect(result.current.updates).toHaveLength(1);
  });

  it('retains messages seen in different tabs without overwriting another tab', async () => {
    const threads = [thread, { ...thread, id: 'other' }];
    const first = renderHook(() => useAgentUpdates(threads, 'shared-review'));
    const second = renderHook(() => useAgentUpdates(threads, 'shared-review'));
    const firstUpdate = first.result.current.updates[0]!;
    const secondUpdate = second.result.current.updates[1]!;
    act(() =>
      first.result.current.setRead(thread.id, firstUpdate.message.id, firstUpdate.revision, true),
    );
    act(() =>
      second.result.current.setRead('other', secondUpdate.message.id, secondUpdate.revision, true),
    );
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: null })));
    expect(first.result.current.updates).toHaveLength(0);
    expect(second.result.current.updates).toHaveLength(0);
    first.unmount();
    second.unmount();
    const reloaded = renderHook(() => useAgentUpdates(threads, 'shared-review'));
    await waitFor(() => expect(reloaded.result.current.updates).toHaveLength(0));
  });

  it('marks only the requested reply unread and persists the reversal across tabs and reloads', async () => {
    const threads = [thread, { ...thread, id: 'other' }];
    const first = renderHook(() => useAgentUpdates(threads, 'review'));
    const second = renderHook(() => useAgentUpdates(threads, 'review'));
    const target = first.result.current.updates.find((update) => update.thread.id === 'other')!;
    for (const update of first.result.current.updates) {
      act(() =>
        first.result.current.setRead(update.thread.id, update.message.id, update.revision, true),
      );
    }
    expect(first.result.current.updates).toHaveLength(0);
    act(() => first.result.current.setRead('other', 'answer', target.revision, false));
    expect(first.result.current.updates.map((update) => update.thread.id)).toEqual(['other']);
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: null })));
    expect(second.result.current.updates.map((update) => update.thread.id)).toEqual(['other']);
    first.unmount();
    const reloaded = renderHook(() => useAgentUpdates(threads, 'review'));
    await waitFor(() =>
      expect(reloaded.result.current.updates.map((update) => update.thread.id)).toEqual(['other']),
    );
  });
});
