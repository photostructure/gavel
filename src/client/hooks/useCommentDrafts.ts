import {
  createContext,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type SetStateAction,
} from 'react';

import type { CommentIntent, DiffSide, LineNumber } from '../../types/diff';

// Unsent comment text lives in localStorage, so a reload, a crash, a dev-server hot
// update, a closed tab, or a switch to another review does not delete it, and two
// tabs on one review share one draft per comment form.

export type DraftAnchor =
  | { kind: 'line'; filePath: string; side: DiffSide; lineNumber: LineNumber }
  | { kind: 'reply'; threadId: string }
  | { kind: 'edit'; threadId: string; messageId: string };

export type LineDraftAnchor = Extract<DraftAnchor, { kind: 'line' }>;

interface CommentDraft<A extends DraftAnchor = DraftAnchor> {
  anchor: A;
  body: string;
  intent: CommentIntent;
  // For a line draft, the code under its lines when it was first saved.
  code?: string;
  // Milliseconds since the epoch, set by every change; sweepExpiredDrafts reads it.
  updatedAt: number;
}

type Drafts = Record<string, CommentDraft>;

// The open review's comment-storage key. Drafts saved under one review never
// appear in another.
export const CommentDraftScope = createContext('default');

const STORAGE_PREFIX = 'gavel:comment-drafts:';
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const STDIN_DIGEST_SUFFIX = /:[0-9a-f]{64}$/;

export function draftKey(anchor: DraftAnchor): string {
  switch (anchor.kind) {
    case 'line':
      return JSON.stringify([anchor.kind, anchor.filePath, anchor.side, anchor.lineNumber]);
    case 'reply':
      return JSON.stringify([anchor.kind, anchor.threadId]);
    case 'edit':
      return JSON.stringify([anchor.kind, anchor.threadId, anchor.messageId]);
  }
}

// Memory holds the drafts the page is showing, and localStorage mirrors it. When
// the stored string no longer matches what this page last wrote (after another tab
// saved a draft, say), memory is reloaded from storage.
const scopes = new Map<string, { raw: string | null; drafts: Drafts }>();
const listeners = new Set<() => void>();
// Draft objects a form on this page saved. Any other draft came from storage: an
// earlier page load, or another tab.
const savedByThisPage = new WeakSet<CommentDraft>();

// Another tab changed a review's drafts, or cleared localStorage (a null key).
window.addEventListener('storage', ({ key }) => {
  if (key === null || key.startsWith(STORAGE_PREFIX)) listeners.forEach((listener) => listener());
});

function readDrafts(scope: string): Drafts {
  const raw = localStorage.getItem(STORAGE_PREFIX + scope);
  const cached = scopes.get(scope);
  if (cached && cached.raw === raw) return cached.drafts;
  const parsed = raw === null ? {} : (JSON.parse(raw) as Drafts);
  const drafts = cached ? keepUnchangedEntries(cached.drafts, parsed) : parsed;
  scopes.set(scope, { raw, drafts });
  return cached ? drafts : copySessionDrafts(scope, drafts);
}

// Another tab's write to one draft leaves the rest of the scope's entries as they were.
// Those keep their objects, so they stay in savedByThisPage and their forms do not
// re-render.
function keepUnchangedEntries(memory: Drafts, parsed: Drafts): Drafts {
  return Object.fromEntries(
    Object.entries(parsed).map(([key, draft]) => {
      const kept = memory[key];
      return [key, kept && JSON.stringify(kept) === JSON.stringify(draft) ? kept : draft];
    }),
  );
}

// Drafts used to live in sessionStorage. On a scope's first read in this page, its
// entry moves to localStorage. A draft already there may hold another tab's later
// edits, so it wins. sessionStorage never held a scope with a digest: an unnamed stdin
// patch's old entry is under its scope without the digest App.tsx appends.
function copySessionDrafts(scope: string, stored: Drafts): Drafts {
  const sessionKey = STORAGE_PREFIX + scope.replace(STDIN_DIGEST_SUFFIX, '');
  const session = sessionStorage.getItem(sessionKey);
  if (session === null) return stored;
  const updatedAt = Date.now();
  const copied: Drafts = Object.fromEntries(
    Object.entries(JSON.parse(session) as Record<string, Omit<CommentDraft, 'updatedAt'>>).map(
      ([key, draft]) => [key, { ...draft, updatedAt }],
    ),
  );
  const drafts = { ...copied, ...stored };
  try {
    storeDrafts(scope, drafts);
    sessionStorage.removeItem(sessionKey);
  } catch {
    // Only this write is caught: it runs inside useSyncExternalStore's getSnapshot,
    // where a throw would break rendering. The page shows the text from memory, and
    // the entry stays in sessionStorage for the next page load to try again.
  }
  return drafts;
}

function without(drafts: Drafts, key: string): Drafts {
  const rest = { ...drafts };
  delete rest[key];
  return rest;
}

// Memory first: if storage refuses the write, the page still shows the text.
function storeDrafts(scope: string, drafts: Drafts) {
  scopes.set(scope, { raw: scopes.get(scope)?.raw ?? null, drafts });
  scopes.set(scope, { raw: persistDrafts(STORAGE_PREFIX + scope, drafts), drafts });
}

function persistDrafts(storageKey: string, drafts: Drafts): string | null {
  const raw = Object.keys(drafts).length === 0 ? null : JSON.stringify(drafts);
  if (raw === null) localStorage.removeItem(storageKey);
  else localStorage.setItem(storageKey, raw);
  return raw;
}

function writeDrafts(scope: string, update: (drafts: Drafts) => Drafts) {
  try {
    storeDrafts(scope, update(readDrafts(scope)));
  } finally {
    listeners.forEach((listener) => listener());
  }
}

// Deletes the drafts of every review that nobody has changed for 7 days. It runs
// once, before the first render, and writes only the reviews where a draft expired.
// It reads localStorage directly because readDrafts would run copySessionDrafts: a
// stdin draft from sessionStorage belongs to the patch this page opens, which is not
// known yet.
export function sweepExpiredDrafts() {
  const oldest = Date.now() - DRAFT_MAX_AGE_MS;
  for (const storageKey of Object.keys(localStorage)) {
    if (!storageKey.startsWith(STORAGE_PREFIX)) continue;
    const entries = Object.entries(
      JSON.parse(localStorage.getItem(storageKey) as string) as Drafts,
    );
    const kept = entries.filter(([, { updatedAt }]) => updatedAt >= oldest);
    if (kept.length < entries.length) persistDrafts(storageKey, Object.fromEntries(kept));
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Each subscriber reads only its own slice: writeDrafts keeps the other entries'
// objects, so a keystroke re-renders only the form being typed in.
function useDraftSlice<T>(select: (drafts: Drafts) => T): [string, T] {
  const scope = useContext(CommentDraftScope);
  return [scope, useSyncExternalStore(subscribe, () => select(readDrafts(scope)))];
}

export function useCommentDraft<A extends DraftAnchor>(
  anchor: A,
  initial: { body: string; intent: CommentIntent } = { body: '', intent: 'comment' },
  // Saved with the first write and kept after that; see CommentDraft.code.
  code?: string,
) {
  const key = draftKey(anchor);
  const [scope, draft] = useDraftSlice((drafts) => drafts[key] as CommentDraft<A> | undefined);
  const body = draft?.body ?? initial.body;
  const intent = draft?.intent ?? initial.intent;

  // Every change is saved, even one back to the starting text: a restored form
  // stays open only while its draft exists, so only clear() (Send, Cancel, an outside
  // click on an empty form, or Escape in an empty form or an edit you have not
  // changed) deletes it.
  const save = (current: Drafts, next: { body: string; intent: CommentIntent }) => {
    const savedCode = current[key]?.code ?? code;
    const fields = { anchor, ...next, updatedAt: Date.now() };
    const saved = savedCode === undefined ? fields : { ...fields, code: savedCode };
    savedByThisPage.add(saved);
    return { ...current, [key]: saved };
  };

  const setBody = (next: SetStateAction<string>) =>
    writeDrafts(scope, (current) => {
      const saved = current[key];
      const previous = saved?.body ?? initial.body;
      return save(current, {
        body: typeof next === 'function' ? next(previous) : next,
        intent: saved?.intent ?? initial.intent,
      });
    });

  const setIntent = (next: CommentIntent) =>
    writeDrafts(scope, (current) =>
      save(current, { body: current[key]?.body ?? initial.body, intent: next }),
    );

  const clear = () => writeDrafts(scope, (current) => without(current, key));

  const fromStorage = draft !== undefined && !savedByThisPage.has(draft);
  return {
    key,
    draft,
    fromStorage,
    body,
    intent,
    savedCode: draft?.code,
    setBody,
    setIntent,
    clear,
  };
}

// The inverse of draftKey.
function anchorFromKey(key: string): DraftAnchor {
  const parts = JSON.parse(key) as
    | ['line', string, DiffSide, LineNumber]
    | ['reply', string]
    | ['edit', string, string];
  switch (parts[0]) {
    case 'line':
      return { kind: 'line', filePath: parts[1], side: parts[2], lineNumber: parts[3] };
    case 'reply':
      return { kind: 'reply', threadId: parts[1] };
    case 'edit':
      return { kind: 'edit', threadId: parts[1], messageId: parts[2] };
  }
}

// The anchors of the drafts that pass the filter, in the order they were first
// saved. The snapshot is the joined draft keys, so typing in a draft does not
// re-render the components that only place or list it.
function useDraftAnchorsWhere(keep: (anchor: DraftAnchor) => boolean): DraftAnchor[] {
  const [, keys] = useDraftSlice((drafts) =>
    JSON.stringify(
      Object.entries(drafts)
        .filter(([, { anchor }]) => keep(anchor))
        .map(([key]) => key),
    ),
  );
  return useMemo(() => (JSON.parse(keys) as string[]).map(anchorFromKey), [keys]);
}

export const useDraftAnchors = () => useDraftAnchorsWhere(() => true);

export const useLineDraftAnchors = (filePath: string) =>
  useDraftAnchorsWhere(
    (anchor) => anchor.kind === 'line' && anchor.filePath === filePath,
  ) as LineDraftAnchor[];

// How many unsent drafts a review holds. It takes the scope directly, for the
// page header, which renders outside CommentDraftScope.
export function useDraftCount(scope: string): number {
  return useSyncExternalStore(subscribe, () => Object.keys(readDrafts(scope)).length);
}

// Whether the thread held a reply draft or an unsaved edit of one of its messages
// when the calling component mounted. It is read once, not subscribed to.
export function useThreadHadDraftOnMount(threadId: string): boolean {
  const scope = useContext(CommentDraftScope);
  const [had] = useState(() =>
    Object.values(readDrafts(scope)).some(
      ({ anchor }) => anchor.kind !== 'line' && anchor.threadId === threadId,
    ),
  );
  return had;
}

// The files that hold an unsent draft: a line draft's own file, or the file of the
// thread a reply or edit draft belongs to. Read once, not subscribed to, so the
// page can open those files when a review loads.
export function filesWithDrafts(
  scope: string,
  fileOfThread: (threadId: string) => string | undefined,
): string[] {
  const files = new Set<string>();
  for (const { anchor } of Object.values(readDrafts(scope))) {
    const file = anchor.kind === 'line' ? anchor.filePath : fileOfThread(anchor.threadId);
    if (file !== undefined) files.add(file);
  }
  return [...files];
}
