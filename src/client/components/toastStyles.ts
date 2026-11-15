/**
 * The look every toast shares, taken from the comment cards: a rounded card with a thick left
 * bar, a border, and a background tint, all in the color of what the toast reports.
 * Each toast is a grid: a glyph, the message (a bold title over dimmed detail), and the close
 * X, with any actions on a row below, right-aligned under the message.
 */
export type ToastKind = 'approve' | 'reject' | 'warning' | 'info';

// Approve and reject take their verdict buttons' fills; warning is the theme's amber; info is
// gray, for a notice that needs nothing from the reviewer. The kind's color also tints the
// card, so it reads as floating over the page, not as part of it; the dark theme takes more.
const frameClasses: Record<ToastKind, string> = {
  approve:
    'border-github-accent/60 border-l-github-accent bg-[color-mix(in_srgb,var(--color-github-accent)_14%,var(--color-github-bg-tertiary))] dark:bg-[color-mix(in_srgb,var(--color-github-accent)_20%,var(--color-github-bg-tertiary))]',
  reject:
    'border-verdict-reject/60 border-l-verdict-reject bg-[color-mix(in_srgb,var(--color-verdict-reject)_14%,var(--color-github-bg-tertiary))] dark:bg-[color-mix(in_srgb,var(--color-verdict-reject)_20%,var(--color-github-bg-tertiary))]',
  warning:
    'border-github-warning/50 border-l-github-warning bg-[color-mix(in_srgb,var(--color-github-warning)_14%,var(--color-github-bg-tertiary))] dark:bg-[color-mix(in_srgb,var(--color-github-warning)_20%,var(--color-github-bg-tertiary))]',
  info: 'border-github-border border-l-github-text-muted bg-[color-mix(in_srgb,var(--color-github-text-secondary)_14%,var(--color-github-bg-tertiary))] dark:bg-[color-mix(in_srgb,var(--color-github-text-secondary)_20%,var(--color-github-bg-tertiary))]',
};

/** The glyph in the toast's first column, in its kind's color. */
export const toastGlyphClasses: Record<ToastKind, string> = {
  approve: 'text-github-accent-text',
  reject: 'text-verdict-reject',
  warning: 'text-github-warning',
  info: 'text-github-text-secondary',
};

// A black shadow cannot show on the dark theme's near-black page, so there a dark ring outside
// the border and a denser shadow set the toast off, as GitHub's dark overlays do. The width is
// fixed, so the toasts in the stack line up.
export const toastClasses = (kind: ToastKind) =>
  `toast relative grid w-[min(32rem,calc(100vw-16px))] grid-cols-[1.125rem_minmax(0,1fr)_1.75rem] gap-x-2.5 rounded-md border border-l-4 ${frameClasses[kind]} py-3.5 pr-2.5 pl-4 text-sm leading-5 text-github-text-primary shadow-[0_12px_32px_rgb(31_35_40/0.3),0_2px_6px_rgb(31_35_40/0.16)] dark:shadow-[0_0_0_1px_rgb(1_4_9/0.9),0_16px_40px_rgb(1_4_9/0.9)]`;

export const toastGlyphCellClasses = 'pt-0.5';
// Every line in a toast is 8px from the next.
export const toastTitleClasses = 'mb-2 font-semibold';
// Dimmed by opacity, not the theme's secondary gray, which drops under 4.5:1 on the tints
// (4.0:1 on the dark approve tint); this stays above 5:1 on every kind in both themes.
export const toastDetailClasses = 'text-github-text-primary/75 [overflow-wrap:anywhere]';
// One row: a long label shrinks and truncates rather than wrapping its button onto a line of
// its own.
export const toastActionsClasses =
  'col-span-2 col-start-2 mt-2.5 flex min-w-0 items-center justify-end gap-2 pr-1.5';
export const toastDismissClasses =
  '-mt-1 inline-flex size-7 items-center justify-center rounded-md text-github-text-secondary transition-colors hover:text-github-text-primary';
// On the toast's tinted background, its secondary buttons take the page's secondary one.
export const toastButtonClasses =
  'inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-github-border bg-github-bg-secondary px-3 text-sm font-medium text-github-text-primary enabled:hover:border-github-text-secondary disabled:opacity-60';
