/** Connection state is advisory: a connected or visible tab does not prove attention. */
export interface ReviewPresenceSnapshot {
  reviewers: { connected: number; visible: number };
  listeners: number;
}

/**
 * Whether the latest human activity on a review reached the Claude Code session that owns it.
 * sent means the session's inbox accepted the message, not that the agent read it.
 */
export type InboxDelivery =
  | { status: 'unavailable' }
  | { status: 'ready' }
  | { status: 'pending' }
  | { status: 'sent'; at: string; via: 'inbox' | 'prompt' }
  | { status: 'failed'; at: string; error: string };
