import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { promisify } from 'node:util';

import type { CapturedFile, CapturedHunk, ReviewCapture } from '../types/review.js';

export const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;

const execFileAsync = promisify(execFile);
const REPOSITORY_ENVIRONMENT = new Set(['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']);
const GIT_OPTIONS = [
  '-c',
  'core.quotePath=true',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'diff.suppressBlankEmpty=false',
  '-c',
  'diff.autoRefreshIndex=false',
];
const DIFF_OPTIONS = [
  '--patch',
  '--binary',
  '--full-index',
  '--no-color',
  '--no-ext-diff',
  '--no-textconv',
  '--submodule=short',
  '--ignore-submodules=none',
  '--word-diff=none',
  '--output-indicator-new=+',
  '--output-indicator-old=-',
  '--output-indicator-context= ',
  '--no-relative',
  '--src-prefix=a/',
  '--dst-prefix=b/',
  '--line-prefix=',
];

interface CaptureRepository {
  repositoryRoot: string;
  repositoryId: string;
  baseCommit: string;
}

interface PatchLine {
  text: string;
  start: number;
  end: number;
}

interface RawHunk {
  raw: string;
  metadata: Omit<CapturedHunk, 'id'>;
}

interface RawFile {
  raw: string;
  header: string;
  path: string;
  oldPath?: string;
  hunks: RawHunk[];
  partialSafe: boolean;
}

export function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function repositoryId(repositoryRoot: string): string {
  return digest(repositoryRoot);
}

export function gitEnvironment(cwd: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !key.startsWith('GIT_') || REPOSITORY_ENVIRONMENT.has(key),
      ),
    ),
    GIT_OPTIONAL_LOCKS: '0',
  };
  for (const key of REPOSITORY_ENVIRONMENT) {
    const value = environment[key];
    if (value) environment[key] = resolve(cwd, value);
  }
  return environment;
}

async function runGit(
  cwd: string,
  args: string[],
  acceptedCodes: number[] = [],
  environment = gitEnvironment(cwd),
  input?: string,
): Promise<{ output: Buffer; code: number }> {
  try {
    const command = execFileAsync('git', [...GIT_OPTIONS, ...args], {
      cwd,
      env: environment,
      encoding: 'buffer',
      maxBuffer: MAX_CAPTURE_BYTES + 1,
    });
    command.child.stdin?.end(input);
    const result = await command;
    return { output: result.stdout, code: 0 };
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      if (typeof error.code === 'number' && acceptedCodes.includes(error.code)) {
        const output =
          'stdout' in error && Buffer.isBuffer(error.stdout) ? error.stdout : Buffer.alloc(0);
        return { output, code: error.code };
      }
      if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
        throw new Error('Review capture exceeds the 8 MiB limit');
      }
    }
    throw error;
  }
}

function decodeOutput(output: Buffer, kind: 'patch' | 'path' = 'patch'): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(output);
  } catch {
    if (kind === 'path')
      throw new Error(
        'Git paths must contain valid UTF-8; rename non-UTF-8 paths before capturing them',
      );
    throw new Error(
      'Review patches must contain valid UTF-8; mark non-text files as binary in Git attributes',
    );
  }
}

/** Resolve the actual worktree without refreshing or writing its index. */
export async function getCaptureRepository(cwd = process.cwd()): Promise<CaptureRepository> {
  const rootOutput = await runGit(cwd, ['rev-parse', '--show-toplevel']);
  const repositoryRoot = await realpath(decodeOutput(rootOutput.output, 'path').replace(/\n$/, ''));
  const head = await runGit(cwd, ['rev-parse', '--verify', 'HEAD^{commit}'], [128]);
  let baseCommit = decodeOutput(head.output).trim();
  if (head.code !== 0) {
    const symbolicHead = await runGit(cwd, ['symbolic-ref', '--quiet', 'HEAD']);
    const ref = decodeOutput(symbolicHead.output).trim();
    const existingRef = await runGit(cwd, ['show-ref', '--verify', '--quiet', ref], [1]);
    if (existingRef.code === 0) throw new Error('HEAD does not resolve to a commit');
    baseCommit = 'unborn';
  }
  return { repositoryRoot, repositoryId: repositoryId(repositoryRoot), baseCommit };
}

/** The Git directory a repository's worktrees share, as an absolute path. */
export async function getGitCommonDirectory(cwd: string): Promise<string> {
  // Git prints the path relative to cwd; --path-format=absolute needs Git 2.31.
  const { output } = await runGit(cwd, ['rev-parse', '--git-common-dir']);
  return resolve(cwd, decodeOutput(output, 'path').replace(/\n$/, ''));
}

function patchLines(patch: string): PatchLine[] {
  const lines: PatchLine[] = [];
  let start = 0;
  while (start < patch.length) {
    const newline = patch.indexOf('\n', start);
    const end = newline === -1 ? patch.length : newline + 1;
    lines.push({ text: patch.slice(start, newline === -1 ? end : newline), start, end });
    start = end;
  }
  return lines;
}

function decodePath(raw: string, stripPrefix: boolean): string | undefined {
  let value = raw.split('\t')[0] ?? '';
  if (value.startsWith('"')) {
    if (!value.endsWith('"')) throw new Error('Malformed quoted patch path');
    value = value.slice(1, -1);
    const parts: Buffer[] = [];
    const escapes: Record<string, string> = {
      a: '\x07',
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
      v: '\v',
      '\\': '\\',
      '"': '"',
    };
    for (let i = 0; i < value.length;) {
      if (value[i] !== '\\') {
        const character = String.fromCodePoint(value.codePointAt(i) ?? 0);
        parts.push(Buffer.from(character));
        i += character.length;
        continue;
      }
      i++;
      const octal = value.slice(i).match(/^[0-7]{1,3}/)?.[0];
      if (octal) {
        parts.push(Buffer.from([parseInt(octal, 8)]));
        i += octal.length;
      } else {
        const escaped = value[i];
        if (!escaped || escapes[escaped] === undefined)
          throw new Error('Malformed quoted patch path');
        parts.push(Buffer.from(escapes[escaped]));
        i++;
      }
    }
    try {
      value = decodeOutput(Buffer.concat(parts), 'path');
    } catch {
      throw new Error(`Patch path is not valid UTF-8: ${raw}`);
    }
  }
  if (value === '/dev/null') return undefined;
  if (stripPrefix && /^[abciw]\//.test(value)) value = value.slice(2);
  if (!value || value.includes('\0')) throw new Error('Invalid patch path');
  return value;
}

function gitHeaderPaths(header: string): { oldPath?: string; path?: string } {
  const raw = header.slice('diff --git '.length);
  const candidates: { oldPath?: string; path?: string }[] = [];
  const leadingQuoted = raw.startsWith('"');
  let closingQuote = -1;
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const character = raw[i];
    if (escaped) {
      escaped = false;
    } else if (character === '\\' && quoted) {
      escaped = true;
    } else if (character === '"') {
      quoted = !quoted;
      if (leadingQuoted && !quoted && closingQuote === -1) closingQuote = i;
    } else if (
      character === ' ' &&
      !quoted &&
      (!leadingQuoted || i === closingQuote + 1) &&
      /^(?:"?[abciw]\/)/.test(raw.slice(i + 1))
    ) {
      candidates.push({
        oldPath: decodePath(raw.slice(0, i), true),
        path: decodePath(raw.slice(i + 1), true),
      });
    }
  }
  const samePath = candidates.find((candidate) => candidate.path === candidate.oldPath);
  return samePath ?? (candidates.length === 1 ? (candidates[0] ?? {}) : {});
}

function parseHunk(
  patch: string,
  lines: PatchLine[],
  start: number,
): { hunk: RawHunk; next: number } {
  const first = lines[start];
  const match = first?.text.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
  if (!first || !match) throw new Error('Unsupported or malformed patch hunk');
  const metadata = {
    oldStart: Number(match[1]),
    oldLines: Number(match[2] ?? 1),
    newStart: Number(match[3]),
    newLines: Number(match[4] ?? 1),
  };
  if (!Object.values(metadata).every(Number.isSafeInteger))
    throw new Error('Invalid patch hunk range');
  let oldRemaining = metadata.oldLines;
  let newRemaining = metadata.newLines;
  let next = start + 1;
  let changes = 0;
  while (oldRemaining > 0 || newRemaining > 0) {
    const line = lines[next]?.text;
    if (line === undefined) throw new Error('Truncated patch hunk');
    if (line.startsWith(' ')) {
      oldRemaining--;
      newRemaining--;
    } else if (line.startsWith('-')) {
      oldRemaining--;
      changes++;
    } else if (line.startsWith('+')) {
      newRemaining--;
      changes++;
    } else {
      throw new Error('Malformed patch hunk body');
    }
    if (oldRemaining < 0 || newRemaining < 0)
      throw new Error('Patch hunk range does not match its contents');
    next++;
    if (lines[next]?.text === '\\ No newline at end of file') next++;
  }
  if (changes === 0) throw new Error('Patch hunk contains no changes');
  const end = lines[next - 1]?.end ?? first.end;
  return { hunk: { raw: patch.slice(first.start, end), metadata }, next };
}

function parseGitFile(patch: string): RawFile {
  const lines = patchLines(patch);
  const first = lines[0];
  if (!first?.text.startsWith('diff --git ')) throw new Error('Unsupported patch format');
  const paths = gitHeaderPaths(first.text);
  let oldPath = paths.oldPath;
  let path = paths.path;
  let oldMarker: string | undefined;
  let newMarker: string | undefined;
  let cursor = 1;
  let partialSafe = true;
  let binary = false;
  for (; cursor < lines.length; cursor++) {
    const line = lines[cursor]?.text ?? '';
    if (line.startsWith('@@')) break;
    if (line === 'GIT binary patch' || line.startsWith('Binary files ')) {
      binary = true;
      partialSafe = false;
      break;
    }
    if (line.startsWith('--- ')) {
      oldMarker = line.slice(4);
      oldPath = decodePath(oldMarker, true);
    } else if (line.startsWith('+++ ')) {
      newMarker = line.slice(4);
      path = decodePath(newMarker, true);
    } else if (line.startsWith('rename from ') || line.startsWith('copy from ')) {
      oldPath = decodePath(line.slice(line.startsWith('rename') ? 12 : 10), false);
      partialSafe = false;
    } else if (line.startsWith('rename to ') || line.startsWith('copy to ')) {
      path = decodePath(line.slice(line.startsWith('rename') ? 10 : 8), false);
      partialSafe = false;
    } else if (/^(?:old mode|new mode|new file mode|deleted file mode) \d+$/.test(line)) {
      partialSafe = false;
    } else if (/^index [\da-f]+\.\.[\da-f]+(?: \d+)?$/i.test(line)) {
      if (line.endsWith(' 160000')) partialSafe = false;
    } else if (!/^(?:dis)?similarity index \d+%$/.test(line)) {
      throw new Error(`Unsupported patch header: ${line.slice(0, 80)}`);
    }
  }
  path ??= oldPath;
  if (!path) throw new Error('Cannot determine patch file path');
  if (oldMarker === '/dev/null' || newMarker === '/dev/null') partialSafe = false;
  if (oldPath && oldPath !== path) partialSafe = false;
  const headerEnd = lines[cursor]?.start ?? patch.length;
  const hunks: RawHunk[] = [];
  if (!binary) {
    while (cursor < lines.length) {
      const parsed = parseHunk(patch, lines, cursor);
      hunks.push(parsed.hunk);
      cursor = parsed.next;
    }
  }
  return {
    raw: patch,
    header: patch.slice(0, headerEnd),
    path,
    oldPath: oldPath !== path ? oldPath : undefined,
    hunks,
    partialSafe,
  };
}

function parsePatch(patch: string): RawFile[] {
  if (Buffer.byteLength(patch, 'utf8') > MAX_CAPTURE_BYTES)
    throw new Error('Review capture exceeds the 8 MiB limit');
  if (Buffer.from(patch).toString('utf8') !== patch)
    throw new Error('Review patches must contain valid UTF-8');
  if (patch === '') return [];
  if (patch.startsWith('diff --git ')) {
    // Only LF separates Git records; JS multiline anchors also match CR and Unicode separators.
    const starts = [...patch.matchAll(/(?<=^|\n)diff --git /g)].map((match) => match.index);
    return starts.map((start, index) =>
      parseGitFile(patch.slice(start, starts[index + 1] ?? patch.length)),
    );
  }
  // Plain unified patches have no Git metadata. Match the viewer's CRLF transport
  // handling only in parsed records; offsets/raw slices retain the original bytes.
  // Consume hunk lengths before headers, since removed content may start with ---.
  const lines = patchLines(patch).map((line) =>
    line.text.endsWith('\r') ? { ...line, text: line.text.slice(0, -1) } : line,
  );
  const files: RawFile[] = [];
  let cursor = 0;
  while (cursor < lines.length) {
    const first = lines[cursor];
    const second = lines[cursor + 1];
    if (!first?.text.startsWith('--- ') || !second?.text.startsWith('+++ '))
      throw new Error('Capture requires a Git or unified patch');
    const oldPath = decodePath(first.text.slice(4), false);
    const newPath = decodePath(second.text.slice(4), false);
    const path = newPath ?? oldPath;
    if (!path) throw new Error('Cannot determine patch file path');
    cursor += 2;
    const hunks: RawHunk[] = [];
    while (lines[cursor]?.text.startsWith('@@')) {
      const parsed = parseHunk(patch, lines, cursor);
      hunks.push(parsed.hunk);
      cursor = parsed.next;
    }
    if (hunks.length === 0) throw new Error('Unified patch file contains no hunks');
    files.push({
      raw: patch.slice(first.start, lines[cursor]?.start ?? patch.length),
      header: patch.slice(first.start, second.end),
      path,
      oldPath: oldPath !== path ? oldPath : undefined,
      hunks,
      partialSafe: oldPath === newPath && oldPath !== undefined,
    });
  }
  return files;
}

/** Build an immutable catalogue from the exact patch, without running Git. */
export function capturePatch(
  patch: string,
  context: { repositoryRoot: string; baseCommit: string },
): ReviewCapture {
  if (typeof patch !== 'string') throw new Error('Capture patch must be a string');
  if (typeof context.repositoryRoot !== 'string' || !isAbsolute(context.repositoryRoot))
    throw new Error('Capture repository root must be an absolute path');
  if (!/^(?:[a-f\d]{40}|[a-f\d]{64}|unborn)$/i.test(context.baseCommit))
    throw new Error('Capture base must be a full commit hash or unborn');
  const repositoryRoot = resolve(context.repositoryRoot);
  const patchDigest = digest(patch);
  const rawFiles = parsePatch(patch);
  return {
    schemaVersion: 1,
    repositoryRoot,
    repositoryId: repositoryId(repositoryRoot),
    baseCommit: context.baseCommit,
    patch,
    patchDigest,
    files: rawFiles.map((file, fileIndex) => ({
      id: `${patchDigest}:f${fileIndex + 1}`,
      path: file.path,
      oldPath: file.oldPath,
      hunks: file.hunks.map((hunk, hunkIndex) => ({
        id: `${patchDigest}:f${fileIndex + 1}:h${hunkIndex + 1}`,
        ...hunk.metadata,
      })),
    })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function catalogueMatches(value: unknown, files: CapturedFile[]): boolean {
  if (!Array.isArray(value) || value.length !== files.length) return false;
  return files.every((expected, index) => {
    const file: unknown = value[index];
    if (
      !isRecord(file) ||
      file.id !== expected.id ||
      file.path !== expected.path ||
      file.oldPath !== expected.oldPath ||
      !Array.isArray(file.hunks) ||
      file.hunks.length !== expected.hunks.length
    )
      return false;
    const hunks: unknown[] = file.hunks;
    return expected.hunks.every((hunk, hunkIndex) => {
      const actual: unknown = hunks[hunkIndex];
      return (
        isRecord(actual) &&
        actual.id === hunk.id &&
        actual.oldStart === hunk.oldStart &&
        actual.oldLines === hunk.oldLines &&
        actual.newStart === hunk.newStart &&
        actual.newLines === hunk.newLines
      );
    });
  });
}

/** Validate persisted JSON by deriving every identity and range from its patch. */
export function validateCapture(value: unknown): ReviewCapture {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('schemaVersion' in value) ||
    value.schemaVersion !== 1
  )
    throw new Error('Unsupported review capture schema');
  if (
    !('patch' in value) ||
    typeof value.patch !== 'string' ||
    !('repositoryRoot' in value) ||
    typeof value.repositoryRoot !== 'string' ||
    !('baseCommit' in value) ||
    typeof value.baseCommit !== 'string'
  )
    throw new Error('Malformed review capture');
  const capture = capturePatch(value.patch, {
    repositoryRoot: value.repositoryRoot,
    baseCommit: value.baseCommit,
  });
  if (!('patchDigest' in value) || value.patchDigest !== capture.patchDigest)
    throw new Error('Review capture patch digest does not match its patch');
  if (!('repositoryId' in value) || value.repositoryId !== capture.repositoryId)
    throw new Error('Review capture repository ID does not match its root');
  if (!('files' in value) || !catalogueMatches(value.files, capture.files))
    throw new Error('Review capture catalogue does not match its patch');
  return capture;
}

/** IDs of the files with a hunk that adds no lines, such as a hunk that only deletes lines. */
export function filesWithoutAddedLines(capture: ReviewCapture): string[] {
  const rawFiles = parsePatch(capture.patch);
  return capture.files
    .filter((_file, index) =>
      rawFiles[index]?.hunks.some(
        (hunk) =>
          !hunk.raw
            .split('\n')
            .slice(1)
            .some((line) => line.startsWith('+')),
      ),
    )
    .map((file) => file.id);
}

/** Select only explicit immutable IDs; file-only changes require a file ID. */
export function selectCapture(value: ReviewCapture, ids: string[]): ReviewCapture {
  const capture = validateCapture(value);
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string'))
    throw new Error('Capture selection IDs must be strings');
  if (ids.length === 0) return capture;
  const selected = new Set(ids);
  const known = new Set(
    capture.files.flatMap((file) => [file.id, ...file.hunks.map((hunk) => hunk.id)]),
  );
  for (const id of selected) {
    if (!known.has(id)) throw new Error(`Unknown or stale capture selection ID: ${id}`);
  }
  const rawFiles = parsePatch(capture.patch);
  const sections: string[] = [];
  capture.files.forEach((file, index) => {
    const raw = rawFiles[index];
    if (!raw) throw new Error('Review capture catalogue is incomplete');
    if (selected.has(file.id)) {
      sections.push(raw.raw);
      return;
    }
    const hunks = raw.hunks.filter((_hunk, hunkIndex) =>
      selected.has(file.hunks[hunkIndex]?.id ?? ''),
    );
    if (hunks.length === 0) return;
    if (!raw.partialSafe)
      throw new Error(
        `Cannot select individual hunks for ${file.path}: select its file ID to include binary, mode, rename, addition, deletion, or submodule changes`,
      );
    sections.push(raw.header + hunks.map((hunk) => hunk.raw).join(''));
  });
  return capturePatch(sections.join(''), capture);
}

/** Stream NUL-delimited metadata independently of the captured-patch size limit. */
async function gitRecords(
  cwd: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
  consume: (record: Buffer) => void,
  input?: string,
): Promise<void> {
  return new Promise<void>((accept, reject) => {
    const child = spawn('git', [...GIT_OPTIONS, ...args], {
      cwd,
      env: environment,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let parts: Buffer[] = [];
    let bytes = 0;
    let stderr = Buffer.alloc(0);
    child.stdout.on('data', (chunk: Buffer) => {
      try {
        let start = 0;
        while (start < chunk.length) {
          const nul = chunk.indexOf(0, start);
          const part = chunk.subarray(start, nul === -1 ? chunk.length : nul);
          bytes += part.length;
          if (bytes > MAX_CAPTURE_BYTES)
            throw new Error('Git metadata record exceeds the 8 MiB limit');
          if (part.length > 0) parts.push(part);
          if (nul !== -1) {
            consume(Buffer.concat(parts));
            parts = [];
            bytes = 0;
          }
          start = nul === -1 ? chunk.length : nul + 1;
        }
      } catch (error) {
        child.kill();
        reject(error);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = Buffer.concat([stderr, chunk.subarray(0, Math.max(0, 65536 - stderr.length))]);
    });
    child.stdin.on('error', reject);
    child.stdout.on('error', reject);
    child.stderr.on('error', reject);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`Cannot read Git metadata: ${stderr.toString('utf8')}`));
      else if (bytes !== 0) reject(new Error('Truncated Git metadata'));
      else accept();
    });
    child.stdin.end(input);
  });
}

async function gitPaths(
  cwd: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
): Promise<string[]> {
  const paths: string[] = [];
  await gitRecords(cwd, args, environment, (record) => {
    if (record.length > 0) paths.push(decodeOutput(record, 'path'));
  });
  return paths;
}

async function gitlinkPaths(
  cwd: string,
  environment: NodeJS.ProcessEnv,
  pathspecs: string[] = [],
): Promise<string[]> {
  const paths = new Set<string>();
  await gitRecords(
    cwd,
    ['ls-files', '--stage', '--full-name', '-z', '--', ...pathspecs],
    environment,
    (record) => {
      if (record.subarray(0, 7).toString('ascii') !== '160000 ') return;
      const tab = record.indexOf(9);
      if (tab !== -1) paths.add(decodeOutput(record.subarray(tab + 1), 'path'));
    },
  );
  return [...paths];
}

/** Match diff's whole-tree default; ls-files otherwise scopes negative-only queries to cwd. */
function discoveryPathspecs(pathspecs: string[]): string[] {
  const hasPositive = pathspecs.some((pathspec) => {
    if (pathspec.startsWith(':(')) {
      const magic = pathspec.slice(2, pathspec.indexOf(')')).split(',');
      return !magic.includes('exclude');
    }
    if (!pathspec.startsWith(':')) return true;
    let shortMagic = '';
    for (const character of pathspec.slice(1)) {
      if (!'/!^'.includes(character)) break;
      shortMagic += character;
    }
    return !shortMagic.includes('!') && !shortMagic.includes('^');
  });
  // Git still performs all matching. The explicit top-level universe only fixes
  // the commands' different defaults; positive and lone-colon pathspecs stay as supplied.
  return hasPositive ? pathspecs : [':/', ...pathspecs];
}

interface CaptureFilterEnvironment {
  environment: NodeJS.ProcessEnv;
  filtersByRepository: Map<string, Set<string>>;
  submodulesByRepository: Map<string, string[]>;
}

/** Include filters used by Git's recursive submodule dirtiness checks. */
async function disabledFilterEnvironment(
  repositoryRoot: string,
  environment: NodeJS.ProcessEnv,
  selection: { cwd: string; pathspecs: string[] },
): Promise<CaptureFilterEnvironment> {
  const filtersByRepository = new Map<string, Set<string>>();
  const submodulesByRepository = new Map<string, string[]>();
  const keys = new Set<string>();
  const visited = new Set<string>();
  const submoduleEnvironment = { ...environment };
  // Root selectors must not redirect queries intended for a nested repository.
  for (const key of REPOSITORY_ENVIRONMENT) delete submoduleEnvironment[key];
  async function collect(
    cwd: string,
    env: NodeJS.ProcessEnv,
    discoveryCwd = cwd,
    pathspecs: string[] = [],
  ): Promise<void> {
    const canonicalRoot = await realpath(cwd);
    if (visited.has(canonicalRoot)) return;
    visited.add(canonicalRoot);
    const filters = await runGit(
      cwd,
      [
        'config',
        '--null',
        '--name-only',
        '--get-regexp',
        '^filter\\..*\\.(clean|process|smudge|required)$',
      ],
      [1],
      env,
    );
    const drivers = new Set<string>();
    for (const key of decodeOutput(filters.output).split('\0').filter(Boolean)) {
      keys.add(key);
      if (/\.(?:clean|process|required)$/.test(key))
        drivers.add(key.slice('filter.'.length, key.lastIndexOf('.')));
    }
    filtersByRepository.set(canonicalRoot, drivers);
    const submodules: string[] = [];
    for (const path of await gitlinkPaths(discoveryCwd, env, pathspecs)) {
      const submodule = resolve(cwd, path);
      try {
        if (!(await lstat(submodule)).isDirectory()) continue;
        await lstat(resolve(submodule, '.git'));
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error.code === 'ENOENT' || error.code === 'ENOTDIR')
        )
          continue;
        throw error;
      }
      submodules.push(path);
      await collect(submodule, submoduleEnvironment);
    }
    submodulesByRepository.set(canonicalRoot, submodules);
  }
  await collect(
    repositoryRoot,
    environment,
    selection.cwd,
    discoveryPathspecs(selection.pathspecs),
  );
  const filteredEnvironment: NodeJS.ProcessEnv = {
    ...environment,
    GIT_CONFIG_COUNT: String(keys.size),
  };
  [...keys].forEach((key, index) => {
    // Keys and values stay separate: valid filter names may themselves contain '='.
    filteredEnvironment[`GIT_CONFIG_KEY_${index}`] = key;
    filteredEnvironment[`GIT_CONFIG_VALUE_${index}`] = key.endsWith('.required') ? 'false' : '';
  });
  return { environment: filteredEnvironment, filtersByRepository, submodulesByRepository };
}

const NATIVE_PATH_OPTIONS = [
  '--name-only',
  '-z',
  '--no-color',
  '--no-ext-diff',
  '--no-textconv',
  '--ignore-submodules=none',
  '--no-relative',
  '--no-renames',
  '--diff-filter=d',
];

/** Reject transformations we cannot reproduce without executing configured commands. */
async function assertNativeFilterSupport(
  cwd: string,
  paths: string[],
  filters: CaptureFilterEnvironment,
  environment: NodeJS.ProcessEnv,
  prefix = '',
): Promise<void> {
  const canonicalRoot = await realpath(cwd);
  const drivers = filters.filtersByRepository.get(canonicalRoot);
  if (drivers && drivers.size > 0 && paths.length > 0) {
    const candidates: { path: string; driver: string }[] = [];
    let field = 0;
    let path = '';
    await gitRecords(
      cwd,
      ['check-attr', '-z', '--stdin', 'filter'],
      environment,
      (record) => {
        if (field === 0) path = decodeOutput(record, 'path');
        else if (field === 2) {
          const driver = decodeOutput(record);
          if (drivers.has(driver)) candidates.push({ path, driver });
        }
        field = (field + 1) % 3;
      },
      paths.map((path) => `${path}\0`).join(''),
    );
    if (field !== 0) throw new Error('Malformed Git attribute metadata');
    for (const candidate of candidates) {
      try {
        if (!(await lstat(resolve(cwd, candidate.path))).isFile()) continue;
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error.code === 'ENOENT' || error.code === 'ENOTDIR')
        )
          continue;
        throw error;
      }
      throw new Error(
        `Cannot natively capture selected path ${prefix}${candidate.path}: configured filter ${candidate.driver} requires command execution. Use narrower pathspecs or supply an explicitly generated patch instead`,
      );
    }
  }
  const nestedEnvironment = { ...environment };
  for (const key of REPOSITORY_ENVIRONMENT) delete nestedEnvironment[key];
  // Visit exactly the selection-pruned graph discovered from index gitlinks.
  // Filter-disabled parent dirtiness can hide a natively dirty selected module.
  for (const path of filters.submodulesByRepository.get(canonicalRoot) ?? []) {
    const submodule = resolve(cwd, path);
    const nestedDrivers = filters.filtersByRepository.get(await realpath(submodule));
    const changed =
      nestedDrivers && nestedDrivers.size > 0
        ? await gitPaths(
            submodule,
            ['diff', ...NATIVE_PATH_OPTIONS, 'HEAD', '--'],
            nestedEnvironment,
          )
        : [];
    await assertNativeFilterSupport(
      submodule,
      changed,
      filters,
      nestedEnvironment,
      `${prefix}${path}/`,
    );
  }
}

/**
 * Capture HEAD to the working tree without executing external filters.
 * Selected filter-sensitive paths reject rather than substituting raw working bytes for
 * Git's stored content. Narrow pathspecs or import an explicitly generated patch
 * with capturePatch when configured transformations are required.
 */
export async function captureWorkingTree(
  options: { cwd?: string; pathspecs?: string[]; includeUntracked?: boolean } = {},
): Promise<ReviewCapture> {
  const cwd = options.cwd ?? process.cwd();
  const environment = gitEnvironment(cwd);
  const repository = await getCaptureRepository(cwd);
  const pathspecs = options.pathspecs ?? [];
  if (
    !Array.isArray(pathspecs) ||
    pathspecs.some((pathspec) => typeof pathspec !== 'string' || pathspec.includes('\0'))
  )
    throw new Error('Git pathspecs must be strings without NUL bytes');
  // Git applies clean filters even with --no-textconv. Disable configured
  // filter commands as well as external diff and filesystem-monitor hooks.
  const filters = await disabledFilterEnvironment(repository.repositoryRoot, environment, {
    cwd,
    pathspecs,
  });
  const filteredEnvironment = filters.environment;
  const base =
    repository.baseCommit === 'unborn'
      ? decodeOutput((await runGit(cwd, ['hash-object', '-t', 'tree', '--stdin'])).output).trim()
      : repository.baseCommit;
  const untrackedPaths = options.includeUntracked
    ? await gitPaths(
        cwd,
        [
          'ls-files',
          '--others',
          '--exclude-standard',
          '--full-name',
          '-z',
          '--',
          ...discoveryPathspecs(pathspecs),
        ],
        environment,
      )
    : [];
  // Reject unsupported untracked directories before any repository preflight.
  for (const path of untrackedPaths) {
    const info = await lstat(resolve(repository.repositoryRoot, path));
    if (!info.isFile() && !info.isSymbolicLink())
      throw new Error(`Cannot capture untracked directory: ${path}`);
  }
  const changed = await gitPaths(
    cwd,
    ['diff', ...NATIVE_PATH_OPTIONS, base, '--', ...pathspecs],
    filteredEnvironment,
  );
  await assertNativeFilterSupport(
    repository.repositoryRoot,
    [...new Set([...changed, ...untrackedPaths])],
    filters,
    filteredEnvironment,
  );
  const tracked = await runGit(
    cwd,
    ['diff', ...DIFF_OPTIONS, base, '--', ...pathspecs],
    [],
    filteredEnvironment,
  );
  let patch = decodeOutput(tracked.output);
  if (options.includeUntracked) {
    for (const path of untrackedPaths) {
      const info = await lstat(resolve(repository.repositoryRoot, path));
      if (!info.isFile() && !info.isSymbolicLink())
        throw new Error(`Cannot capture untracked directory: ${path}`);
      const addition = await runGit(
        repository.repositoryRoot,
        ['diff', '--no-index', ...DIFF_OPTIONS, '--', '/dev/null', path],
        [1],
        filteredEnvironment,
      );
      patch += decodeOutput(addition.output);
      if (Buffer.byteLength(patch, 'utf8') > MAX_CAPTURE_BYTES)
        throw new Error('Review capture exceeds the 8 MiB limit');
    }
  }
  return capturePatch(patch, repository);
}
