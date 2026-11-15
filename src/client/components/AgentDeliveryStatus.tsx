import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { ClientInboxDelivery as InboxDelivery } from '../hooks/useInboxDelivery';
import { copyTextToClipboard } from '../utils/clipboard';
import { buildResumePrompt } from '../utils/resumePrompt';

import { HeaderMenu } from './HeaderMenu';

import './agent-delivery.css';

function describe(delivery: InboxDelivery): { label: string; detail: string } {
  switch (delivery.status) {
    case 'ready':
      if (delivery.transport === 'queue')
        return {
          label: 'Verdicts and comments will be queued for Codex',
          detail: 'Keep the owning Codex chat open. A closed chat may need the resume prompt.',
        };
      return {
        label: 'Your verdicts and comments go to the agent session',
        detail: 'The agent session that opened this review receives your verdicts and comments.',
      };
    case 'pending':
      return {
        label: 'Sending to the agent session',
        detail: 'Verdicts are sent within 2 seconds; comments 5 seconds after your last one.',
      };
    case 'queued':
      return {
        label: 'Queued for Codex',
        detail:
          'Codex saved the notification. This does not confirm a running turn. If the chat stays idle, copy the resume prompt.',
      };
    case 'uncertain':
      return {
        label: 'Codex delivery unconfirmed',
        detail: `${delivery.error}. The notification will not be retried automatically. If the chat stays idle, copy the resume prompt.`,
      };
    case 'sent':
      return {
        label: 'Sent to the agent session',
        detail: `Sent ${new Date(delivery.at).toLocaleTimeString()}${delivery.via === 'prompt' ? ' with your next message to the agent' : ''}. The session received it, not that the agent has read it.`,
      };
    case 'failed':
      return {
        label: 'Not delivered to the agent session',
        detail: `Gavel could not reach the agent's chat (${delivery.error}). Copy the resume prompt and paste it into that chat, or into a new chat if it was closed or archived.`,
      };
    case 'unavailable':
      return {
        label: 'No agent session receives this review',
        detail: "Copy the resume prompt and paste it into the agent's chat when you're done.",
      };
  }
}

// Both transports acknowledge acceptance, not that the agent read the message.
// The hook timestamps new receipts in this browser, independently of the server clock.
function useRecentDelivery(delivery: InboxDelivery): boolean {
  const { receivedAt } = delivery;
  const [recentReceipt, setRecentReceipt] = useState<number>();
  useEffect(() => {
    const remaining = receivedAt === undefined ? 0 : receivedAt + 5_000 - Date.now();
    setRecentReceipt(remaining > 0 ? receivedAt : undefined);
    if (remaining <= 0) return;
    const timer = setTimeout(() => setRecentReceipt(undefined), remaining);
    return () => clearTimeout(timer);
  }, [receivedAt]);
  return receivedAt !== undefined && recentReceipt === receivedAt;
}

// Copies the prompt the reviewer pastes into the agent's chat, and says whether that worked.
function CopyResumePrompt() {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const text = error
    ? 'Copy failed; try again'
    : copied
      ? 'Resume prompt copied'
      : 'Copy resume prompt';
  return (
    <button
      type="button"
      title="Copy a prompt to paste into the agent's chat"
      className="inline-flex h-8 shrink-0 items-center rounded border border-github-border px-2 text-xs hover:bg-github-bg-tertiary"
      onClick={() => {
        void copyTextToClipboard(buildResumePrompt())
          .then(() => {
            setCopied(true);
            setError(false);
          })
          .catch(() => setError(true));
      }}
    >
      {text}
    </button>
  );
}

export type DeliveryState =
  | 'unreachable'
  | 'disconnected'
  | 'uncertain'
  | 'unattended'
  | 'delivering'
  | 'delivered'
  | 'available';

// The states in which verdicts and comments will not reach the agent until the reviewer acts.
const isDead = (state: DeliveryState) =>
  state === 'unreachable' || state === 'disconnected' || state === 'uncertain';

/**
 * A robot head drawn on Lucide's 24-unit grid with its 2-unit round strokes, to sit beside the
 * header's Lucide icons. Awake, its antenna stands up with a knob on the end; dead, the antenna
 * is bent over and its eyes are crosses where the awake eyes are.
 */
function Robot({ dead, className }: { dead: boolean; className?: string }) {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      data-robot={dead ? 'dead' : 'awake'}
      className={className}
    >
      <rect width={16} height={12} x={4} y={8} rx={2} />
      <path d="M2 12.5v3M22 12.5v3" />
      {dead ? (
        <>
          <path d="M12 8V4H8" />
          <circle cx={7} cy={4} r={1} />
          <path d="m8 13 2 2m0-2-2 2m6-2 2 2m0-2-2 2" />
        </>
      ) : (
        <>
          <path d="M12 8V4" />
          <circle cx={12} cy={3} r={1} />
          <path d="M9 13v2M15 13v2" />
        </>
      )}
    </svg>
  );
}

/**
 * The robot answers one question: will verdicts and comments reach the agent? Awake in green
 * when they will, swept while sending, checked once received; dead in red when the reviewer must
 * act, and the menu says why and what to do; awake in gray when no agent session takes them.
 */
export function DeliveryGlyph({ state }: { state: DeliveryState }) {
  return (
    <span className="relative inline-flex" data-delivery-state={state} aria-hidden="true">
      <Robot dead={isDead(state)} />
      {state === 'delivering' && (
        <Robot
          dead={false}
          className="agent-delivery-sweep absolute inset-0 text-github-text-primary"
        />
      )}
      {state === 'delivered' && (
        <span className="absolute -right-1 -bottom-1 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-github-accent text-white">
          <Check size={8} strokeWidth={4} />
        </span>
      )}
    </span>
  );
}

export const deliveryColor = (state: DeliveryState) =>
  isDead(state)
    ? 'text-github-danger'
    : state === 'unattended'
      ? 'text-github-text-muted'
      : 'text-github-accent-text';

/**
 * Whether this page can reach the gavel server: `reconnecting` while the live connection retries,
 * `unreachable` once it gave up or while a queued change has failed to send, and `replaced` once a
 * reconnect found another review's gavel server at this address.
 */
export type ServerState = 'reachable' | 'reconnecting' | 'unreachable' | 'replaced';

/**
 * One compact control for both transports; details and recovery stay outside the header.
 * `delivery` is the server's last report, so while this page cannot reach the server the
 * control says so instead, whatever that report was, and opening it reconnects.
 */
function DeliveryControl({
  delivery,
  server,
  onReconnect,
}: {
  delivery: InboxDelivery;
  server: ServerState;
  onReconnect: () => void;
}) {
  const recent = useRecentDelivery(delivery);
  const [open, setOpen] = useState(false);
  const unreachable = server !== 'reachable';
  const disconnected = delivery.status === 'failed';
  const unattended = delivery.status === 'unavailable';
  const uncertain = delivery.status === 'uncertain';
  const pending = delivery.status === 'pending';
  const state: DeliveryState = unreachable
    ? 'unreachable'
    : disconnected
      ? 'disconnected'
      : unattended
        ? 'unattended'
        : uncertain
          ? 'uncertain'
          : pending
            ? 'delivering'
            : recent
              ? 'delivered'
              : 'available';
  const label = unreachable
    ? 'Server unreachable'
    : disconnected
      ? 'Agent disconnected'
      : unattended
        ? 'No agent session'
        : uncertain
          ? 'Delivery unconfirmed'
          : pending
            ? 'Delivering to agent'
            : recent
              ? 'Delivered to agent'
              : 'Agent available';
  const report = describe(delivery);
  const status = unreachable
    ? server === 'replaced'
      ? "Another gavel review now runs at this address, so this page cannot reach its own server. Verdicts and comments wait in this browser, and only this review's gavel server at this address can receive them."
      : `${server === 'reconnecting' ? 'Reconnecting to the gavel server…' : 'The gavel server is unreachable. If it stopped, ask the agent to reopen this review or start gavel again, then click the robot.'} Verdicts and comments wait in this browser. Gavel sends them again with your next change, when you reload, or when the live connection reopens.`
    : `${report.label}. ${report.detail}`;
  return (
    <HeaderMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && unreachable) onReconnect();
      }}
      title={label}
      className={`agent-delivery-button relative inline-flex shrink-0 items-center justify-center rounded hover:bg-github-bg-tertiary ${deliveryColor(state)}`}
      label={
        <>
          <span className="sr-only" role="status">
            {label}
          </span>
          <DeliveryGlyph state={state} />
        </>
      }
    >
      <p className="font-medium">{label}</p>
      <p className="mt-1 text-xs text-github-text-secondary">{status}</p>
      <div className="mt-3">
        <CopyResumePrompt />
      </div>
    </HeaderMenu>
  );
}

interface DeliveryProps {
  delivery: InboxDelivery | undefined;
  server: ServerState;
  // Tries the server again; opening the control while it is unreachable calls it.
  onReconnect: () => void;
}

/** Desktop placement; older servers without delivery state use the presence indicator. */
export function AgentDeliveryStatus({ delivery, server, onReconnect }: DeliveryProps) {
  return delivery ? (
    <div className="hidden shrink-0 md:flex">
      <DeliveryControl delivery={delivery} server={server} onReconnect={onReconnect} />
    </div>
  ) : null;
}

/** Mobile placement uses the same states and occupies only 30 pixels of header width. */
export function AgentDeliveryAlert({ delivery, server, onReconnect }: DeliveryProps) {
  return delivery ? (
    <div className="flex shrink-0 md:hidden">
      <DeliveryControl delivery={delivery} server={server} onReconnect={onReconnect} />
    </div>
  ) : null;
}
