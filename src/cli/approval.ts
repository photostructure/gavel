import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Command } from 'commander';

import { digest, getGitCommonDirectory } from '../server/review-capture.js';
import { shortHash } from './utils.js';
import { REVIEW_RETENTION_MS, ReviewStore } from '../server/review-store.js';
import type { ReviewApproval } from '../types/conversation.js';
import type { DiffSelection } from '../types/diff.js';

const execFileAsync = promisify(execFile);

export interface ApprovalStatus {
  /** commit: a review of that commit as a target; patch: a review of exactly its patch. */
  match: 'commit' | 'patch';
  approved: boolean;
  name?: string;
  selection: DiffSelection;
  approval: ReviewApproval;
  commitMessage: string;
  updatedAt: string;
}

async function git(cwd: string, args: string[]): Promise<string> {
  return (await execFileAsync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))
    .stdout;
}

/**
 * Saved reviews of a commit, or of one patch, newest first. A commit matches a review that
 * targeted it and a named review of exactly `git diff --full-index <sha>^ <sha>`, as the difit
 * skill pipes it.
 */
export async function findApprovals(
  cwd: string,
  target: { commit?: string; patchDigest?: string },
): Promise<ApprovalStatus[]> {
  const store = new ReviewStore(join(await getGitCommonDirectory(cwd), 'difit'));
  let sha: string | undefined;
  let patchDigest = target.patchDigest;
  if (target.commit !== undefined) {
    sha = (await git(cwd, ['rev-parse', '--verify', `${target.commit}^{commit}`])).trim();
    // A root commit has no parent to diff against, so only a commit target can match it.
    const parents = (await git(cwd, ['rev-list', '--parents', '-n', '1', sha])).trim().split(' ');
    // --full-index: abbreviated object names grow with the repository and would change the digest.
    if (parents.length > 1)
      patchDigest = digest(await git(cwd, ['diff', '--full-index', `${sha}^`, sha]));
  }
  return store
    .list()
    .flatMap((review): ApprovalStatus[] => {
      const current = review.captures?.at(-1)?.patchDigest;
      const match =
        patchDigest !== undefined && current === patchDigest
          ? 'patch'
          : sha !== undefined &&
              !review.selection.reviewName &&
              review.selection.targetCommitish === shortHash(sha)
            ? 'commit'
            : undefined;
      if (!match) return [];
      return [
        {
          match,
          approved: review.approval.approved,
          ...(review.selection.reviewName ? { name: review.selection.reviewName } : {}),
          selection: review.selection,
          approval: review.approval,
          commitMessage: review.summary.commitMessage,
          updatedAt: review.updatedAt,
        },
      ];
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function createApprovalCommand(): Command {
  const status = new Command('status')
    .description('Print the saved reviews of a commit or patch and whether each is approved')
    .argument(
      '[commit]',
      'a commit; matches reviews of it and of `git diff --full-index <commit>^ <commit>`',
    )
    .option('--patch-digest <digest>', 'match the review whose current capture has this digest')
    .addHelpText(
      'after',
      `
Reads the reviews difit servers saved under <git-common-dir>/difit; no server needs to run.
Prints a JSON array, newest first, of {match, approved, name, selection, approval,
commitMessage, updatedAt}. An empty array means no saved review matches, for example: no
review of it was opened by a server that saves reviews, it went untouched for
${REVIEW_RETENTION_MS / 86_400_000} days and was deleted, or its patch was piped some other way than
\`git diff --full-index <commit>^ <commit>\`.
`,
    )
    .action(async (commit: string | undefined, options: { patchDigest?: string }) => {
      if ((commit === undefined) === (options.patchDigest === undefined)) {
        console.error('Give a commit or --patch-digest, not both');
        process.exitCode = 1;
        return;
      }
      try {
        const found = await findApprovals(process.cwd(), {
          ...(commit !== undefined ? { commit } : {}),
          ...(options.patchDigest !== undefined ? { patchDigest: options.patchDigest } : {}),
        });
        console.log(JSON.stringify(found, null, 2));
      } catch (error) {
        // The error's message without a Node stack trace: for a Git failure, the command and Git's
        // own "fatal:" line; for a corrupt saved review, its path.
        console.error(error instanceof Error ? error.message.trim() : String(error));
        process.exitCode = 1;
      }
    });
  return new Command('approval')
    .description('Look up approvals that difit servers saved for this repository')
    .addCommand(status);
}
