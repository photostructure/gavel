import type { ReactNode } from 'react';
import { useSyncExternalStore } from 'react';

import { getAccessToken, subscribeAccessToken } from '../utils/accessToken';

/** Renders the review only for a page holding the access token; the server refuses the rest. */
export function AccessTokenGate({ children }: { children: ReactNode }) {
  const token = useSyncExternalStore(subscribeAccessToken, getAccessToken);
  if (token) return children;
  return (
    <div className="flex flex-col items-center justify-center h-dvh bg-github-bg-primary text-center gap-2 px-4">
      <h2 className="text-github-text-primary text-2xl mb-2">
        This page needs gavel's access token
      </h2>
      <p className="text-github-text-secondary text-base max-w-xl">
        Open this address with the <code>#gavel-token=…</code> ending of the link gavel printed when
        it started. This browser remembers the token for this address after that.
      </p>
    </div>
  );
}
