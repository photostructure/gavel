import { ArrowDownFromLine, ArrowUpFromLine, Loader2, UnfoldVertical } from 'lucide-react';
import { memo, type MouseEvent, type ReactElement } from 'react';

const DEFAULT_EXPAND_COUNT = 20;

interface ExpandButtonProps {
  /**
   * The way the shown code grows into the gap, as on GitHub: `up` reveals the gap's
   * last lines, above the hunk below it; `down` reveals its first lines, below the
   * hunk above it.
   */
  direction: 'up' | 'down' | 'both';
  hiddenLines: number;
  onExpandUp?: () => void;
  onExpandDown?: () => void;
  onExpandAll?: () => void;
  isLoading?: boolean;
}

// Memoized to avoid unnecessary re-renders (#8)
export const ExpandButton = memo(function ExpandButton({
  direction,
  hiddenLines,
  onExpandUp,
  onExpandDown,
  onExpandAll,
  isLoading = false,
}: ExpandButtonProps) {
  if (hiddenLines <= 0) {
    return null;
  }

  const lineLabel = `${hiddenLines} ${hiddenLines === 1 ? 'line' : 'lines'}`;
  const showOnlyExpandAll = hiddenLines <= DEFAULT_EXPAND_COUNT;
  const gridClass = 'grid-cols-[var(--line-number-width)_1fr]';
  const iconButtonClass =
    'flex flex-1 w-full items-center justify-center py-1 text-github-text-primary hover:bg-github-bg-secondary hover:text-github-text-muted transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed';

  interface Action {
    key: string;
    onClick: (() => void) | undefined;
    ariaLabel: string;
    title: string;
    icon: ReactElement;
  }
  const actions: Action[] = [];
  // Shift or Alt with an arrow expands the whole gap, as Alt does for the file header's toggle.
  const activate = (action: Action, event: MouseEvent) => {
    if ((event.shiftKey || event.altKey) && onExpandAll) onExpandAll();
    else action.onClick?.();
  };
  const expandAllHint = `(Shift+Click or Alt+Click to expand all ${hiddenLines})`;

  if (showOnlyExpandAll) {
    actions.push({
      key: 'all',
      onClick: onExpandAll,
      ariaLabel: `Expand all ${hiddenLines} hidden lines`,
      title: `Expand all ${hiddenLines} hidden lines`,
      icon: <UnfoldVertical size={16} aria-hidden="true" />,
    });
  } else {
    // In a middle gap, the button nearer the hunk above comes first.
    if (direction === 'down' || direction === 'both') {
      actions.push({
        key: 'down',
        onClick: onExpandDown,
        ariaLabel: `Expand ${DEFAULT_EXPAND_COUNT} lines down`,
        title: `Expand ${DEFAULT_EXPAND_COUNT} lines down ${expandAllHint}`,
        icon: <ArrowDownFromLine size={12} aria-hidden="true" className="translate-y-0.5" />,
      });
    }
    if (direction === 'up' || direction === 'both') {
      actions.push({
        key: 'up',
        onClick: onExpandUp,
        ariaLabel: `Expand ${DEFAULT_EXPAND_COUNT} lines up`,
        title: `Expand ${DEFAULT_EXPAND_COUNT} lines up ${expandAllHint}`,
        icon: <ArrowUpFromLine size={12} aria-hidden="true" className="-translate-y-0.5" />,
      });
    }
  }

  return (
    <div
      className={`grid w-full border-l border-r border-github-border bg-github-bg-tertiary  text-sm ${gridClass}`}
    >
      <div className="flex flex-col items-stretch justify-center gap-0.5 border-r border-github-border">
        {isLoading ? (
          <Loader2
            size={14}
            className="animate-spin text-github-text-muted self-center"
            aria-hidden="true"
          />
        ) : (
          actions.map((action) => (
            <button
              key={action.key}
              type="button"
              onClick={(event) => activate(action, event)}
              disabled={isLoading || !action.onClick}
              className={iconButtonClass}
              title={action.title}
              aria-label={action.ariaLabel}
            >
              {action.icon}
            </button>
          ))
        )}
      </div>
      <div className="relative flex items-center justify-start px-3 py-1.5 font-mono text-github-text-muted select-none">
        {/* The bar beside the buttons does what the button beside it does: with two arrows,
            its top half is the top arrow's and its bottom half the bottom arrow's. The buttons
            stay the keyboard and screen-reader targets, so the bar is hidden from both. */}
        {!isLoading &&
          actions.map(
            (action, index) =>
              action.onClick && (
                <div
                  key={action.key}
                  data-expand-area={action.key}
                  aria-hidden="true"
                  title={action.title}
                  onClick={(event) => activate(action, event)}
                  className={`absolute inset-x-0 cursor-pointer hover:bg-github-bg-secondary ${
                    actions.length === 1
                      ? 'inset-y-0'
                      : index === 0
                        ? 'top-0 h-1/2'
                        : 'bottom-0 h-1/2'
                  }`}
                />
              ),
          )}
        <span className="relative pointer-events-none">{lineLabel}</span>
      </div>
    </div>
  );
});
