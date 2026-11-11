import { useCallback, useEffect, useRef, useState } from 'react';

import { DiffMode, type ClientWatchState, type WatchEvent } from '../../types/watch.js';
import { subscribeLive } from '../utils/liveConnection';

interface FileWatchHook {
  shouldReload: boolean;
  isConnected: boolean;
  error: string | null;
  reload: () => void;
  watchState: ClientWatchState;
}

export function useFileWatch(
  onReload?: () => Promise<void>,
  onCommentsChanged?: () => Promise<void>,
  onApprovalChanged?: () => Promise<void>,
  onSummaryChanged?: () => Promise<void>,
  onCaptureChanged?: (reviewName?: string) => Promise<void>,
  onInboxChanged?: () => Promise<void>,
  // An agent renamed or deleted a named review.
  onReviewsChanged?: () => Promise<void>,
): FileWatchHook {
  const callbacksRef = useRef({
    onCommentsChanged,
    onApprovalChanged,
    onSummaryChanged,
    onCaptureChanged,
    onInboxChanged,
    onReviewsChanged,
  });
  callbacksRef.current = {
    onCommentsChanged,
    onApprovalChanged,
    onSummaryChanged,
    onCaptureChanged,
    onInboxChanged,
    onReviewsChanged,
  };
  const [watchState, setWatchState] = useState<ClientWatchState>({
    isWatchEnabled: false,
    diffMode: DiffMode.DEFAULT,
    shouldReload: false,
    isReloading: false,
    lastChangeTime: null,
    lastChangeType: null,
    connectionStatus: 'disconnected',
  });

  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      subscribeLive({
        onOpen: () => {
          console.log('Connected to file watch service');
          setWatchState((prev) => ({ ...prev, connectionStatus: 'connected' }));
          setError(null);
          // Recover approval changes missed while this browser was disconnected.
          void callbacksRef.current.onApprovalChanged?.();
          void callbacksRef.current.onSummaryChanged?.();
          void callbacksRef.current.onCaptureChanged?.();
          void callbacksRef.current.onInboxChanged?.();
        },
        onMessage: (message) => {
          if (message.channel !== 'watch') return;
          const data: WatchEvent = message.event;
          switch (data.type) {
            case 'connected':
              setWatchState((prev) => ({
                ...prev,
                isWatchEnabled: true,
                diffMode: data.diffMode,
                connectionStatus: 'connected',
              }));
              break;

            case 'reload':
              console.log('File changes detected, showing reload button:', data.changeType);
              setWatchState((prev) => ({
                ...prev,
                shouldReload: true,
                lastChangeTime: new Date(),
                lastChangeType: data.changeType,
              }));
              break;

            case 'error':
              console.error('File watch error:', data.message);
              setError(data.message || 'File watch error occurred');
              break;

            case 'commentsChanged':
              void callbacksRef.current.onCommentsChanged?.();
              break;
            case 'approvalChanged':
              void callbacksRef.current.onApprovalChanged?.();
              break;
            case 'reviewCaptureChanged':
              void callbacksRef.current.onCaptureChanged?.(data.reviewName);
              break;
            case 'reviewSummaryChanged':
              void callbacksRef.current.onSummaryChanged?.();
              break;
            case 'inboxDeliveryChanged':
              void callbacksRef.current.onInboxChanged?.();
              break;
            case 'reviewRenamed':
            case 'reviewDeleted':
              void callbacksRef.current.onReviewsChanged?.();
              break;
          }
        },
        onLost: (retrying) => {
          console.log('File watch connection lost');
          setWatchState((prev) => ({
            ...prev,
            connectionStatus: retrying ? 'reconnecting' : 'disconnected',
          }));
          if (!retrying) setError('Lost connection to file watch service');
        },
      }),
    [],
  );

  const handleReload = useCallback(async () => {
    if (watchState.isReloading) {
      return; // Already reloading
    }

    setWatchState((prev) => ({
      ...prev,
      isReloading: true,
    }));

    try {
      if (onReload) {
        await onReload();
      }

      // Reset reload state after successful reload
      setWatchState((prev) => ({
        ...prev,
        shouldReload: false,
        isReloading: false,
        lastChangeTime: null,
        lastChangeType: null,
      }));
    } catch (reloadError) {
      console.error('Reload failed:', reloadError);
      setError('Failed to reload diff data');

      setWatchState((prev) => ({
        ...prev,
        isReloading: false,
      }));
    }
  }, [onReload, watchState.isReloading]);

  return {
    shouldReload: watchState.shouldReload,
    isConnected: watchState.connectionStatus === 'connected',
    error,
    reload: handleReload,
    watchState,
  };
}
