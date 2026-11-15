import { X } from 'lucide-react';
import { useState } from 'react';

import type { UnsavedChanges } from '../hooks/useReviewOps';
import { DeliveryGlyph, deliveryColor } from './AgentDeliveryStatus';
import {
  toastActionsClasses,
  toastButtonClasses,
  toastClasses,
  toastDetailClasses,
  toastDismissClasses,
  toastGlyphCellClasses,
  toastTitleClasses,
} from './toastStyles';

/**
 * A toast for changes this browser could not send to the server. It shares the look of the other
 * toasts and sits in the header's toast stack. It takes no focus, since it can open while the
 * reviewer is typing a comment. Dismissing it hides this count and failure; a different one, such
 * as a new count, shows it again.
 */
export function UnsavedChangesToast({
  unsaved,
  onSendNow,
}: {
  unsaved: UnsavedChanges | null;
  // Settles once the attempt ends, whether or not the changes went through.
  onSendNow: () => Promise<void>;
}) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  // A send that fails again leaves the same count and failure, so the button says it is trying.
  const [sending, setSending] = useState(false);
  // Once the changes are sent, the same count and failure after a later failure show again.
  if (unsaved === null && dismissed !== null) setDismissed(null);
  if (unsaved === null) return null;
  // A NUL cannot appear in the count, so the key tells every count and failure apart.
  const key = `${unsaved.count}\u0000${unsaved.failure}`;
  if (key === dismissed) return null;
  const several = unsaved.count > 1;
  return (
    <div role="alert" className={toastClasses('warning')}>
      <div className={toastGlyphCellClasses}>
        {/* The header's robot shows this dead robot while a change fails to send. */}
        <span className={deliveryColor('unreachable')}>
          <DeliveryGlyph state="unreachable" />
        </span>
      </div>
      <div className="col-start-2 row-start-1">
        <p className={toastTitleClasses}>
          {several ? `${unsaved.count} changes not saved` : '1 change not saved'}
        </p>
        <p className={toastDetailClasses}>
          {`Sending failed (${unsaved.failure}). Gavel sends ${several ? 'them' : 'it'} again with your next change, when you reload, or when the live connection reopens.`}
        </p>
      </div>
      <div className={toastActionsClasses}>
        {/* Not disabled: a disabled button drops its focus to the page. */}
        <button
          type="button"
          aria-disabled={sending || undefined}
          onClick={() => {
            if (sending) return;
            setSending(true);
            void onSendNow().finally(() => setSending(false));
          }}
          className={`${toastButtonClasses} aria-disabled:opacity-60`}
        >
          {sending ? 'Sending…' : 'Send again now'}
        </button>
      </div>
      {/* After the actions in the DOM, so it comes last in tab order; the grid places it top right. */}
      <button
        type="button"
        onClick={() => setDismissed(key)}
        aria-label="Dismiss"
        title="Dismiss"
        className={`col-start-3 row-start-1 ${toastDismissClasses}`}
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
