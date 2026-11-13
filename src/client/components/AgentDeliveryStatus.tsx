import { BotMessageSquare, BotOff, Check } from 'lucide-react';
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
        detail: `${delivery.error}. Copy the resume prompt and paste it into the agent's chat.`,
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

/** One compact control for both transports; details and recovery stay outside the header. */
function DeliveryControl({ delivery }: { delivery: InboxDelivery }) {
  const recent = useRecentDelivery(delivery);
  const disconnected = delivery.status === 'unavailable' || delivery.status === 'failed';
  const uncertain = delivery.status === 'uncertain';
  const pending = delivery.status === 'pending';
  const state = disconnected
    ? 'disconnected'
    : uncertain
      ? 'uncertain'
      : pending
        ? 'delivering'
        : recent
          ? 'delivered'
          : 'available';
  const label = disconnected
    ? 'Agent disconnected'
    : uncertain
      ? 'Delivery unconfirmed'
      : pending
        ? 'Delivering to agent'
        : recent
          ? 'Delivered to agent'
          : 'Agent available';
  const { label: receipt, detail } = describe(delivery);
  const color = disconnected
    ? 'text-github-text-muted'
    : uncertain
      ? 'text-github-danger'
      : 'text-github-accent-text';
  return (
    <HeaderMenu
      title={label}
      className={`agent-delivery-button relative inline-flex shrink-0 items-center justify-center rounded hover:bg-github-bg-tertiary ${color}`}
      label={
        <>
          <span className="sr-only" role="status">
            {label}
          </span>
          <span className="relative inline-flex" data-delivery-state={state} aria-hidden="true">
            {disconnected ? <BotOff size={18} /> : <BotMessageSquare size={18} />}
            {pending && (
              <BotMessageSquare
                size={18}
                className="agent-delivery-sweep absolute inset-0 text-github-text-primary"
              />
            )}
            {recent && (
              <span className="absolute -right-1 -bottom-1 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-github-accent text-white">
                <Check size={8} strokeWidth={4} />
              </span>
            )}
            {uncertain && (
              <span className="absolute -right-1 -bottom-1 text-[10px] font-bold">!</span>
            )}
          </span>
        </>
      }
    >
      <p className="font-medium">{label}</p>
      <p className="mt-1 text-xs text-github-text-secondary">
        {receipt}. {detail}
      </p>
      <div className="mt-3">
        <CopyResumePrompt />
      </div>
    </HeaderMenu>
  );
}

/** Desktop placement; older servers without delivery state use the presence indicator. */
export function AgentDeliveryStatus({ delivery }: { delivery: InboxDelivery | undefined }) {
  return delivery ? (
    <div className="hidden shrink-0 md:flex">
      <DeliveryControl delivery={delivery} />
    </div>
  ) : null;
}

/** Mobile placement uses the same states and occupies only 30 pixels of header width. */
export function AgentDeliveryAlert({ delivery }: { delivery: InboxDelivery | undefined }) {
  return delivery ? (
    <div className="flex shrink-0 md:hidden">
      <DeliveryControl delivery={delivery} />
    </div>
  ) : null;
}
