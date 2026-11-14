import type { BaseMode, DiffSelection } from '../types/diff.js';

export function normalizeBaseMode(baseMode?: BaseMode): BaseMode {
  return baseMode ?? 'direct';
}

export function createDiffSelection(
  baseCommitish: string,
  targetCommitish: string,
  baseMode?: BaseMode,
  reviewName?: string,
): DiffSelection {
  if (normalizeBaseMode(baseMode) === 'merge-base') {
    return {
      baseCommitish,
      targetCommitish,
      baseMode: 'merge-base',
      ...(reviewName ? { reviewName } : {}),
    };
  }

  return {
    baseCommitish,
    targetCommitish,
    ...(reviewName ? { reviewName } : {}),
  };
}

export function diffSelectionsEqual(
  left: DiffSelection | null | undefined,
  right: DiffSelection | null | undefined,
): boolean {
  if (left?.reviewName || right?.reviewName) {
    return Boolean(left?.reviewName && left.reviewName === right?.reviewName);
  }
  return (
    left?.baseCommitish === right?.baseCommitish &&
    left?.targetCommitish === right?.targetCommitish &&
    normalizeBaseMode(left?.baseMode) === normalizeBaseMode(right?.baseMode)
  );
}

/** How inbox events, server messages, and `comment snapshot --review` name a review. */
export function reviewLabel({ reviewName, baseCommitish, targetCommitish }: DiffSelection): string {
  return reviewName ?? `${baseCommitish}..${targetCommitish}`;
}

export function getDiffSelectionKey(selection: DiffSelection): string {
  if (selection.reviewName) return JSON.stringify(['named-review', selection.reviewName]);
  return `${selection.baseCommitish}:${selection.targetCommitish}:${normalizeBaseMode(selection.baseMode)}`;
}

/** The index or worktree, whose content can change without any ref moving. */
export function isWorkingTreeTarget(targetCommitish: string): boolean {
  return targetCommitish === '.' || targetCommitish === 'staged' || targetCommitish === 'working';
}

export function getMergeBaseTargetRef(targetCommitish: string): string {
  if (isWorkingTreeTarget(targetCommitish)) {
    return 'HEAD';
  }

  return targetCommitish;
}
