import { simpleGit, type SimpleGit } from 'simple-git';

// simple-git 4 strips ambient GIT_* variables from the git processes it spawns.
// Keep repository and index selection so these calls agree with gavel's
// direct `git` invocations (getGitRoot, getBlobContent).
const REPOSITORY_ENVIRONMENT = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE'];

/** Keep path bytes in ASCII: a raw non-UTF-8 byte would not survive decoding Git's output. */
export const QUOTE_PATH_CONFIG = 'core.quotePath=true';

/** Pin the parts of a patch's file headers that the user's diff.* config can otherwise change. */
export const PATCH_HEADER_OPTIONS = ['--submodule=short', '--src-prefix=a/', '--dst-prefix=b/'];

export function createGitClient(baseDir?: string): SimpleGit {
  return simpleGit(baseDir, {
    allowEnvironment: REPOSITORY_ENVIRONMENT,
    config: [QUOTE_PATH_CONFIG],
  });
}
