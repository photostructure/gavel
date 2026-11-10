import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Reads the checkout a development build comes from: the HEAD commit, and a
 * sha256 over the uncommitted changes (`git diff HEAD --binary`, then each
 * untracked, non-ignored path and its contents), or null when there are none.
 * Like git, an untracked symlink contributes its target text and an untracked
 * nested repository only its path. Run `node dev/build-info.js` to print the
 * current values and compare them with a build's About panel.
 *
 * @param {string} cwd
 * @returns {{ commit: string, diffHash: string | null }}
 */
export function readBuildInfo(cwd) {
  /** @param {string[]} args */
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'buffer', maxBuffer: Infinity });
  const commit = git('rev-parse', 'HEAD').toString('utf8').trim();
  const root = git('rev-parse', '--show-toplevel').toString('utf8').trim();
  const diff = git('diff', 'HEAD', '--binary', '--no-ext-diff', '--no-color');
  const untracked = git('ls-files', '-z', '--others', '--exclude-standard', '--full-name', ':/')
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .sort();
  if (diff.length === 0 && untracked.length === 0) return { commit, diffHash: null };
  const hash = createHash('sha256').update(diff);
  for (const path of untracked) {
    hash.update(`\0${path}\0`);
    // git lists an untracked nested repository as its directory path with a trailing slash.
    if (path.endsWith('/')) continue;
    const file = join(root, path);
    hash.update(lstatSync(file).isSymbolicLink() ? readlinkSync(file) : readFileSync(file));
  }
  return { commit, diffHash: hash.digest('hex') };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  console.log(JSON.stringify(readBuildInfo(process.cwd()), null, 2));
}
