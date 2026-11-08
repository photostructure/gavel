import type { DiffSelection } from '../../types/diff';
import { createDiffSelection } from '../../utils/diffSelection';

export type ReviewSelection = DiffSelection & { retained?: true };

export function readReviewLocation(): ReviewSelection | null {
  const params = new URLSearchParams(window.location.search);
  const reviewName = params.get('review');
  if (reviewName !== null) {
    // Keep explicit names, including malformed ones, for the server to validate.
    // Falling back would show an unrelated review instead of an error.
    return { baseCommitish: '', targetCommitish: '', reviewName };
  }
  const base = params.get('base');
  const target = params.get('target');
  const mode = params.get('baseMode');
  if (base === null || !target || (mode !== null && mode !== 'direct' && mode !== 'merge-base')) {
    return null;
  }
  return {
    ...createDiffSelection(base, target, mode === 'merge-base' ? mode : undefined),
    ...(params.get('retainedReview') === '1' ? { retained: true as const } : {}),
  };
}

/** Restore a resolved history entry; initial page loads keep following the URL refs. */
export function readReviewHistoryLocation(): ReviewSelection | null {
  const state: unknown = window.history.state;
  if (state && typeof state === 'object' && 'gavelReview' in state) {
    const saved = state.gavelReview;
    if (
      saved &&
      typeof saved === 'object' &&
      'href' in saved &&
      saved.href === window.location.href &&
      'selection' in saved
    ) {
      const selection = saved.selection;
      if (
        selection &&
        typeof selection === 'object' &&
        'baseCommitish' in selection &&
        typeof selection.baseCommitish === 'string' &&
        'targetCommitish' in selection &&
        typeof selection.targetCommitish === 'string' &&
        (!('baseMode' in selection) ||
          selection.baseMode === 'direct' ||
          selection.baseMode === 'merge-base')
      ) {
        return {
          ...createDiffSelection(
            selection.baseCommitish,
            selection.targetCommitish,
            'baseMode' in selection && selection.baseMode === 'merge-base'
              ? 'merge-base'
              : undefined,
            'reviewName' in selection && typeof selection.reviewName === 'string'
              ? selection.reviewName
              : undefined,
          ),
          retained: true,
        };
      }
    }
  }
  return readReviewLocation();
}

export function writeReviewLocation(
  selection: ReviewSelection,
  mode: 'push' | 'replace',
  resolvedSelection?: ReviewSelection,
): void {
  const url = new URL(window.location.href);
  if (selection.reviewName !== undefined) {
    url.searchParams.set('review', selection.reviewName);
    for (const parameter of ['base', 'target', 'baseMode', 'retainedReview']) {
      url.searchParams.delete(parameter);
    }
  } else {
    url.searchParams.delete('review');
    url.searchParams.set('base', selection.baseCommitish);
    url.searchParams.set('target', selection.targetCommitish);
    if (selection.baseMode === 'merge-base') url.searchParams.set('baseMode', 'merge-base');
    else url.searchParams.delete('baseMode');
    if (selection.retained) url.searchParams.set('retainedReview', '1');
    else url.searchParams.delete('retainedReview');
  }
  // Preserve unrelated URL parameters, fragments and history state.
  if (mode === 'replace' && url.href === window.location.href && !resolvedSelection) return;
  const previous: unknown = window.history.state;
  const state = resolvedSelection
    ? {
        ...(previous && typeof previous === 'object' ? previous : {}),
        gavelReview: { href: url.href, selection: resolvedSelection },
      }
    : previous;
  if (mode === 'push') window.history.pushState(state, '', url);
  else window.history.replaceState(state, '', url);
}
