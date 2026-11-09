import {
  FloatingFocusManager,
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  size,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react';
import { useState, type ReactNode } from 'react';

export const headerButtonClasses =
  'inline-flex items-center gap-1.5 rounded-md border border-github-border px-3 py-1.5 text-sm text-github-text-primary hover:bg-github-bg-tertiary';

export function HeaderMenu({
  label,
  title,
  children,
  className = '',
  open: controlledOpen,
  onOpenChange,
}: {
  label: ReactNode;
  title?: string;
  children: ReactNode;
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = onOpenChange ?? setLocalOpen;
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-end',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(6),
      flip(),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableWidth, availableHeight, elements }) {
          elements.floating.style.maxWidth = `${Math.max(0, availableWidth)}px`;
          elements.floating.style.maxHeight = `${Math.max(0, availableHeight)}px`;
        },
      }),
    ],
  });
  const click = useClick(context),
    dismiss = useDismiss(context),
    role = useRole(context, { role: 'dialog' });
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss, role]);
  return (
    <div className="relative flex self-stretch">
      <button
        ref={refs.setReference}
        title={title}
        type="button"
        className={className || headerButtonClasses}
        {...getReferenceProps()}
      >
        {label}
      </button>
      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              className="review-menu z-50 w-80 overflow-y-auto rounded-md border border-github-border bg-github-bg-secondary p-3 text-sm text-github-text-primary shadow-lg"
              {...getFloatingProps({
                onClick(event) {
                  if ((event.target as Element).closest('[data-close-menu]')) setOpen(false);
                },
              })}
            >
              {children}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </div>
  );
}
