import { Link2Off, X } from 'lucide-react';

import { renderBidiText } from '../utils/bidiControls';

import {
  toastClasses,
  toastDetailClasses,
  toastDismissClasses,
  toastGlyphCellClasses,
  toastGlyphClasses,
  toastTitleClasses,
} from './toastStyles';

/**
 * Why a comment link, or the place in the page URL, could not be followed. It sits in the
 * header's toast stack with the other toasts, because a pill at the bottom of the window was
 * easy to miss. It needs nothing from the reviewer, so it closes itself after 8 seconds; the
 * countdown pauses while the pointer is over it or focus is inside it.
 */
export function CommentLinkNotice({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss: () => void;
}) {
  // The live region stays mounted so screen readers announce each new message.
  return (
    <div role="status" aria-label="Link not followed">
      {message && (
        // Keyed by the message so a new one remounts the bar and restarts its countdown.
        <div key={message} className={toastClasses('info')}>
          {/* The bar shrinks over the left border as the countdown runs (see .toast-countdown in
              global.css). Only its animation closes the toast, so the root's slide-in can't. */}
          <span
            aria-hidden="true"
            className="toast-countdown pointer-events-none absolute -top-px -bottom-px -left-1 w-1 rounded-l-md bg-github-text-secondary"
            onAnimationEnd={onDismiss}
          />
          <div className={toastGlyphCellClasses}>
            <Link2Off aria-hidden="true" size={16} className={toastGlyphClasses.info} />
          </div>
          <div className="col-start-2 row-start-1">
            <div className={toastTitleClasses}>Link not followed</div>
            <div className={toastDetailClasses}>{renderBidiText(message)}</div>
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
