import {
  LIVE_OTHER_SERVER,
  LIVE_PATH,
  type LiveServerMessage,
  type LiveVisibilityMessage,
} from '../../types/live';
import { createId } from '../../utils/createId';

import { resolveEventSourceUrl } from './eventSourceUrl';

export interface LiveListener {
  /** The server greeted this page, first or after a reconnect to the same server. */
  onOpen?(): void;
  onMessage?(message: LiveServerMessage): void;
  /** The connection closed; `retrying` is false once the page needs a reload. */
  onLost?(retrying: boolean): void;
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

const isVisible = () => document.visibilityState === 'visible';

function liveUrl(): string {
  const url = new URL(resolveEventSourceUrl(LIVE_PATH), window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const query = new URLSearchParams({ tab, visible: String(isVisible()) });
  // Reconnect only to the server this page started with; its port may now serve another review.
  if (serverId) query.set('server', serverId);
  url.search = query.toString();
  return url.toString();
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
    const retrying = event.code !== LIVE_OTHER_SERVER && attempts < MAX_RECONNECTS;
    gaveUp = !retrying;
    for (const listener of [...listeners]) listener.onLost?.(retrying);
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
  document.removeEventListener('visibilitychange', reportVisibility);
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
