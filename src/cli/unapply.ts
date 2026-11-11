import { execFile } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  filesWithoutAddedLines,
  getCaptureRepository,
  gitEnvironment,
  selectCapture,
} from '../server/review-capture.js';
import { openReviewStore } from '../server/review-store.js';
import type { ReviewCapture } from '../types/review.js';

const execFileAsync = promisify(execFile);

export interface RevertResult {
  direction: 'unapply' | 'reapply';
  label: string;
  patchDigest: string;
  baseCommit: string;
  dryRun: boolean;
  /** Whether git apply ran on the working tree; with `rejected`, it left those hunks out. */
  written: boolean;
  /** Why nothing was written: the capture's paths that are staged. */
  refused?: string;
  /** The git apply commands run, and the files each covered, after the exact apply failed. */
  fallback?: { command: string; files: string[] }[];
  /** git apply's message for the hunks and files the fallback left in place. */
  rejected?: string;
  /** The recovery stash stored before writing, when there were tracked changes to save. */
  stash?: string;
  /** git apply --stat for the change. */
  stat: string;
}

async function run(root: string, args: string[], input?: string) {
  const command = execFileAsync('git', args, {
    cwd: root,
    // English messages, so `rejected` can keep git apply's "error:" lines.
    env: { ...gitEnvironment(root), LC_ALL: 'C' },
    maxBuffer: Number.POSITIVE_INFINITY,
  });
  command.child.stdin?.end(input);
  return command;
}

const git = async (root: string, args: string[], input?: string) =>
  (await run(root, args, input)).stdout;

/** The paths in `git apply --numstat -z` output; for a rename, git apply lists only its new path. */
const numstatPaths = (output: string) =>
  output
    .split('\0')
    .map((record) => record.split('\t').slice(2).join('\t'))
    .filter(Boolean);

/**
 * Reverses a capture's patch in the working tree with `git apply -R` (unapply), or applies it
 * again (reapply), after storing a stash of the tracked files. When the exact apply fails, a
 * `--reject` pass writes the hunks that apply and reports the rest. Staged content is left
 * alone, and unapply refuses while any of the capture's paths are staged.
 */
export async function revertCapture(
  capture: ReviewCapture,
  options: { cwd: string; direction: RevertResult['direction']; label: string; dryRun?: boolean },
): Promise<RevertResult> {
  const repository = await getCaptureRepository(options.cwd);
  if (repository.repositoryId !== capture.repositoryId)
    throw new Error(
      `The capture belongs to the worktree at ${capture.repositoryRoot}; run this there`,
    );
  const root = repository.repositoryRoot;
  const reverse = options.direction === 'unapply' ? ['-R'] : [];
  const apply = (flags: string[], patch = capture.patch) =>
    run(root, ['apply', ...reverse, ...flags, '-'], patch);
  const stat = await git(root, ['apply', ...reverse, '--stat', '-'], capture.patch);
  const result = (fields: Partial<RevertResult> = {}): RevertResult => ({
    direction: options.direction,
    label: options.label,
    patchDigest: capture.patchDigest,
    baseCommit: capture.baseCommit,
    dryRun: options.dryRun === true,
    written: false,
    stat,
    ...fields,
  });
  // The paths as git apply will write them (it strips a plain patch's a/ and b/ prefixes).
  // Each direction names only a rename's destination, so together they name both of its paths.
  const paths = (
    await Promise.all(
      [['-R'], []].map((flags) =>
        git(root, ['apply', ...flags, '--numstat', '-z', '-'], capture.patch),
      ),
    )
  ).flatMap(numstatPaths);
  if (options.direction === 'unapply') {
    // Matched literally, so a path like `r/[id].tsx` is not a glob.
    const staged = (
      await git(root, ['--literal-pathspecs', 'diff', '--cached', '--name-only', '--', ...paths])
    ).trim();
    // The rejected change must not stay staged for another session's commit to pick up.
    if (staged) return result({ refused: `Unstage these paths first:\n${staged}` });
  }
  const exact = await apply(['--check']).then(
    () => true,
    () => false,
  );
  // When another edit is within git apply's 3 lines of context, unapply matches only each
  // hunk's own lines (-C0), as for CHANGELOG bullets that sessions add next to each other.
  // A hunk with no added lines has no own lines to match once reversed (nor does any hunk
  // that reapply inserts), and -C0 would put it at its old line number, so those files keep
  // the context check. --reject writes the hunks that apply and leaves the rest in place.
  const plain = options.direction === 'unapply' ? filesWithoutAddedLines(capture) : [];
  const groups = [
    {
      flags: options.direction === 'unapply' ? ['-C0'] : [],
      ids: capture.files.map((file) => file.id).filter((id) => !plain.includes(id)),
    },
    { flags: [], ids: plain },
  ]
    .filter((group) => group.ids.length > 0)
    .map(({ flags, ids }) => ({ flags, part: selectCapture(capture, ids) }));
  // Without --reject, a check stops at a file's first failing hunk. With it, the check names
  // every hunk but exits 0, and --reject's --verbose adds progress lines and the context
  // that each failed search looked for; only the other "error:" lines name the failures.
  const checks = exact
    ? []
    : await Promise.all(
        groups.map(async ({ flags, part }) =>
          (await apply(['--check', ...flags, '--reject'], part.patch)).stderr
            .split('\n')
            .filter((line) => line.startsWith('error:') && line !== 'error: while searching for:')
            .join('\n'),
        ),
      );
  const rejected = checks.filter(Boolean).join('\n');
  const fields = exact
    ? {}
    : {
        fallback: await Promise.all(
          groups.map(async ({ flags, part }) => ({
            command: ['git apply', ...reverse, ...flags, '--reject'].join(' '),
            files: numstatPaths(
              await git(root, ['apply', ...reverse, '--numstat', '-z', '-'], part.patch),
            ),
          })),
        ),
        ...(rejected ? { rejected } : {}),
      };
  if (options.dryRun) return result(fields);
  // An emergency snapshot of whole tracked files, other sessions' edits included; files the
  // capture created come back with reapply. With nothing to save, Git prints nothing and
  // exits 0, or, when files match the index but their stat data is stale, as after a git
  // apply, exits 1 with no message.
  const stash =
    repository.baseCommit === 'unborn'
      ? ''
      : await git(root, ['stash', 'create']).then(
          (output) => output.trim(),
          (error: { code?: unknown; stderr?: string }) => {
            if (error.code === 1 && !error.stderr?.trim()) return '';
            throw error;
          },
        );
  if (stash)
    await git(root, [
      'stash',
      'store',
      '-m',
      `gavel review ${options.direction} ${options.label} ${capture.patchDigest.slice(0, 12)}`,
      stash,
    ]);
  if (exact) await apply([]);
  else
    for (const [index, { flags, part }] of groups.entries())
      await apply([...flags, '--reject'], part.patch).catch((error: { code?: unknown }) => {
        // Exit 1 is the rejects the check reported; anything else is unexpected.
        if (error.code !== 1 || !checks[index]) throw error;
      });
  // The rejected hunks are in `rejected`; .rej files would be left untracked in the checkout.
  if (rejected) for (const path of paths) rmSync(join(root, `${path}.rej`), { force: true });
  return result({ written: true, ...(stash ? { stash } : {}), ...fields });
}

/**
 * The current capture of the saved named review called `name` in this worktree. When several
 * saved reviews share the name, `patchDigest` picks one; it may name any of a review's captures.
 */
export async function findSavedCapture(
  cwd: string,
  name: string,
  patchDigest?: string,
): Promise<ReviewCapture> {
  const repository = await getCaptureRepository(cwd);
  const store = await openReviewStore(cwd);
  const reviews = store
    .list()
    .filter(
      (saved) =>
        saved.selection.reviewName === name &&
        saved.repositoryId === repository.repositoryId &&
        saved.captures?.length,
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  if (reviews.length === 0)
    throw new Error(
      `No saved named review "${name}" in this worktree; pass its patch with - instead`,
    );
  if (patchDigest !== undefined) {
    for (const review of reviews) {
      const version = review.captures?.find((saved) => saved.patchDigest === patchDigest);
      if (version) return store.loadCapture(repository.repositoryId, version);
    }
    throw new Error(`No saved named review "${name}" has capture ${patchDigest}`);
  }
  const current = reviews.map((review) => ({ review, version: review.captures?.at(-1) }));
  if (current.length > 1)
    throw new Error(
      `${current.length} saved named reviews are called "${name}"; pass --patch-digest with one of:\n${current
        .map(
          ({ review, version }) =>
            `  ${version?.patchDigest} (saved ${review.updatedAt}): ${review.summary.commitMessage.split('\n')[0] ?? ''}`,
        )
        .join('\n')}`,
    );
  const version = current[0]?.version;
  if (!version) throw new Error(`Saved named review "${name}" has no capture`);
  return store.loadCapture(repository.repositoryId, version);
}
