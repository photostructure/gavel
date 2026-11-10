import { useEffect, useState } from 'react';

import type { ReviewPresenceSnapshot } from '../../types/presence';
import { subscribeLive } from '../utils/liveConnection';

export function useReviewPresence(): ReviewPresenceSnapshot | null {
  const [presence, setPresence] = useState<ReviewPresenceSnapshot | null>(null);
  useEffect(
    () =>
      subscribeLive({
        onMessage: (message) => {
          if (message.channel === 'presence') setPresence(message.presence);
        },
        onLost: () => setPresence(null),
      }),
    [],
  );
  return presence;
}
