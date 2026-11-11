import { useCallback, useEffect, useState } from 'react';

import type { DiffSelection } from '../../types/diff';
import type { InboxDelivery } from '../../types/presence';
import { diffSelectionsEqual } from '../../utils/diffSelection';
import { resolveEventSourceUrl } from '../utils/eventSourceUrl';

interface InboxReview {
  id: string;
  selection: DiffSelection;
  delivery: InboxDelivery;
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
    if (Array.isArray(body?.reviews)) setReviews(body.reviews as InboxReview[]);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const delivery = selection
    ? reviews.find((review) => diffSelectionsEqual(review.selection, selection))?.delivery
    : undefined;
  return { delivery, refresh };
}
