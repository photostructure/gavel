import type { ReactNode } from 'react';
import { useState, useSyncExternalStore } from 'react';

import { ACCESS_TOKEN_PARAM } from '../../utils/accessToken';
import { getAccessToken, subscribeAccessToken } from '../utils/accessToken';
import { copyTextToClipboard } from '../utils/clipboard';

// Never put a token value in this prompt; name the file that holds it instead. This screen shows
// only when the page has no token or the server refused the one it had, so any token the page
// could read here is wrong. A clipboard prompt also gets pasted into chats and transcripts that
// outlive the token's secrecy.
function buildAccessLinkPrompt(): string {
  const address = window.location.href.split('#')[0];
  // Keep a comment link's place (`&file=…&line=…`), which shares the fragment with the token.
  const place = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  place.delete(ACCESS_TOKEN_PARAM);
  const rest = place.toString().replaceAll('%2F', '/');
  return `Please give me the full gavel link for this page: ${address}#${ACCESS_TOKEN_PARAM}=<the contents of \${GAVEL_CONFIG_DIR:-$HOME/.gavel}/access-token on the machine running gavel>${rest ? `&${rest}` : ''}. Without the token, the page shows only an access screen.`;
}

/** Renders the review only for a page holding the access token; the server refuses the rest. */
export function AccessTokenGate({ children }: { children: ReactNode }) {
  const token = useSyncExternalStore(subscribeAccessToken, getAccessToken);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  if (token) return children;
  return (
    <div className="flex flex-col items-center justify-center h-dvh bg-github-bg-primary text-center gap-2 px-4">
      <h2 className="text-github-text-primary text-2xl mb-2">
        This page needs gavel's access token
      </h2>
      <p className="text-github-text-secondary text-base max-w-xl">
        Open this address with the <code>#gavel-token=…</code> ending of the link gavel printed when
        it started.
      </p>
      <button
        type="button"
        className="mt-2 inline-flex h-8 items-center justify-center rounded border border-github-border px-3 text-sm text-github-text-primary hover:bg-github-bg-tertiary"
        onClick={() => {
          void copyTextToClipboard(buildAccessLinkPrompt())
            .then(() => {
              setCopied(true);
              setError(false);
            })
            .catch(() => setError(true));
        }}
      >
        {error ? 'Copy failed; try again' : copied ? 'Prompt copied' : 'Copy prompt for your agent'}
      </button>
    </div>
  );
}
