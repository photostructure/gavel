import { useCallback, useEffect, useRef, useState } from 'react';

import type { ReviewApproval } from '../../types/conversation';
import type { NamedReviewMetadata } from '../../types/review';

type CaptureIdentity = Pick<NamedReviewMetadata, 'version' | 'patchDigest'>;

/** Server-owned approval, bound to the displayed selection and captured patch. */
export function useReviewApproval(
  url: string | null,
  capture?: CaptureIdentity,
  displayedSummaryVersion?: number,
  diffDigest?: string,
) {
  const captureVersion = capture?.version;
  const patchDigest = capture?.patchDigest;
  const key = JSON.stringify([
    url,
    captureVersion,
    patchDigest,
    displayedSummaryVersion,
    diffDigest,
  ]);
  const [state, setState] = useState<{ key: string; approval: ReviewApproval } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  // The newest read whose answer is shown. Reads overlap, such as the one a verdict's own
  // completion starts and one an approval event starts; an older answer never replaces a newer one.
  const keptId = useRef(0);
  const activeKey = useRef(key);
  activeKey.current = key;
  // The approval the server last answered, for work that resumes before the page renders it.
  const served = useRef<{ key: string; approval: ReviewApproval } | null>(null);

  const refresh = useCallback(async () => {
    if (!url || activeKey.current !== key) return;
    const id = ++requestId.current;
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error('Could not load approval');
      const approval = (await response.json()) as ReviewApproval | null;
      if (typeof approval !== 'object' || approval === null)
        throw new Error('Invalid approval response');
      if (activeKey.current === key && id > keptId.current) {
        keptId.current = id;
        served.current = { key, approval };
        setState({ key, approval });
        setError(null);
      }
    } catch {
      if (activeKey.current === key && id > keptId.current) {
        keptId.current = id;
        served.current = null;
        setState(null);
        setError('Could not load approval. Refresh the review to retry.');
      }
    }
  }, [url, key]);

  useEffect(() => {
    setState(null);
    setError(null);
    void refresh();
  }, [refresh]);

  const servedVerdict = useCallback(
    () => (served.current?.key === activeKey.current ? served.current.approval.verdict : undefined),
    [],
  );

  const current = state?.key === key ? state.approval : null;
  // An approval after comments follows the agent's revisions, and a rejection stays until the
  // reviewer clears it, so both apply to any capture and summary.
  const matchesCapture =
    captureVersion === undefined ||
    current?.verdict === 'after-comments' ||
    current?.verdict === 'reject' ||
    (current?.captureVersion === captureVersion &&
      current.patchDigest === patchDigest &&
      (displayedSummaryVersion === undefined ||
        current.summaryVersion === displayedSummaryVersion));
  return {
    conditionalSupported: current?.conditionalSupported === true,
    verdict: matchesCapture ? current?.verdict : undefined,
    ready: current !== null,
    error,
    refresh,
    servedVerdict,
  };
}
