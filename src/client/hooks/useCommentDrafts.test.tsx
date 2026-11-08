import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import {
  CommentDraftScope,
  draftKey,
  filesWithDrafts,
  sweepExpiredDrafts,
  useDraftAnchors,
  useDraftCount,
  useCommentDraft,
  useLineDraftAnchors,
  type LineDraftAnchor,
} from './useCommentDrafts';

const anchor = { kind: 'reply', threadId: 'thread-1' } as const;
const otherAnchor = { kind: 'reply', threadId: 'thread-2' } as const;
const storageKey = (scope: string) => `gavel:comment-drafts:${scope}`;
const DAY_MS = 24 * 60 * 60 * 1000;

function scoped(scope: string) {
  return ({ children }: { children: ReactNode }) => (
    <CommentDraftScope value={scope}>{children}</CommentDraftScope>
  );
}

function storedDraft(body: string, updatedAt = Date.now()) {
  return JSON.stringify({ [draftKey(anchor)]: { anchor, body, intent: 'comment', updatedAt } });
}

function deliverStorageEvent(key: string | null) {
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key }));
  });
}

function refuseStorageWrites() {
  for (const storage of [localStorage, sessionStorage]) {
    const setItem = vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage is full', 'QuotaExceededError');
    });
    onTestFinished(() => setItem.mockRestore());
  }
}

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('useCommentDraft', () => {
  it('keeps a draft in localStorage across a remount', () => {
    const first = renderHook(() => useCommentDraft(anchor), { wrapper: scoped('review-a') });
    act(() => first.result.current.setIntent('question'));
    act(() => first.result.current.setBody('Half a thought'));
    first.unmount();

    const second = renderHook(() => useCommentDraft(anchor), { wrapper: scoped('review-a') });
    expect(second.result.current.draft).toEqual({
      anchor,
      body: 'Half a thought',
      intent: 'question',
      updatedAt: expect.any(Number),
    });
  });

  it('keeps drafts of different reviews apart', () => {
    const a = renderHook(() => useCommentDraft(anchor), { wrapper: scoped('review-a') });
    act(() => a.result.current.setBody('For review A'));
    const b = renderHook(() => useCommentDraft(anchor), { wrapper: scoped('review-b') });
    expect(b.result.current.draft).toBeUndefined();
    expect(a.result.current.body).toBe('For review A');
  });

  it('keeps an emptied draft until it is cleared', () => {
    const { result } = renderHook(() => useCommentDraft(anchor), {
      wrapper: scoped('review-a'),
    });
    act(() => result.current.setBody('Draft'));
    act(() => result.current.setBody(''));
    expect(result.current.draft).toEqual({
      anchor,
      body: '',
      intent: 'comment',
      updatedAt: expect.any(Number),
    });
    act(() => result.current.clear());
    expect(result.current.draft).toBeUndefined();
    expect(localStorage.length).toBe(0);
  });

  it('applies functional updates to the current body', () => {
    const { result } = renderHook(() => useCommentDraft(anchor), {
      wrapper: scoped('review-a'),
    });
    act(() => result.current.setBody('Draft'));
    act(() => result.current.setBody((body) => `${body}, continued`));
    expect(result.current.body).toBe('Draft, continued');
  });

  it('lists the line-draft anchors of one file', () => {
    const line: LineDraftAnchor = {
      kind: 'line',
      filePath: 'a.ts',
      side: 'new',
      lineNumber: [3, 5],
    };
    const other = { kind: 'line', filePath: 'b.ts', side: 'old', lineNumber: 7 } as const;
    const { result } = renderHook(
      () => ({
        line: useCommentDraft(line),
        other: useCommentDraft(other),
        reply: useCommentDraft(anchor),
        list: useLineDraftAnchors('a.ts'),
      }),
      { wrapper: scoped('review-a') },
    );
    act(() => result.current.line.setBody('On a.ts'));
    act(() => result.current.other.setBody('On b.ts'));
    act(() => result.current.reply.setBody('A reply'));
    expect(result.current.list).toEqual([line]);
  });

  it('re-renders only the subscribers whose drafts changed', () => {
    const renders = { other: 0, sameFile: 0, otherFile: 0 };
    const line: LineDraftAnchor = { kind: 'line', filePath: 'a.ts', side: 'new', lineNumber: 3 };
    const { result } = renderHook(
      () => {
        const typed = useCommentDraft(line);
        return typed;
      },
      { wrapper: scoped('review-a') },
    );
    act(() => result.current.setBody('First'));
    renderHook(
      () => {
        renders.other += 1;
        return useCommentDraft(anchor);
      },
      { wrapper: scoped('review-a') },
    );
    renderHook(
      () => {
        renders.sameFile += 1;
        return useLineDraftAnchors('a.ts');
      },
      { wrapper: scoped('review-a') },
    );
    renderHook(
      () => {
        renders.otherFile += 1;
        return useLineDraftAnchors('b.ts');
      },
      { wrapper: scoped('review-a') },
    );
    const before = { ...renders };
    act(() => result.current.setBody('First, then more'));
    expect(renders).toEqual(before);
  });

  it('lists the files that hold a draft, through their threads for replies and edits', () => {
    const line: LineDraftAnchor = { kind: 'line', filePath: 'a.ts', side: 'new', lineNumber: 3 };
    const edit = { kind: 'edit', threadId: 'thread-2', messageId: 'm' } as const;
    const { result } = renderHook(
      () => ({
        line: useCommentDraft(line),
        reply: useCommentDraft(anchor),
        edit: useCommentDraft(edit),
      }),
      { wrapper: scoped('review-a') },
    );
    act(() => result.current.line.setBody('On a.ts'));
    act(() => result.current.reply.setBody('Reply on b.ts'));
    act(() => result.current.edit.setBody('Edit on an unloaded thread'));
    const fileOfThread = (threadId: string) => (threadId === 'thread-1' ? 'b.ts' : undefined);
    expect(filesWithDrafts('review-a', fileOfThread).sort()).toEqual(['a.ts', 'b.ts']);
    expect(filesWithDrafts('review-b', fileOfThread)).toEqual([]);
  });

  it('lists every draft anchor of a review and counts them by scope', () => {
    const line: LineDraftAnchor = {
      kind: 'line',
      filePath: 'a.ts',
      side: 'old',
      lineNumber: [3, 5],
    };
    const edit = { kind: 'edit', threadId: 'thread-2', messageId: 'm' } as const;
    const { result } = renderHook(
      () => ({
        line: useCommentDraft(line),
        reply: useCommentDraft(anchor),
        edit: useCommentDraft(edit),
        all: useDraftAnchors(),
        count: useDraftCount('review-a'),
        otherCount: useDraftCount('review-b'),
      }),
      { wrapper: scoped('review-a') },
    );
    act(() => result.current.line.setBody('On a.ts'));
    act(() => result.current.reply.setBody('A reply'));
    act(() => result.current.edit.setBody('An edit'));
    expect(result.current.all).toEqual([line, anchor, edit]);
    expect(result.current.count).toBe(3);
    expect(result.current.otherCount).toBe(0);
  });
});

describe('sweepExpiredDrafts', () => {
  function pinClock(time: number) {
    vi.useFakeTimers({ toFake: ['Date'], now: time });
    onTestFinished(() => {
      vi.useRealTimers();
    });
  }

  it('deletes drafts older than 7 days in every review and keeps newer ones', () => {
    const start = Date.UTC(2026, 0, 1);
    pinClock(start);
    const old = renderHook(() => useCommentDraft(anchor), { wrapper: scoped('sweep-a') });
    const recent = renderHook(() => useCommentDraft(otherAnchor), {
      wrapper: scoped('sweep-a'),
    });
    const elsewhere = renderHook(() => useCommentDraft(anchor), { wrapper: scoped('sweep-b') });
    act(() => old.result.current.setBody('Abandoned'));
    act(() => elsewhere.result.current.setBody('Abandoned elsewhere'));
    localStorage.setItem('gavel-other-setting', 'kept');

    vi.setSystemTime(start + 6 * DAY_MS);
    act(() => recent.result.current.setBody('Still being written'));

    vi.setSystemTime(start + 7 * DAY_MS + 1);
    sweepExpiredDrafts();
    old.rerender();
    recent.rerender();
    elsewhere.rerender();

    expect(old.result.current.draft).toBeUndefined();
    expect(recent.result.current.body).toBe('Still being written');
    expect(elsewhere.result.current.draft).toBeUndefined();
    expect(localStorage.getItem(storageKey('sweep-b'))).toBeNull();
    expect(localStorage.getItem('gavel-other-setting')).toBe('kept');
  });

  it('writes nothing for a review with no expired draft', () => {
    localStorage.setItem(storageKey('sweep-fresh'), storedDraft('Recent'));
    const setItem = vi.spyOn(localStorage, 'setItem');
    onTestFinished(() => setItem.mockRestore());

    sweepExpiredDrafts();

    expect(setItem).not.toHaveBeenCalled();
  });

  it('keeps a draft exactly 7 days old', () => {
    const start = Date.UTC(2026, 0, 1);
    pinClock(start);
    const { result, rerender } = renderHook(() => useCommentDraft(anchor), {
      wrapper: scoped('sweep-boundary'),
    });
    act(() => result.current.setBody('Seven days'));

    vi.setSystemTime(start + 7 * DAY_MS);
    sweepExpiredDrafts();
    rerender();

    expect(result.current.body).toBe('Seven days');
  });

  it('counts the 7 days from the last change to a draft', () => {
    const start = Date.UTC(2026, 0, 1);
    pinClock(start);
    const { result, rerender } = renderHook(() => useCommentDraft(anchor), {
      wrapper: scoped('sweep-touched'),
    });
    act(() => result.current.setBody('First'));
    vi.setSystemTime(start + 6 * DAY_MS);
    act(() => result.current.setIntent('question'));

    vi.setSystemTime(start + 8 * DAY_MS);
    sweepExpiredDrafts();
    rerender();

    expect(result.current.body).toBe('First');
  });
});

describe('drafts shared between tabs', () => {
  it('shows a change another tab made when its storage event arrives', () => {
    const { result } = renderHook(() => useCommentDraft(anchor), { wrapper: scoped('tabs') });
    act(() => result.current.setBody('From this tab'));

    localStorage.setItem(storageKey('tabs'), storedDraft('From the other tab'));
    deliverStorageEvent(storageKey('tabs'));

    expect(result.current.body).toBe('From the other tab');
  });

  it('drops the drafts when another tab clears localStorage', () => {
    const { result } = renderHook(() => useCommentDraft(anchor), {
      wrapper: scoped('tabs-clear'),
    });
    act(() => result.current.setBody('From this tab'));

    localStorage.clear();
    deliverStorageEvent(null);

    expect(result.current.draft).toBeUndefined();
  });

  it('ignores a storage event for a key outside the drafts', () => {
    const { result } = renderHook(() => useCommentDraft(anchor), {
      wrapper: scoped('tabs-other-key'),
    });
    act(() => result.current.setBody('From this tab'));

    localStorage.setItem(storageKey('tabs-other-key'), storedDraft('Not announced'));
    deliverStorageEvent('gavel-other-setting');

    expect(result.current.body).toBe('From this tab');
  });

  it('keeps a form draft from another tab when this tab saves a different form', () => {
    const { result } = renderHook(
      () => ({ reply: useCommentDraft(anchor), other: useCommentDraft(otherAnchor) }),
      { wrapper: scoped('tabs-two-forms') },
    );
    localStorage.setItem(storageKey('tabs-two-forms'), storedDraft('From the other tab'));

    act(() => result.current.other.setBody('From this tab'));

    expect(result.current.reply.body).toBe('From the other tab');
    expect(result.current.other.body).toBe('From this tab');
  });
});

describe('drafts from sessionStorage', () => {
  const sessionDraft = (body: string) =>
    JSON.stringify({ [draftKey(anchor)]: { anchor, body, intent: 'comment' } });

  it('copies a sessionStorage draft to localStorage once, then removes it', () => {
    const scope = 'copied-once';
    sessionStorage.setItem(storageKey(scope), sessionDraft('Typed before the upgrade'));

    const first = renderHook(() => useCommentDraft(anchor), { wrapper: scoped(scope) });

    expect(first.result.current.body).toBe('Typed before the upgrade');
    expect(sessionStorage.getItem(storageKey(scope))).toBeNull();
    expect(JSON.parse(localStorage.getItem(storageKey(scope))!)).toEqual({
      [draftKey(anchor)]: {
        anchor,
        body: 'Typed before the upgrade',
        intent: 'comment',
        updatedAt: expect.any(Number),
      },
    });

    act(() => first.result.current.clear());
    first.unmount();
    const second = renderHook(() => useCommentDraft(anchor), { wrapper: scoped(scope) });
    expect(second.result.current.draft).toBeUndefined();
  });

  it('keeps a draft already in localStorage over the sessionStorage copy of the same form', () => {
    const scope = 'copied-conflict';
    localStorage.setItem(storageKey(scope), storedDraft('Newer, from another tab'));
    sessionStorage.setItem(storageKey(scope), sessionDraft('Older, from this tab'));

    const { result } = renderHook(() => useCommentDraft(anchor), { wrapper: scoped(scope) });

    expect(result.current.body).toBe('Newer, from another tab');
    expect(sessionStorage.getItem(storageKey(scope))).toBeNull();
  });

  it('leaves the sessionStorage entry in place when localStorage refuses the copy', () => {
    const scope = 'copied-refused';
    sessionStorage.setItem(storageKey(scope), sessionDraft('Nowhere to go'));
    refuseStorageWrites();

    const { result } = renderHook(() => useCommentDraft(anchor), { wrapper: scoped(scope) });

    expect(result.current.body).toBe('Nowhere to go');
    expect(sessionStorage.getItem(storageKey(scope))).not.toBeNull();
  });
});

describe('drafts of an unnamed stdin patch saved before scopes had a digest', () => {
  const digest = 'a'.repeat(64);
  const sessionDraft = (body: string) =>
    JSON.stringify({ [draftKey(anchor)]: { anchor, body, intent: 'comment' } });

  it('moves the sessionStorage entry from the scope without the digest', () => {
    const scope = `stdin-upgrade:${digest}`;
    sessionStorage.setItem(storageKey('stdin-upgrade'), sessionDraft('Typed before the upgrade'));

    const { result } = renderHook(() => useCommentDraft(anchor), { wrapper: scoped(scope) });

    expect(result.current.body).toBe('Typed before the upgrade');
    expect(sessionStorage.getItem(storageKey('stdin-upgrade'))).toBeNull();
    expect(localStorage.getItem(storageKey('stdin-upgrade'))).toBeNull();
    expect(JSON.parse(localStorage.getItem(storageKey(scope))!)).toEqual({
      [draftKey(anchor)]: {
        anchor,
        body: 'Typed before the upgrade',
        intent: 'comment',
        updatedAt: expect.any(Number),
      },
    });
  });

  it('keeps a draft already saved under the digest scope', () => {
    const scope = `stdin-conflict:${digest}`;
    localStorage.setItem(storageKey(scope), storedDraft('Newer, under the digest'));
    sessionStorage.setItem(storageKey('stdin-conflict'), sessionDraft('Older, without it'));

    const { result } = renderHook(() => useCommentDraft(anchor), { wrapper: scoped(scope) });

    expect(result.current.body).toBe('Newer, under the digest');
    expect(sessionStorage.getItem(storageKey('stdin-conflict'))).toBeNull();
  });

  it('leaves the source in place when localStorage refuses the copy', () => {
    const scope = `stdin-refused:${digest}`;
    sessionStorage.setItem(storageKey('stdin-refused'), sessionDraft('Nowhere to go'));
    refuseStorageWrites();

    const { result } = renderHook(() => useCommentDraft(anchor), { wrapper: scoped(scope) });

    expect(result.current.body).toBe('Nowhere to go');
    expect(sessionStorage.getItem(storageKey('stdin-refused'))).not.toBeNull();
  });

  it('leaves the sessionStorage entry alone during the startup sweep, for its own patch', () => {
    const patchA = `stdin-startup:${'c'.repeat(64)}`;
    const patchB = `stdin-startup:${'d'.repeat(64)}`;
    const patchADrafts = storedDraft('Saved for patch A');
    localStorage.setItem(storageKey(patchA), patchADrafts);
    sessionStorage.setItem(storageKey('stdin-startup'), sessionDraft('Typed on patch B'));

    sweepExpiredDrafts();

    expect(sessionStorage.getItem(storageKey('stdin-startup'))).not.toBeNull();
    expect(localStorage.getItem(storageKey(patchA))).toBe(patchADrafts);
    const { result } = renderHook(() => useCommentDraft(anchor), { wrapper: scoped(patchB) });
    expect(result.current.body).toBe('Typed on patch B');
    expect(sessionStorage.getItem(storageKey('stdin-startup'))).toBeNull();
    expect(localStorage.getItem(storageKey(patchA))).toBe(patchADrafts);
  });

  it('still moves the entry into a scope the sweep emptied', () => {
    const scope = `stdin-swept:${'e'.repeat(64)}`;
    localStorage.setItem(storageKey(scope), storedDraft('Abandoned', Date.now() - 8 * DAY_MS));
    sessionStorage.setItem(storageKey('stdin-swept'), sessionDraft('Typed before the upgrade'));

    sweepExpiredDrafts();

    expect(localStorage.getItem(storageKey(scope))).toBeNull();
    expect(sessionStorage.getItem(storageKey('stdin-swept'))).not.toBeNull();
    const { result } = renderHook(() => useCommentDraft(anchor), { wrapper: scoped(scope) });
    expect(result.current.body).toBe('Typed before the upgrade');
    expect(sessionStorage.getItem(storageKey('stdin-swept'))).toBeNull();
  });

  it('does not treat a suffix that is not a digest as one', () => {
    sessionStorage.setItem(storageKey('stdin-plain'), sessionDraft('Another review'));

    const { result } = renderHook(() => useCommentDraft(anchor), {
      wrapper: scoped('stdin-plain:not-a-digest'),
    });

    expect(result.current.draft).toBeUndefined();
    expect(sessionStorage.getItem(storageKey('stdin-plain'))).not.toBeNull();
  });
});

describe('a full localStorage', () => {
  it('reports the storage error and keeps the typed text on the page', () => {
    const { result } = renderHook(() => useCommentDraft(anchor), { wrapper: scoped('quota') });
    refuseStorageWrites();

    // Caught inside act, as a browser event handler's throw does not stop the render.
    let error: unknown;
    act(() => {
      try {
        result.current.setBody('Still on the page');
      } catch (thrown) {
        error = thrown;
      }
    });

    expect(error).toMatchObject({ name: 'QuotaExceededError' });
    expect(result.current.body).toBe('Still on the page');
  });
});
