import { useEffect, useRef, useState } from 'react';

import type { AgentUpdate } from './useAgentUpdates';

// The length of the unread-pulse animation in global.css: 3 iterations of 1.2s.
export const UNREAD_PULSE_MS = 3600;

type Reply = Pick<AgentUpdate, 'key' | 'revision'>;
const replyId = (reply: Reply) => JSON.stringify([reply.key, reply.revision]);

/**
 * Non-zero while the unread badge should pulse; each new reply changes the value, which
 * restarts the animation. A rising unread count isn't enough: switching reviews drops the new
 * review's replies from the count until its threads load, and marking an old reply unread
 * raises it too. So every reply is tracked, read or not, and only an unseen unread one pulses.
 */
export function useNewReplyPulse(
  allReplies: Reply[],
  unreadReplies: Reply[],
  ready: boolean,
): number {
  const known = useRef<Set<string> | null>(null);
  const [pulse, setPulse] = useState(0);

  useEffect(() => {
    if (!ready) return;
    const ids = allReplies.map(replyId);
    if (known.current === null) {
      known.current = new Set(ids);
      return;
    }
    const seen = known.current;
    const fresh = ids.filter((id) => !seen.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) seen.add(id);
    const unread = new Set(unreadReplies.map(replyId));
    if (fresh.some((id) => unread.has(id))) setPulse((value) => value + 1);
  }, [allReplies, unreadReplies, ready]);

  useEffect(() => {
    if (pulse === 0) return;
    const end = setTimeout(() => setPulse(0), UNREAD_PULSE_MS);
    return () => clearTimeout(end);
  }, [pulse]);

  return pulse;
}
