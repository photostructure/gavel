import type { CommentThread, DeletedComment, DiffCommentThread } from '../../types/diff';
import { insertBeforeFollowing } from '../../utils/commentThreads';

type DisplayThread = DiffCommentThread & Pick<CommentThread, 'deleted' | 'deletedMessageIds'>;

/** Keep undo placeholders in the viewer while API payloads contain only live comments. */
export function includeDeletedComments(
  threads: DiffCommentThread[],
  deleted: DeletedComment[],
): DisplayThread[] {
  let result: DisplayThread[] = [...threads];
  for (const entry of [...deleted].reverse()) {
    if (entry.messageId !== undefined) continue;
    result = insertBeforeFollowing(
      result,
      { ...entry.thread, deleted: true },
      entry.followingIds,
      entry.precedingIds,
    );
  }
  for (const entry of [...deleted].reverse()) {
    if (entry.messageId === undefined) continue;
    const message = entry.thread.messages.find((item) => item.id === entry.messageId);
    if (!message) continue;
    result = result.map((thread) => {
      if (thread.id !== entry.thread.id || thread.messages.some((item) => item.id === message.id))
        return thread;
      return {
        ...thread,
        messages: insertBeforeFollowing(
          thread.messages,
          message,
          entry.followingIds,
          entry.precedingIds,
        ),
        deletedMessageIds: [...(thread.deletedMessageIds ?? []), message.id],
      };
    });
  }
  return result;
}
