import {
  LIVE_OTHER_SERVER,
  LIVE_PATH,
  LIVE_RESTARTED,
  type LiveServerMessage,
  type LiveVisibilityMessage,
} from '../../types/live';
import { createId } from '../../utils/createId';

import { withAccessTokenQuery } from './accessToken';
import { resolveServerUrl } from './serverUrl';

export interface LiveListener {
  /** The server greeted this page, first or after a reconnect to the same server. */
  onOpen?(): void;
  onMessage?(message: LiveServerMessage): void;
  /**
   * The connection closed; `retrying` is false once the page needs a reload. `otherReview` is
   * true when a requested reconnect (a click on the robot, or the network coming back) found
   * another review's server at this address.
   */
  onLost?(retrying: boolean, otherReview?: boolean): void;
}

const MAX_RECONNECTS = 5;
const RECONNECT_DELAY_MS = 3000;

// One connection per page, shared by every hook that needs live updates.
const tab = createId();
const listeners = new Set<LiveListener>();
// The latest message of each kind, for a hook that subscribes after they arrived.
const latest = new Map<'presence' | 'watch-connected', LiveServerMessage>();
let socket: WebSocket | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let serverId: string | undefined;
let attempts = 0;
let gaveUp = false;
// Set once the current socket's server says hello; the socket opening alone is not enough.
let greeted = false;
/** The review a page shows: its repository, and the agent session that owns it. */
export interface LiveReview {
  repositoryId: string;
  agentSessionId?: string;
}

// While a requested reconnect has not reached a server yet, this page's review; a
// restarted server for it refuses the page with LIVE_RESTARTED.
let reloadFor: LiveReview | undefined;

const isVisible = () => document.visibilityState === 'visible';

function liveUrl(): string {
  const url = new URL(resolveServerUrl(LIVE_PATH), window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const query = new URLSearchParams({ tab, visible: String(isVisible()) });
  // Reconnect only to the server this page started with; its port may now serve another review.
  if (serverId) query.set('server', serverId);
  if (reloadFor) {
    query.set('repository', reloadFor.repositoryId);
    if (reloadFor.agentSessionId) query.set('session', reloadFor.agentSessionId);
  }
  url.search = query.toString();
  return withAccessTokenQuery(url.toString());
}

function reportVisibility() {
  if (socket?.readyState !== WebSocket.OPEN) return;
  const message: LiveVisibilityMessage = { type: 'visibility', visible: isVisible() };
  socket.send(JSON.stringify(message));
}

function connect() {
  reconnectTimer = undefined;
  greeted = false;
  const live = new WebSocket(liveUrl());
  socket = live;
  live.onmessage = (event: MessageEvent) => {
    const message = JSON.parse(String(event.data)) as LiveServerMessage;
    if (message.channel === 'hello') {
      // The socket opens before a server on a reused port refuses this page, so only a greeting
      // counts; the server greets only a page that expects it.
      serverId = message.serverId;
      attempts = 0;
      greeted = true;
      reloadFor = undefined;
      reportVisibility();
      for (const listener of [...listeners]) listener.onOpen?.();
      return;
    }
    if (!greeted) return;
    if (message.channel === 'presence') latest.set('presence', message);
    if (message.channel === 'watch' && message.event.type === 'connected') {
      latest.set('watch-connected', message);
    }
    for (const listener of [...listeners]) listener.onMessage?.(message);
  };
  live.onclose = (event: CloseEvent) => {
    if (socket !== live) return;
    socket = undefined;
    greeted = false;
    latest.clear();
    const refused = event.code === LIVE_OTHER_SERVER;
    // A reconnect was requested and this review's restarted server answered; only a reload
    // loads it. Another review's server keeps the page, whose waiting changes it would hide.
    if (refused && reloadFor !== undefined && event.reason === LIVE_RESTARTED) {
      window.location.reload();
      return;
    }
    const otherReview = refused && reloadFor !== undefined;
    const retrying = !refused && attempts < MAX_RECONNECTS;
    // The reviewer's request lasts through the automatic retries, which may be the ones a
    // restarted server answers, and ends when a server answers or the retries run out.
    if (!retrying) reloadFor = undefined;
    gaveUp = !retrying;
    for (const listener of [...listeners]) listener.onLost?.(retrying, otherReview);
    if (!retrying) return;
    attempts += 1;
    reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
  };
}

function reset() {
  clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  const live = socket;
  socket = undefined;
  live?.close();
  latest.clear();
  serverId = undefined;
  attempts = 0;
  gaveUp = false;
  greeted = false;
  reloadFor = undefined;
  document.removeEventListener('visibilitychange', reportVisibility);
}

/**
 * Tries the live connection again now, when the reviewer asks or the network comes back: after it
 * gave up, or while it waits between automatic retries. It retries five more times. A server that
 * answers but is not the one this page started with refuses it: the page reloads when that server
 * serves `review`'s repository for its agent session, this review restarted, and otherwise reports
 * another review at this address. Queued changes and comment drafts are kept in localStorage.
 * Nothing happens while a socket is open or opening.
 */
export function reconnectLive(review: LiveReview): void {
  if (socket || listeners.size === 0) return;
  clearTimeout(reconnectTimer);
  attempts = 0;
  gaveUp = false;
  reloadFor = review;
  for (const listener of [...listeners]) listener.onLost?.(true);
  connect();
}

/** Subscribes to the page's live connection, opening it for the first subscriber. */
export function subscribeLive(listener: LiveListener): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    document.addEventListener('visibilitychange', reportVisibility);
    connect();
  } else if (gaveUp) {
    listener.onLost?.(false);
  } else if (greeted) {
    listener.onOpen?.();
    for (const message of latest.values()) listener.onMessage?.(message);
  }
  return () => {
    listeners.delete(listener);
    // With no subscriber left the page has unmounted; the next subscriber starts fresh.
    if (listeners.size === 0) reset();
  };
}
