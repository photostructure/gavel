import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { CommentThread, DiffCommentMessage } from '../../types/diff';

export interface AgentUpdate {
  key: string;
  thread: CommentThread;
  message: DiffCommentMessage;
  revision: string;
}

export function agentMessageRevision(message: DiffCommentMessage): string {
  return JSON.stringify([message.updatedAt, message.body, message.intent ?? null]);
}

function readSeenMessages(prefix: string | null): Record<string, string> {
  const seen: Record<string, string> = {};
  if (!prefix) return seen;
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const revision = localStorage.getItem(key);
      if (revision !== null) seen[key.slice(prefix.length)] = revision;
    }
  } catch {
    /* Disabled storage leaves updates unseen. */
  }
  return seen;
}

export function useAgentUpdates(threads: CommentThread[], scope: string | null) {
  const storagePrefix = scope === null ? null : `gavel-agent-updates-v1:${JSON.stringify(scope)}:`;
  const [state, setState] = useState<{ scope: string | null; seen: Record<string, string> }>({
    scope: null,
    seen: {},
  });
  const activeScope = useRef({ scope, loadedScope: state.scope });
  activeScope.current = { scope, loadedScope: state.scope };
  useEffect(() => {
    const load = () => setState({ scope, seen: readSeenMessages(storagePrefix) });
    load();
    const onStorage = (event: StorageEvent) => {
      if (storagePrefix && (event.key === null || event.key.startsWith(storagePrefix))) load();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [scope, storagePrefix]);

  const allUpdates = useMemo<AgentUpdate[]>(
    () =>
      threads
        .flatMap((thread) =>
          thread.deleted
            ? []
            : thread.messages
                .filter(
                  (message) =>
                    message.origin === 'agent' && !thread.deletedMessageIds?.includes(message.id),
                )
                .map((message) => ({
                  key: JSON.stringify([thread.id, message.id]),
                  thread,
                  message,
                  revision: agentMessageRevision(message),
                })),
        )
        .sort((a, b) => b.message.updatedAt.localeCompare(a.message.updatedAt)),
    [threads],
  );
  const currentRevisions = useRef(new Map<string, string>());
  currentRevisions.current = new Map(allUpdates.map((update) => [update.key, update.revision]));
  const setRead = useCallback(
    (threadId: string, messageId: string, revision: string, read: boolean) => {
      const key = JSON.stringify([threadId, messageId]);
      if (
        !storagePrefix ||
        activeScope.current.scope !== scope ||
        activeScope.current.loadedScope !== scope ||
        currentRevisions.current.get(key) !== revision
      )
        return;
      // A separate key per message prevents tabs from replacing each other's read map.
      try {
        if (read) localStorage.setItem(`${storagePrefix}${key}`, revision);
        else localStorage.removeItem(`${storagePrefix}${key}`);
      } catch {
        /* Read state still works in memory if persistent storage is unavailable. */
      }
      setState((current) => {
        if (current.scope !== scope) return current;
        if (read ? current.seen[key] === revision : current.seen[key] === undefined) return current;
        const seen = { ...current.seen };
        if (read) seen[key] = revision;
        else delete seen[key];
        return { scope, seen };
      });
    },
    [scope, storagePrefix],
  );
  const updates =
    scope !== null && state.scope === scope
      ? allUpdates.filter((update) => state.seen[update.key] !== update.revision)
      : [];
  return { updates, allUpdates, setRead };
}
