import { useCallback, useEffect, useState } from 'react';

import type { DiffSelection } from '../../types/diff';
import type { InboxDelivery } from '../../types/presence';
import { diffSelectionsEqual } from '../../utils/diffSelection';
import { resolveEventSourceUrl } from '../utils/eventSourceUrl';

/** Browser observation time; never sent by or compared with the server. */
export type ClientInboxDelivery = InboxDelivery & { receivedAt?: number };

interface InboxReview {
  id: string;
  selection: DiffSelection;
  delivery: ClientInboxDelivery;
  lastReceipt?: Extract<ClientInboxDelivery, { status: 'sent' | 'queued' }>;
}

type EarlierQueueReceipt =
  | { status: 'sent'; at: string; via: 'queue' }
  | { status: 'sent'; at: string; via: 'queue-unknown'; error?: string };

// Earlier in-progress queue builds used sent/via. A detached source-build server can keep
// running after the browser assets change; preserve queue diagnostics and recovery details.
function normalizeDelivery(delivery: InboxDelivery | EarlierQueueReceipt): InboxDelivery {
  if (delivery.status === 'sent' && delivery.via === 'queue')
    return { status: 'queued', at: delivery.at, transport: 'queue' };
  if (delivery.status === 'sent' && delivery.via === 'queue-unknown')
    return {
      status: 'uncertain',
      at: delivery.at,
      transport: 'queue',
      error: delivery.error ?? 'Codex did not confirm queueing the feedback',
    };
  return delivery;
}

/**
 * Whether the open review's latest verdict or comment reached the agent session that opened it.
 * refresh runs on the server's inboxDeliveryChanged broadcast.
 */
export function useInboxDelivery(selection: DiffSelection | null) {
  const [reviews, setReviews] = useState<InboxReview[]>([]);
  const refresh = useCallback(async () => {
    const response = await fetch(resolveEventSourceUrl('/api/inbox'), { cache: 'no-store' });
    // A server older than the inbox answers with an error or another page: the indicator then
    // falls back to listener presence.
    const body = response.ok
      ? ((await response.json().catch(() => undefined)) as { reviews?: unknown } | undefined)
      : undefined;
    if (Array.isArray(body?.reviews)) {
      const incoming = body.reviews as (Omit<InboxReview, 'delivery'> & {
        delivery: InboxDelivery | EarlierQueueReceipt;
      })[];
      const receivedAt = Date.now();
      setReviews((previous) =>
        incoming.map((review) => {
          const delivery = normalizeDelivery(review.delivery);
          const old = previous.find((entry) => entry.id === review.id);
          const lastReceipt = old?.lastReceipt;
          if (delivery.status === 'sent' || delivery.status === 'queued') {
            // Keep receipt identity through pending/failed: deleting an unsent comment
            // restores the prior receipt, which must keep its original confirmation age.
            const sameReceipt =
              lastReceipt?.status === delivery.status && lastReceipt.at === delivery.at;
            // Initial snapshots are history. New receipts use this browser's clock,
            // even when the affected review is not selected.
            const observed = sameReceipt ? lastReceipt.receivedAt : old ? receivedAt : undefined;
            const receipt = {
              ...delivery,
              ...(observed === undefined ? {} : { receivedAt: observed }),
            };
            return { ...review, delivery: receipt, lastReceipt: receipt };
          }
          return { ...review, delivery, ...(lastReceipt ? { lastReceipt } : {}) };
        }),
      );
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const delivery = selection
    ? reviews.find((review) => diffSelectionsEqual(review.selection, selection))?.delivery
    : undefined;
  return { delivery, refresh };
}
