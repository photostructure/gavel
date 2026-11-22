import { useHotkeys } from 'react-hotkeys-hook';

/**
 * Escape closes an open toast wherever focus is on the page. Every open toast binds it, so one
 * press closes them all. It is a navigation hotkey: an open dialog disables that scope, so Escape
 * closes the dialog first, and Escape typed in a text box leaves the toasts alone.
 */
export function useDismissOnEscape(open: boolean, onDismiss: () => void) {
  useHotkeys(
    'escape',
    onDismiss,
    { enabled: open, scopes: 'navigation', enableOnFormTags: false, preventDefault: true },
    [onDismiss],
  );
}
