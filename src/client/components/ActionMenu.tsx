import {
  FloatingFocusManager,
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useListNavigation,
  useRole,
} from '@floating-ui/react';
import { Check, Ellipsis } from 'lucide-react';
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export interface ActionMenuItem {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  danger?: boolean;
}

export const iconButtonClasses =
  'rounded border border-github-border bg-github-bg-tertiary p-1.5 text-github-text-primary transition-all hover:bg-github-bg-primary';

// Keys the menu acts on. They stop at the menu so page hotkeys (j/k, and Escape
// closing the Conversation panel) do not act on them as well.
const MENU_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape', 'Tab']);

/**
 * A "⋯" button that opens a menu of actions. `confirmation`, while set, replaces
 * the icon with a check and becomes the button's name, as "Copied!" after a copy.
 */
export function ActionMenu({
  label,
  items,
  confirmation,
}: {
  label: string;
  items: readonly ActionMenuItem[];
  confirmation?: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const listRef = useRef<(HTMLElement | null)[]>([]);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-end',
    whileElementsMounted: autoUpdate,
    middleware: [offset(4), flip(), shift({ padding: 8 })],
  });
  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([
    useClick(context),
    useDismiss(context),
    useRole(context, { role: 'menu' }),
    useListNavigation(context, {
      listRef,
      activeIndex,
      onNavigate: setActiveIndex,
      loop: true,
    }),
  ]);

  // Focus goes back to the button by hand: floating-ui's return would run after
  // Edit's form takes focus, and take it back.
  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const stopMenuKeys = (event: KeyboardEvent) => {
    if (!MENU_KEYS.has(event.key)) return;
    event.stopPropagation();
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      close();
    }
  };

  const name = confirmation ?? label;
  return (
    <>
      <button
        ref={(node) => {
          triggerRef.current = node;
          refs.setReference(node);
        }}
        type="button"
        aria-label={name}
        title={name}
        className={iconButtonClasses}
        {...getReferenceProps({
          onClick: (event) => event.stopPropagation(),
          onKeyDown: (event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') event.stopPropagation();
          },
        })}
      >
        {confirmation ? (
          <Check aria-hidden="true" size={12} />
        ) : (
          <Ellipsis aria-hidden="true" size={12} />
        )}
      </button>
      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false} returnFocus={false}>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              // Opened by mouse, focus rests on the menu box until an arrow key moves it to an item.
              className="z-50 min-w-40 rounded-md border border-github-border bg-github-bg-secondary p-1 text-sm text-github-text-primary shadow-lg outline-none"
              {...getFloatingProps({
                // The menu sits in a portal, but React still bubbles its clicks to the card.
                onClick: (event) => event.stopPropagation(),
                onKeyDown: stopMenuKeys,
              })}
            >
              {items.map((item, index) => (
                <button
                  key={item.label}
                  ref={(node) => {
                    listRef.current[index] = node;
                  }}
                  type="button"
                  role="menuitem"
                  tabIndex={activeIndex === index ? 0 : -1}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left outline-none hover:bg-github-bg-tertiary focus:bg-github-bg-tertiary ${
                    item.danger ? 'text-github-danger' : ''
                  }`}
                  {...getItemProps({
                    onClick: () => {
                      close();
                      item.onSelect();
                    },
                  })}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}
