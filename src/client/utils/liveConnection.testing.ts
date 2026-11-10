import { vi } from 'vitest';

import type { LiveServerMessage } from '../../types/live';

/** A stand-in for the browser WebSocket that tests open, feed, and drop by hand. */
export class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];
  /** Open each socket on the next timer turn, the way a reachable server would. */
  static autoOpen = false;

  static latest(): MockWebSocket {
    const live = MockWebSocket.instances.at(-1);
    if (!live) throw new Error('No WebSocket was opened');
    return live;
  }

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  send = vi.fn<(data: string) => void>();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
  });

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
    if (MockWebSocket.autoOpen) setTimeout(() => this.open(), 10);
  }

  /** Opens the socket and, unless `serverId` is null, greets it the way gavel's server does. */
  open(serverId: string | null = 'test-server'): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
    if (serverId !== null) this.receive({ channel: 'hello', serverId });
  }

  receive(message: LiveServerMessage): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(message) }));
  }

  drop(code = 1006): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code } as CloseEvent);
  }
}
