import type { CommentThread, DiffCommentThread } from '../types/diff.js';

export function toCommentThread(thread: DiffCommentThread): CommentThread {
  const common = {
    capture: thread.capture,
    id: thread.id,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    codeContent: thread.codeSnapshot?.content,
    messages: thread.messages,
    resolution: thread.resolution,
    isQuestion: thread.isQuestion,
  };
  if (thread.scope === 'review') return { ...common, scope: 'review' };
  return {
    ...common,
    file: thread.filePath,
    line:
      typeof thread.position.line === 'number'
        ? thread.position.line
        : [thread.position.line.start, thread.position.line.end],
    side: thread.position.side,
  };
}

export function insertBeforeFollowing<T extends { id: string }>(
  items: T[],
  item: T,
  followingIds: string[],
  precedingIds: string[],
): T[] {
  if (items.some((current) => current.id === item.id)) return items;
  const nextId = followingIds.find((id) => items.some((current) => current.id === id));
  const previousId = [...precedingIds]
    .reverse()
    .find((id) => items.some((current) => current.id === id));
  const index =
    nextId !== undefined
      ? items.findIndex((current) => current.id === nextId)
      : previousId !== undefined
        ? items.findIndex((current) => current.id === previousId) + 1
        : 0;
  return [...items.slice(0, index), item, ...items.slice(index)];
}
