import { useCallback, useEffect, useRef, useState } from 'react';

import { copyTextToClipboard } from '../utils/clipboard';

export type CopyStatus = 'idle' | 'copied' | 'failed';

// App shows a toast for each failed copy: the control's own alert icon is small and easy to miss.
const failureListeners = new Set<() => void>();

export function onCopyFailure(listener: () => void): () => void {
  failureListeners.add(listener);
  return () => {
    failureListeners.delete(listener);
  };
}

/**
 * Copies text for a copy control and reports how it went for 2 seconds, so the control can show a
 * failed copy as well as a finished one.
 */
export function useCopy(): { status: CopyStatus; copy: (text: string) => void } {
  const [status, setStatus] = useState<CopyStatus>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback((text: string) => {
    const report = (outcome: CopyStatus) => {
      setStatus(outcome);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setStatus('idle'), 2000);
    };
    void copyTextToClipboard(text).then(
      () => report('copied'),
      () => {
        report('failed');
        for (const listener of failureListeners) listener();
      },
    );
  }, []);
  return { status, copy };
}
