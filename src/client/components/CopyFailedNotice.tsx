import { CircleAlert, X } from 'lucide-react';

import { useDismissOnEscape } from '../hooks/useDismissOnEscape';

import {
  toastClasses,
  toastDetailClasses,
  toastDismissClasses,
  toastGlyphCellClasses,
  toastGlyphClasses,
  toastTitleClasses,
} from './toastStyles';

/**
 * Why a copy did nothing: the browser refused both clipboard paths in `copyTextToClipboard`.
 * `failure` counts the failures since the toast last closed, so each one restarts the 8-second
 * countdown (see CommentLinkNotice, which closes the same way).
 */
export function CopyFailedNotice({
  failure,
  onDismiss,
}: {
  failure: number | null;
  onDismiss: () => void;
}) {
  useDismissOnEscape(failure !== null, onDismiss);
  // The live region stays mounted so screen readers announce each failure.
  return (
    <div role="status" aria-label="Copy failed">
      {failure !== null && (
        <div key={failure} className={toastClasses('warning')}>
          <span
            aria-hidden="true"
            className="toast-countdown pointer-events-none absolute -top-px -bottom-px -left-1 w-1 rounded-l-md bg-github-warning"
            onAnimationEnd={onDismiss}
          />
          <div className={toastGlyphCellClasses}>
            <CircleAlert aria-hidden="true" size={16} className={toastGlyphClasses.warning} />
          </div>
          <div className="col-start-2 row-start-1">
            <div className={toastTitleClasses}>Copy failed</div>
            <div className={toastDetailClasses}>
              The browser blocked clipboard access. Select the text and copy it yourself, or try
              again.
            </div>
          </div>
          <div className="col-start-3 row-start-1">
            <button
              type="button"
              aria-label="Dismiss"
              title="Dismiss"
              onClick={onDismiss}
              className={toastDismissClasses}
            >
              <X aria-hidden="true" size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
