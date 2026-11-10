import { X } from 'lucide-react';

/** Why a comment link, or the place in the page URL, could not be followed. */
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
        <div className="fixed bottom-4 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-md border border-github-border bg-github-bg-secondary py-2 pr-2 pl-4 text-sm text-github-text-primary shadow-2xl">
          <span className="min-w-0">{message}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={onDismiss}
            className="shrink-0 rounded p-1 text-github-text-secondary hover:bg-github-bg-tertiary hover:text-github-text-primary"
          >
            <X aria-hidden="true" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
