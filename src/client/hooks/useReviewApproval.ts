import { useCallback, useEffect, useRef, useState } from 'react';

import type { ReviewApproval, ReviewVerdict } from '../../types/conversation';
import { apiFetch } from '../utils/accessToken';

/**
 * Server-owned approval of the displayed review. A recapture, summary edit, or diff change keeps
 * the same URL: an approval follows them and a rejection keeps its versions, so the shown verdict
 * stays until the server's answer changes it.
 */
export function useReviewApproval(url: string | null) {
  const [state, setState] = useState<{ url: string; approval: ReviewApproval } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  // The newest read whose answer is shown. Reads overlap, such as the one a verdict's own
  // completion starts and one an approval event starts; an older answer never replaces a newer one.
  const keptId = useRef(0);
  const activeUrl = useRef(url);
  activeUrl.current = url;
  // The approval the server last answered, for work that resumes before the page renders it.
  const served = useRef<{ url: string; approval: ReviewApproval } | null>(null);

  const refresh = useCallback(async () => {
    if (!url || activeUrl.current !== url) return;
    const id = ++requestId.current;
    try {
      const response = await apiFetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error('Could not load approval');
      const approval = (await response.json()) as ReviewApproval | null;
      if (typeof approval !== 'object' || approval === null)
        throw new Error('Invalid approval response');
      if (activeUrl.current === url && id > keptId.current) {
        keptId.current = id;
        served.current = { url, approval };
        setState({ url, approval });
        setError(null);
      }
    } catch {
      if (activeUrl.current === url && id > keptId.current) {
        keptId.current = id;
        served.current = null;
        setState(null);
        setError('Could not load approval. Refresh the review to retry.');
      }
    }
  }, [url]);

  useEffect(() => {
    setState(null);
    setError(null);
    void refresh();
  }, [refresh]);

  /**
   * Shows the verdict the server applied for one of this page's verdict changes. The answer that
   * says so takes the change out of the review-ops queue, and the page would show the old verdict
   * until the read that follows answers. A read that started before the change answers with the
   * old verdict, so it is ignored.
   */
  const applied = useCallback((verdict: ReviewVerdict | 'clear') => {
    if (served.current?.url !== activeUrl.current) return;
    const approval = { ...served.current.approval };
    if (verdict === 'clear') delete approval.verdict;
    else approval.verdict = verdict;
    keptId.current = requestId.current;
    served.current = { url: served.current.url, approval };
    setState(served.current);
  }, []);

  const servedVerdict = useCallback(
    () => (served.current?.url === activeUrl.current ? served.current.approval.verdict : undefined),
    [],
  );

  const current = state?.url === url ? state.approval : null;
  return {
    verdict: current?.verdict,
    ready: current !== null,
    error,
    refresh,
    applied,
    servedVerdict,
  };
}
