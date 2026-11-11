import { useCallback, useEffect, useRef, useState } from 'react';

import type { ReviewSummary } from '../../types/conversation';

const isSummary = (value: unknown): value is ReviewSummary => {
  if (!value || typeof value !== 'object') return false;
  const input = value as Partial<ReviewSummary>;
  return (
    typeof input.commitMessage === 'string' &&
    typeof input.rationale === 'string' &&
    Number.isSafeInteger(input.version) &&
    (input.version ?? -1) >= 0
  );
};

/** Read the agent's proposed commit message and rationale; only agents write them. */
export function useReviewSummary(url: string | null) {
  const [state, setState] = useState<{ url: string; summary: ReviewSummary } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeUrl = useRef(url);
  activeUrl.current = url;
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    if (!url || activeUrl.current !== url) return;
    const id = ++requestId.current;
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error('Could not load change summary');
      const summary: unknown = await response.json();
      if (!isSummary(summary)) throw new Error('Invalid change summary');
      if (id !== requestId.current || activeUrl.current !== url) return;
      setState((previous) =>
        previous?.url === url && summary.version < previous.summary.version
          ? previous
          : { url, summary },
      );
      setError(null);
    } catch {
      if (id === requestId.current && activeUrl.current === url) {
        setError('Could not load the change summary. Try again.');
      }
    }
  }, [url]);

  useEffect(() => {
    setState(null);
    setError(null);
    void refresh();
    return () => {
      requestId.current += 1;
    };
  }, [refresh]);

  const current = state?.url === url ? state.summary : null;
  return {
    commitMessage: current?.commitMessage ?? '',
    rationale: current?.rationale ?? '',
    version: current?.version ?? 0,
    ready: current !== null,
    error,
    refresh,
  };
}
