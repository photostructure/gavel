import { useState } from 'react';

import type { ReviewPresenceSnapshot } from '../../types/presence';
import { copyTextToClipboard } from '../utils/clipboard';
import { buildResumePrompt } from '../utils/resumePrompt';

export function ReviewPresenceIndicator({
  presence,
  requiresResume = false,
}: {
  presence: ReviewPresenceSnapshot | null;
  requiresResume?: boolean;
}) {
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
      {(!listening || requiresResume) && (
        <button
          type="button"
          className="inline-flex h-8 items-center justify-center rounded border border-github-border px-2 hover:bg-github-bg-tertiary"
          onClick={() => {
            void copyTextToClipboard(buildResumePrompt())
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
