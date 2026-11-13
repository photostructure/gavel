/** Connection state is advisory: a connected or visible tab does not prove attention. */
export interface ReviewPresenceSnapshot {
  reviewers: { connected: number; visible: number };
  listeners: number;
}

/**
 * Whether the latest human activity reached its owner. Queue receipts confirm persistence,
 * not a running turn; uncertain prevents blind retries after a lost acknowledgment.
 */
export type InboxDelivery = (
  | { status: 'unavailable' }
  | { status: 'ready' }
  | { status: 'pending' }
  | { status: 'sent'; at: string; via: 'inbox' | 'prompt' }
  | { status: 'queued'; at: string }
  | { status: 'uncertain'; at: string; error: string }
  | { status: 'failed'; at: string; error: string }
) & { transport?: 'queue' };
