import type { DiffSelection } from '../../types/diff';
import { createDiffSelection } from '../../utils/diffSelection';

import { withoutLinkPlace } from './commentLinks';

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

/**
 * Sets the URL fragment (a comment link's place) in a new or the current history entry. An
 * entry that remembered its resolved review keeps it, since the review has not changed.
 */
export function writeLocationHash(hash: string, mode: 'push' | 'replace'): void {
  const url = new URL(window.location.href);
  url.hash = hash;
  const previous: unknown = window.history.state;
  const state =
    previous &&
    typeof previous === 'object' &&
    'gavelReview' in previous &&
    previous.gavelReview &&
    typeof previous.gavelReview === 'object' &&
    'href' in previous.gavelReview &&
    previous.gavelReview.href === window.location.href
      ? { ...previous, gavelReview: { ...previous.gavelReview, href: url.href } }
      : previous;
  if (mode === 'push') window.history.pushState(state, '', url);
  else window.history.replaceState(state, '', url);
}

function setReviewParams(params: URLSearchParams, selection: ReviewSelection): void {
  if (selection.reviewName !== undefined) {
    params.set('review', selection.reviewName);
    for (const parameter of ['base', 'target', 'baseMode', 'retainedReview']) {
      params.delete(parameter);
    }
  } else {
    params.delete('review');
    params.set('base', selection.baseCommitish);
    params.set('target', selection.targetCommitish);
    if (selection.baseMode === 'merge-base') params.set('baseMode', 'merge-base');
    else params.delete('baseMode');
    if (selection.retained) params.set('retainedReview', '1');
    else params.delete('retainedReview');
  }
}

/** A relative URL that opens another review the way its review tab does, at `fragment`. */
export function reviewHref(selection: DiffSelection, fragment: string): string {
  const params = new URLSearchParams();
  setReviewParams(params, { ...selection, retained: true });
  return `?${params}${fragment}`;
}

export function writeReviewLocation(
  selection: ReviewSelection,
  mode: 'push' | 'replace',
  resolvedSelection?: ReviewSelection,
): void {
  const url = new URL(window.location.href);
  setReviewParams(url.searchParams, selection);
  // Preserve unrelated URL parameters, fragments and history state, except that a comment
  // link's place belongs to the review it was in.
  if (url.search !== window.location.search) url.hash = withoutLinkPlace(url.hash);
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
