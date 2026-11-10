import { useCallback, useEffect, useRef, useState } from 'react';

import type { ReviewApproval, ReviewVerdict } from '../../types/conversation';
import type { NamedReviewMetadata } from '../../types/review';

type CaptureIdentity = Pick<NamedReviewMetadata, 'version' | 'patchDigest'>;

/** The staged or worktree diff changed after it was displayed; reload it before approving. */
export class DiffChangedError extends Error {
  constructor() {
    super('The diff changed after it was displayed');
  }
}

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
  const activeKey = useRef(key);
  activeKey.current = key;

  const refresh = useCallback(async () => {
    if (!url || activeKey.current !== key) return;
    const id = ++requestId.current;
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error('Could not load approval');
      const approval = (await response.json()) as ReviewApproval | null;
      if (typeof approval !== 'object' || approval === null)
        throw new Error('Invalid approval response');
      if (id === requestId.current && activeKey.current === key) {
        setState({ key, approval });
        setError(null);
      }
    } catch {
      if (id === requestId.current && activeKey.current === key) {
        setState(null);
        setError('Could not load approval. Refresh the review to retry.');
      }
    }
  }, [url, key]);

  useEffect(() => {
    setState(null);
    setError(null);
    void refresh();
    return () => {
      requestId.current += 1;
    };
  }, [refresh]);

  const send = useCallback(
    async (method: 'PUT' | 'DELETE', body?: Record<string, unknown>) => {
      if (!url || activeKey.current !== key)
        throw new Error('Approval is unavailable for this capture');
      const response = await fetch(url, {
        method,
        ...(body
          ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
          : {}),
      });
      if (response.status === 409) {
        const conflict = (await response.json()) as { diffDigest?: unknown };
        if (typeof conflict.diffDigest === 'string') throw new DiffChangedError();
      }
      if (!response.ok) throw new Error('Could not update approval');
      await refresh();
    },
    [url, key, refresh],
  );

  // Reject does not endorse the proposed message, so it sends no summaryVersion.
  const setVerdict = useCallback(
    (verdict: ReviewVerdict, summaryVersion = 0) =>
      send('PUT', {
        verdict,
        ...(verdict !== 'reject' ? { summaryVersion } : {}),
        ...(captureVersion !== undefined ? { captureVersion, patchDigest } : {}),
        ...(diffDigest !== undefined ? { diffDigest } : {}),
      }),
    [send, captureVersion, patchDigest, diffDigest],
  );

  const clearVerdict = useCallback(() => send('DELETE'), [send]);

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
    setVerdict,
    clearVerdict,
  };
}
