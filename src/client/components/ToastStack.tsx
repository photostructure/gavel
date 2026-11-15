import { FloatingPortal, autoUpdate, hide, offset, shift, useFloating } from '@floating-ui/react';
import { type ReactNode, useCallback, useLayoutEffect, useRef } from 'react';

/**
 * The header's toasts, one under another, floating from a portal just below `anchor`: the verdict
 * buttons, or the header on pages without them. The header group clips its overflow, so the
 * toasts cannot sit inside it. Only the stack is positioned; layout puts each toast under the one
 * before it, and when one closes, those below it slide up into its place.
 *
 * The anchor goes in through `refs.setReference`, which follows a new one, as when a review switch
 * remounts the verdict buttons. `elements.reference` would not: `useFloating` keeps the first
 * element given there for as long as it is mounted.
 */
export function ToastStack({ anchor, children }: { anchor: Element | null; children: ReactNode }) {
  const { refs, floatingStyles, middlewareData } = useFloating({
    placement: 'bottom-end',
    // Fixed, so it never adds to the page's scroll size.
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    // hide: the header slides away while the diff scrolls on touch screens.
    middleware: [offset(6), shift({ padding: 8 }), hide()],
  });
  useLayoutEffect(() => refs.setReference(anchor), [anchor, refs]);
  const slide = useSlideIntoPlace();
  // Stable, so React attaches it once: a new callback each render would run again in every
  // commit, and take the toasts' new places before the slide could compare them with the old.
  const stackRef = useCallback(
    (element: HTMLElement | null) => {
      slide(element);
      refs.setFloating(element);
    },
    [slide, refs],
  );
  return (
    <FloatingPortal>
      <div
        ref={stackRef}
        data-toast-stack=""
        style={{
          ...floatingStyles,
          visibility: middlewareData.hide?.referenceHidden ? 'hidden' : 'visible',
        }}
        // The gap between the toasts lets clicks and selection through to the page. At z-50 the
        // portal, which comes after the app's root, paints above Conversation, where a link that
        // cannot be followed opens its toast; the centered dialogs (z-[55]), and the tooltips and
        // the revision pickers those dialogs open (z-[60]), paint above the toasts.
        className="pointer-events-none z-50 flex flex-col items-end gap-3 [&>*]:pointer-events-auto"
      >
        {children}
      </div>
    </FloatingPortal>
  );
}

/**
 * Slides each toast from where it was painted last to where it is now, after a toast above it
 * opens or closes. A toast that has just opened has no last place, so it appears where it is.
 * Returns a ref callback for the stack: the portal mounts the stack after this component's first
 * render, so the stack's first places are taken when it attaches.
 */
function useSlideIntoPlace() {
  const stack = useRef<HTMLElement | null>(null);
  const tops = useRef(new WeakMap<Element, number>());
  const place = useCallback((animate: boolean) => {
    const container = stack.current;
    if (!container) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const toast of container.children as HTMLCollectionOf<HTMLElement>) {
      // Within the stack, so moving the whole stack (a scroll, a resize) slides nothing. A layout
      // offset leaves out the slide's own transform, so a render during a slide does not start
      // another from the middle of this one.
      const top = toast.offsetTop;
      const last = tops.current.get(toast);
      tops.current.set(toast, top);
      if (!animate || last === undefined || last === top || reduce) continue;
      toast.animate([{ transform: `translateY(${last - top}px)` }, { transform: 'none' }], {
        duration: 200,
        easing: 'ease-out',
      });
    }
  }, []);
  // Every render: the page opens and closes the stack's toasts in its own renders.
  useLayoutEffect(() => place(true));
  return useCallback(
    (element: HTMLElement | null) => {
      stack.current = element;
      place(false);
    },
    [place],
  );
}
