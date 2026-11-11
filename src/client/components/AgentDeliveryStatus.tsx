import { BotMessageSquare, BotOff, Check } from 'lucide-react';
import { useState } from 'react';

import type { InboxDelivery } from '../../types/presence';
import { copyTextToClipboard } from '../utils/clipboard';
import { buildResumePrompt } from '../utils/resumePrompt';

function describe(delivery: InboxDelivery): { label: string; detail: string } {
  switch (delivery.status) {
    case 'ready':
      return {
        label: 'Your verdicts and comments go to the agent session',
        detail: 'The agent session that opened this review receives your verdicts and comments.',
      };
    case 'pending':
      return {
        label: 'Sending to the agent session',
        detail: 'Verdicts are sent within 2 seconds; comments 5 seconds after your last one.',
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

const tone: Record<InboxDelivery['status'], string> = {
  ready: 'text-github-text-secondary',
  pending: 'text-blue-600 animate-pulse motion-reduce:animate-none',
  sent: 'text-github-accent-text',
  failed: 'text-github-danger',
  unavailable: 'text-github-text-muted',
};

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

/**
 * Whether the open review's latest verdict or comment reached the agent session that opened it.
 * It reports state and takes no input; only when the reviewer must paste a prompt does a
 * Copy resume prompt control appear beside it. Phones have no room for it in the header: there
 * a failed delivery shows AgentDeliveryAlert instead.
 */
export function AgentDeliveryStatus({ delivery }: { delivery: InboxDelivery | undefined }) {
  // A server older than the inbox reports nothing; the Conversation panel shows presence then.
  if (!delivery) return null;
  const { label, detail } = describe(delivery);
  return (
    <div className="hidden shrink-0 items-center gap-1 md:flex">
      <span
        role="status"
        aria-label={label}
        title={`${label}. ${detail}`}
        className={`relative inline-flex p-1 ${tone[delivery.status]}`}
      >
        {delivery.status === 'unavailable' ? (
          <BotOff size={18} aria-hidden="true" />
        ) : (
          <BotMessageSquare size={18} aria-hidden="true" />
        )}
        {delivery.status === 'sent' && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -bottom-0.5 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-github-accent text-white"
          >
            <Check size={8} strokeWidth={4} />
          </span>
        )}
        {delivery.status === 'failed' && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -bottom-0.5 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-github-danger text-[8px] leading-none font-bold text-white"
          >
            !
          </span>
        )}
      </span>
      {(delivery.status === 'failed' || delivery.status === 'unavailable') && <CopyResumePrompt />}
    </div>
  );
}

/** On phones, where the header has no room for AgentDeliveryStatus: a failed delivery only. */
export function AgentDeliveryAlert({ delivery }: { delivery: InboxDelivery | undefined }) {
  if (delivery?.status !== 'failed') return null;
  return (
    <div
      role="alert"
      className="flex w-full items-center gap-2 text-xs text-github-danger md:hidden"
    >
      <span className="min-w-0">
        Your latest verdict or comment didn&apos;t reach the agent session: {delivery.error}
      </span>
      <CopyResumePrompt />
    </div>
  );
}
