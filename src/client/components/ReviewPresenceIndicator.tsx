import { useState } from 'react';

import type { ReviewPresenceSnapshot } from '../../types/presence';
import { copyTextToClipboard } from '../utils/clipboard';
import { resolveEventSourceUrl } from '../utils/eventSourceUrl';

export function ReviewPresenceIndicator({ presence }: { presence: ReviewPresenceSnapshot | null }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const listening = Boolean(presence?.listeners);
  return (
    <div className="flex items-center gap-2 text-xs" aria-label="Review presence">
      <span
        className={listening ? 'text-github-accent-text' : 'text-github-text-secondary'}
        title={
          presence
            ? `${presence.reviewers.connected} connected review tabs; ${presence.reviewers.visible} visible. A listener connection does not mean a comment has been read.`
            : 'Presence is unavailable. Reload the page to reconnect after a lost connection.'
        }
      >
        {presence
          ? listening
            ? 'Agent listener attached'
            : 'No agent listener'
          : 'Presence unavailable'}
      </span>
      {!listening && (
        <button
          type="button"
          className="inline-flex h-8 items-center justify-center rounded border border-github-border px-2 hover:bg-github-bg-tertiary"
          onClick={() => {
            const url = new URL(
              resolveEventSourceUrl('/api/conversation/snapshot'),
              window.location.href,
            );
            const port = url.port || (url.protocol === 'https:' ? '443' : '80');
            const snapshotRequest =
              url.protocol === 'https:'
                ? `read ${url.origin}${url.pathname} over HTTPS and preserve that server URL for replies`
                : `run gavel comment snapshot --host ${url.hostname} --port ${port}, using the gavel launcher prescribed by this checkout's instructions`;
            void copyTextToClipboard(
              `Resume this gavel review (${window.location.href.split('#')[0]}). From the reviewed repository's Git root, ${snapshotRequest}. Reconcile queued messages and saved pending work, then address the human feedback under the existing authorization. Preserve message revision cursors for receipts and replies. End the turn when caught up; do not poll or repeatedly wait for more feedback.`,
            )
              .then(() => {
                setCopied(true);
                setError(false);
              })
              .catch(() => setError(true));
          }}
        >
          {error
            ? 'Copy failed; try again'
            : copied
              ? 'Resume prompt copied'
              : 'Copy resume prompt'}
        </button>
      )}
    </div>
  );
}
