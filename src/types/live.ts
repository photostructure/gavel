import type { ReviewPresenceSnapshot } from './presence.js';
import type { WatchEvent } from './watch.js';

/**
 * Each browser tab holds one WebSocket at this path for watch events and its own presence.
 * Browsers allow about six HTTP/1.1 connections per server, and the two event streams each
 * tab used to hold left a third tab unable to load.
 */
export const LIVE_PATH = '/api/live';

/**
 * The close code a server sends a tab that reconnects expecting a different server. The reason
 * is LIVE_RESTARTED when the tab asked for the refusing server's repository and agent session,
 * and empty otherwise.
 */
export const LIVE_OTHER_SERVER = 4000;

/** The refusing server serves the review the tab asked for, restarted. */
export const LIVE_RESTARTED = 'restarted';

export type LiveServerMessage =
  | { channel: 'hello'; serverId: string }
  | { channel: 'watch'; event: WatchEvent }
  | { channel: 'presence'; presence: ReviewPresenceSnapshot };

export interface LiveVisibilityMessage {
  type: 'visibility';
  visible: boolean;
}
