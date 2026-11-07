import {
  createContext,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type SetStateAction,
} from 'react';

import type { CommentIntent, DiffSide, LineNumber } from '../../types/diff';

// Unsent comment text lives in sessionStorage, so a reload, a crash, a dev-server
// hot update, or a switch to another review tab does not delete it.

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
}

type Drafts = Record<string, CommentDraft>;

// The open review's comment-storage key. Drafts saved under one review never
// appear in another.
export const CommentDraftScope = createContext('default');

const STORAGE_PREFIX = 'difit:comment-drafts:';

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

// Memory holds the drafts the page is showing, and sessionStorage mirrors it.
// When the stored string no longer matches what this page last wrote (after
// sessionStorage.clear(), say), memory is reloaded from storage.
const scopes = new Map<string, { raw: string | null; drafts: Drafts }>();
const listeners = new Set<() => void>();

function readDrafts(scope: string): Drafts {
  const raw = sessionStorage.getItem(STORAGE_PREFIX + scope);
  const cached = scopes.get(scope);
  if (cached && cached.raw === raw) return cached.drafts;
  const drafts = raw === null ? {} : (JSON.parse(raw) as Drafts);
  scopes.set(scope, { raw, drafts });
  return drafts;
}

function without(drafts: Drafts, key: string): Drafts {
  const rest = { ...drafts };
  delete rest[key];
  return rest;
}

function writeDrafts(scope: string, update: (drafts: Drafts) => Drafts) {
  const current = readDrafts(scope);
  const previous = scopes.get(scope)?.raw ?? null;
  const drafts = update(current);
  // Memory first: if storage refuses the write, the page still shows the text.
  scopes.set(scope, { raw: previous, drafts });
  try {
    const raw = Object.keys(drafts).length === 0 ? null : JSON.stringify(drafts);
    if (raw === null) sessionStorage.removeItem(STORAGE_PREFIX + scope);
    else sessionStorage.setItem(STORAGE_PREFIX + scope, raw);
    scopes.set(scope, { raw, drafts });
  } finally {
    listeners.forEach((listener) => listener());
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
    return {
      ...current,
      [key]: savedCode === undefined ? { anchor, ...next } : { anchor, ...next, code: savedCode },
    };
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

  return { key, draft, body, intent, savedCode: draft?.code, setBody, setIntent, clear };
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
