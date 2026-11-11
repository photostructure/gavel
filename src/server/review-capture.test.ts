import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  capturePatch,
  captureWorkingTree,
  filesWithoutAddedLines,
  getCaptureRepository,
  MAX_CAPTURE_BYTES,
  selectCapture,
  validateCapture,
} from './review-capture.js';

const setupEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
);
const BASE = 'a'.repeat(40);
const twoHunks = [
  'diff --git a/file.txt b/file.txt',
  'index 1111111..2222222 100644',
  '--- a/file.txt',
  '+++ b/file.txt',
  '@@ -1,2 +1,2 @@',
  '-one',
  '+ONE',
  ' two',
  '@@ -20,2 +20,2 @@ function context',
  ' twenty',
  '-last',
  '+LAST',
  '\\ No newline at end of file',
  '',
].join('\n');

function capture(patch = twoHunks) {
  return capturePatch(patch, { repositoryRoot: '/tmp/capture-repo', baseCommit: BASE });
}

describe('immutable review capture artifacts', () => {
  it('derives IDs and digest from the exact patch and retains raw selected hunks', () => {
    const original = capture();
    expect(original.patchDigest).toBe(createHash('sha256').update(twoHunks).digest('hex'));
    const file = original.files[0];
    expect(file?.hunks).toHaveLength(2);
    expect(file?.hunks[1]).toMatchObject({ oldStart: 20, oldLines: 2, newStart: 20, newLines: 2 });
    const selected = selectCapture(original, [file?.hunks[1]?.id ?? '']);
    expect(selected.patch).toBe(
      twoHunks.slice(0, twoHunks.indexOf('@@')) + twoHunks.slice(twoHunks.indexOf('@@ -20')),
    );
    expect(selected.patch).toContain('\\ No newline at end of file\n');
    expect(selected.patchDigest).not.toBe(original.patchDigest);
    expect(selectCapture(original, [])).toEqual(original);
    expect(selectCapture(original, [file?.id ?? ''])).toEqual(original);
  });

  it('rejects stale and invented IDs instead of broadening the selection', () => {
    const first = capture();
    const changed = capture(twoHunks.replace('+ONE', '+changed'));
    expect(() => selectCapture(changed, [first.files[0]?.id ?? ''])).toThrow('Unknown or stale');
    expect(() => selectCapture(first, ['not-an-id'])).toThrow('Unknown or stale');
  });

  it('validates persisted artifacts by recomputing the digest and catalogue', () => {
    const original = capture();
    expect(validateCapture(JSON.parse(JSON.stringify(original)))).toEqual(original);
    const reordered = {
      ...original,
      files: original.files.map((file) => ({ hunks: file.hunks, path: file.path, id: file.id })),
    };
    expect(validateCapture(reordered)).toEqual(original);
    expect(() =>
      validateCapture({
        ...original,
        files: original.files.map((file) => ({
          ...file,
          hunks: file.hunks.map((hunk) => ({ ...hunk, oldStart: hunk.oldStart + 1 })),
        })),
      }),
    ).toThrow('catalogue');
    expect(() =>
      validateCapture({ ...original, patch: original.patch.replace('+ONE', '+BAD') }),
    ).toThrow('digest');
    expect(() => validateCapture({ ...original, repositoryId: 'forged' })).toThrow('repository ID');
    expect(() =>
      validateCapture({ ...original, files: [{ ...original.files[0], id: 'forged' }] }),
    ).toThrow('catalogue');
    expect(() => validateCapture({ ...original, schemaVersion: 2 })).toThrow('schema');
    expect(() => capture('nonsense')).toThrow('Git or unified patch');
    expect(() => capture(twoHunks.replace('@@ -1,2 +1,2 @@', '@@ -1,10 +1,2 @@'))).toThrow();
    expect(() => capture('x'.repeat(MAX_CAPTURE_BYTES + 1))).toThrow('8 MiB');
  });

  it('keeps binary and mode-only changes only when their file IDs are selected', () => {
    const binary =
      'diff --git a/image.bin b/image.bin\nindex 123..456 100644\nGIT binary patch\nliteral 4\nLcmeZsU|;|M00aO5\n\nliteral 3\nKcmZQzU|?Vb2LJ>B\n\n';
    const mode = 'diff --git a/run b/run\nold mode 100644\nnew mode 100755\n';
    const original = capture(twoHunks + binary + mode);
    expect(original.files).toHaveLength(3);
    expect(original.files[1]?.hunks).toEqual([]);
    expect(selectCapture(original, [original.files[0]?.hunks[0]?.id ?? '']).patch).not.toContain(
      'image.bin',
    );
    expect(selectCapture(original, [original.files[1]?.id ?? '']).patch).toBe(binary);
    expect(selectCapture(original, [original.files[2]?.id ?? '']).patch).toBe(mode);
  });

  it.each([
    ['mode', 'old mode 100644\nnew mode 100755\n'],
    ['rename', 'similarity index 90%\nrename from a/file.txt\nrename to file.txt\n'],
    ['addition', 'new file mode 100644\n'],
    ['deletion', 'deleted file mode 100644\n'],
    ['submodule', 'index 111..222 160000\n'],
  ])('requires a whole-file ID for %s metadata alongside a hunk', (_name, metadata) => {
    const artifact = capture(twoHunks.replace('index 1111111..2222222 100644\n', metadata));
    expect(() => selectCapture(artifact, [artifact.files[0]?.hunks[0]?.id ?? ''])).toThrow(
      'select its file ID',
    );
    expect(selectCapture(artifact, [artifact.files[0]?.id ?? '']).patch).toBe(artifact.patch);
  });

  it('supports plain unified patches without mistaking hunk contents for file headers', () => {
    const plain =
      '--- file.txt\n+++ file.txt\n@@ -1 +1 @@\n--- content\n+++ content\n--- other.txt\n+++ other.txt\n@@ -1 +1 @@\n-old\n+new\n';
    const artifact = capture(plain);
    expect(artifact.files.map((file) => file.path)).toEqual(['file.txt', 'other.txt']);
    expect(selectCapture(artifact, [artifact.files[1]?.id ?? '']).patch).toBe(
      plain.slice(plain.indexOf('--- other')),
    );
  });

  it('selects each plain unified hunk without later hunks or files', () => {
    const first = twoHunks
      .replace(/^diff --git [^\n]*\nindex [^\n]*\n/, '')
      .replace('--- a/file.txt', '--- file.txt')
      .replace('+++ b/file.txt', '+++ file.txt');
    const other = '--- other.txt\n+++ other.txt\n@@ -1 +1 @@\n-before\n+after\n';
    const artifact = capture(first + other);
    const start = first.indexOf('@@');
    const second = first.indexOf('@@ -20');
    for (const [index, raw] of [
      [0, first.slice(start, second)],
      [1, first.slice(second)],
    ] as const) {
      const selected = selectCapture(artifact, [artifact.files[0]?.hunks[index]?.id ?? '']);
      expect(selected.patch).toBe(first.slice(0, start) + raw);
      expect(selected.files).toHaveLength(1);
      expect(selected.files[0]?.hunks).toHaveLength(1);
      expect(selected.patch).not.toContain('other.txt');
    }
  });

  it.each(['\r', '\u2028', '\u2029'])(
    'accepts non-LF separators inside hunk context and content (%j)',
    (separator) => {
      // Git's hunk headers and patch lines are delimited by LF, not JS line terminators.
      const contextual = capture(
        twoHunks.replace('function context', `function${separator}context`),
      );
      expect(contextual.files[0]?.hunks).toHaveLength(2);
      const patch = `diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+new${separator}diff --git a/phantom b/phantom\n`;
      const artifact = capture(patch);
      expect(artifact.files.map((file) => file.path)).toEqual(['file.txt']);
      expect(selectCapture(artifact, [artifact.files[0]?.id ?? '']).patch).toBe(patch);
    },
  );

  it('identifies non-UTF-8 quoted filenames instead of suggesting binary attributes', () => {
    // Git core.quotePath encodes a Latin-1 filename byte as an ASCII octal escape.
    const patch = 'diff --git "a/l\\351.txt" "b/l\\351.txt"\nold mode 100644\nnew mode 100755\n';
    expect(() => capture(patch)).toThrow('Patch path is not valid UTF-8');
  });

  it('preserves quoted Unicode, tabs, newlines, and literal a/ path prefixes in renames', () => {
    const patch =
      'diff --git "a/a/old\\tname.txt" "b/\\303\\251 new\\nname.txt"\nsimilarity index 100%\nrename from "a/old\\tname.txt"\nrename to "\\303\\251 new\\nname.txt"\n';
    const artifact = capture(patch);
    expect(artifact.files[0]).toMatchObject({
      path: 'é new\nname.txt',
      oldPath: 'a/old\tname.txt',
    });
    expect(selectCapture(artifact, [artifact.files[0]?.id ?? '']).patch).toBe(patch);
    const mode = capture(
      'diff --git a/dir b/part name b/dir b/part name\nold mode 100644\nnew mode 100755\n',
    );
    expect(mode.files[0]?.path).toBe('dir b/part name');
    const bomName = capture(
      'diff --git a/\uFEFFfile b/\uFEFFfile\nold mode 100644\nnew mode 100755\n',
    );
    expect(bomName.files[0]?.path).toBe('\uFEFFfile');
  });
});

describe('filesWithoutAddedLines', () => {
  it('names the files with a hunk that adds no lines, including plain unified patches', () => {
    const removeOnly = '--- a/gone.txt\n+++ b/gone.txt\n@@ -1,2 +1 @@\n keep\n-gone\n';
    const parsed = capture();
    expect(filesWithoutAddedLines(parsed)).toEqual([]);
    const plain = capture(`--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-one\n+ONE\n${removeOnly}`);
    expect(filesWithoutAddedLines(plain)).toEqual([plain.files[1]?.id]);
  });
});

describe('read-only working tree captures', () => {
  let root: string;
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=gavel',
        '-c',
        'user.email=gavel@example.com',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      { cwd: root, env: setupEnv, encoding: 'utf8' },
    );
  const commit = () => {
    git('add', '.');
    git('commit', '--quiet', '--no-verify', '-m', 'fixture');
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'gavel-capture-'));
    for (const key of Object.keys(process.env))
      if (key.startsWith('GIT_')) vi.stubEnv(key, undefined);
    git('init', '--quiet');
    git('config', 'advice.addEmbeddedRepo', 'false');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it('captures HEAD through staged and unstaged changes using include/exclude pathspecs', async () => {
    mkdirSync(join(root, 'src'));
    for (const name of ['keep.txt', 'skip.txt']) writeFileSync(join(root, 'src', name), 'old\n');
    writeFileSync(join(root, 'outside.txt'), 'old\n');
    commit();
    writeFileSync(join(root, 'src', 'keep.txt'), 'staged\n');
    git('add', 'src/keep.txt');
    writeFileSync(join(root, 'src', 'keep.txt'), 'working\n');
    writeFileSync(join(root, 'src', 'skip.txt'), 'excluded\n');
    writeFileSync(join(root, 'outside.txt'), 'outside\n');
    const indexBefore = readFileSync(join(root, '.git/index'));
    const artifact = await captureWorkingTree({
      cwd: root,
      pathspecs: ['src', ':(exclude)src/skip.txt'],
    });
    expect(artifact.files.map((file) => file.path)).toEqual(['src/keep.txt']);
    expect(artifact.patch).toContain('-old\n+working\n');
    expect(artifact.patch).not.toContain('staged');
    expect(readFileSync(join(root, '.git/index'))).toEqual(indexBefore);
    const fromSubdirectory = await captureWorkingTree({
      cwd: join(root, 'src'),
      pathspecs: ['keep.txt'],
    });
    expect(fromSubdirectory.patch).toBe(artifact.patch);
    expect(artifact.baseCommit).toBe(git('rev-parse', 'HEAD').trim());
  });

  it('does not refresh unchanged file stats or run post-index-change hooks', async () => {
    writeFileSync(join(root, 'unchanged.txt'), 'same\n');
    writeFileSync(join(root, 'changed.txt'), 'old\n');
    commit();
    // Empty init templates omit hooks; inherited hooksPath may point elsewhere.
    rmSync(join(root, '.git/hooks'), { recursive: true, force: true });
    git('config', 'core.hooksPath', join(root, 'unused-hooks'));
    const marker = join(root, 'index-hook-ran');
    const hooks = join(root, '.git/hooks');
    mkdirSync(hooks, { recursive: true });
    git('config', 'core.hooksPath', hooks);
    const hook = join(hooks, 'post-index-change');
    writeFileSync(hook, `#!/bin/sh\ntouch '${marker}'\n`);
    chmodSync(hook, 0o755);
    const future = new Date(Date.now() + 5000);
    utimesSync(join(root, 'unchanged.txt'), future, future);
    writeFileSync(join(root, 'changed.txt'), 'new\n');
    const indexBefore = readFileSync(join(root, '.git/index'));
    // Ground truth: GIT_OPTIONAL_LOCKS=0 git -c diff.autoRefreshIndex=false diff HEAD --
    // reports only changed.txt and leaves the index (and its hooks) untouched.
    const reference = git('-c', 'diff.autoRefreshIndex=false', 'diff', 'HEAD', '--');
    expect(reference).toContain('+new\n');
    expect(reference).not.toContain('unchanged.txt');
    expect(readFileSync(join(root, '.git/index'))).toEqual(indexBefore);
    expect(readdirSync(root)).not.toContain('index-hook-ran');
    const artifact = await captureWorkingTree({ cwd: root });
    expect(artifact.files.map((file) => file.path)).toEqual(['changed.txt']);
    expect(readFileSync(join(root, '.git/index'))).toEqual(indexBefore);
    expect(readdirSync(root)).not.toContain('index-hook-ran');
  });

  it('adds only requested untracked files without changing shared or split index bytes', async () => {
    writeFileSync(join(root, '.gitignore'), 'ignored.txt\n');
    writeFileSync(join(root, 'tracked.txt'), 'old\n');
    commit();
    git('update-index', '--split-index');
    const names = readdirSync(join(root, '.git')).filter(
      (name) => name === 'index' || name.startsWith('sharedindex.'),
    );
    const before = names.map((name) => readFileSync(join(root, '.git', name)));
    writeFileSync(join(root, 'new é space\tline\nfile.txt'), 'untracked\n');
    writeFileSync(join(root, '-dash.txt'), 'dash\n');
    writeFileSync(join(root, 'ignored.txt'), 'ignored\n');
    writeFileSync(join(root, 'excluded.txt'), 'excluded\n');
    expect((await captureWorkingTree({ cwd: root })).patch).toBe('');
    const artifact = await captureWorkingTree({
      cwd: root,
      includeUntracked: true,
      pathspecs: ['*', ':(exclude)excluded.txt'],
    });
    expect(artifact.files.map((file) => file.path)).toEqual([
      '-dash.txt',
      'new é space\tline\nfile.txt',
    ]);
    expect(artifact.patch).toContain('new file mode 100644');
    expect(names.map((name) => readFileSync(join(root, '.git', name)))).toEqual(before);
    expect(
      readdirSync(join(root, '.git')).filter(
        (name) => name === 'index' || name.startsWith('sharedindex.'),
      ),
    ).toEqual(names);
    expect(git('ls-files', '--stage')).not.toContain('-dash');
  });

  it.skipIf(process.platform !== 'linux')(
    'reports invalid Git filename bytes without binary-file advice',
    async () => {
      const path = Buffer.concat([
        Buffer.from(`${root}/l`),
        Buffer.from([0xe9]),
        Buffer.from('.txt'),
      ]);
      writeFileSync(path, 'old\n');
      commit();
      writeFileSync(path, 'new\n');
      // Ground truth: Git emits the invalid filename byte as an ASCII octal escape.
      expect(git('-c', 'core.quotePath=true', 'diff', 'HEAD', '--')).toContain('l\\351.txt');
      await expect(captureWorkingTree({ cwd: root })).rejects.toThrow(
        'Git paths must contain valid UTF-8',
      );
    },
  );

  it.each(['\r', '\u2028', '\u2029'])(
    'captures real Git hunk contexts containing non-LF separators (%j)',
    async (separator) => {
      git('config', 'diff.context', '3');
      const original =
        [
          `Intro text${separator}continued`,
          ...Array.from({ length: 10 }, (_, index) => `${index}`),
        ].join('\n') + '\n';
      writeFileSync(join(root, 'context.txt'), original);
      commit();
      writeFileSync(join(root, 'context.txt'), original.replace('8\n', 'changed 8\n'));
      // Ground truth: git diff HEAD -- context.txt preserves this function context verbatim.
      const patch = git('diff', '--no-color', 'HEAD', '--', 'context.txt');
      expect(patch).toContain(`@@ Intro text${separator}continued`);
      const artifact = await captureWorkingTree({ cwd: root });
      expect(artifact.files[0]?.hunks).toHaveLength(1);
    },
  );

  it.each(['rename', 'copy'])(
    'captures a %s from a quoted path into an unquoted prefix-like directory',
    async (operation) => {
      const original = 'one\ntwo\nthree\n';
      writeFileSync(join(root, 'é.txt'), original);
      commit();
      mkdirSync(join(root, 'project b'));
      if (operation === 'rename') renameSync(join(root, 'é.txt'), join(root, 'project b/file.txt'));
      else {
        git('config', 'diff.renames', 'copies');
        writeFileSync(join(root, 'project b/file.txt'), original);
        writeFileSync(join(root, 'é.txt'), 'changed\ntwo\nthree\n');
      }
      git('add', '.');
      // Ground truth: git -c core.quotePath=true diff --binary --full-index HEAD --
      const patch = git(
        '-c',
        'core.quotePath=true',
        'diff',
        '--binary',
        '--full-index',
        'HEAD',
        '--',
      );
      expect(patch).toContain('"a/\\303\\251.txt" b/project b/file.txt');
      const artifact = await captureWorkingTree({ cwd: root });
      expect(artifact.files).toContainEqual(
        expect.objectContaining({
          path: 'project b/file.txt',
          oldPath: 'é.txt',
          hunks: [],
        }),
      );
    },
  );

  it('selects either separated working-tree hunk without including the other edit', async () => {
    git('config', 'diff.context', '3');
    git('config', 'diff.interHunkContext', '0');
    const original =
      Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join('\n') + '\n';
    writeFileSync(join(root, 'two.txt'), original);
    commit();
    const modified =
      'inserted first\ninserted second\n' + original.replace('line 35\n', 'changed 35\n');
    writeFileSync(join(root, 'two.txt'), modified);
    const artifact = await captureWorkingTree({ cwd: root });
    expect(artifact.files[0]?.hunks).toHaveLength(2);
    const indexBefore = readFileSync(join(root, '.git/index'));
    for (const [index, included, excluded] of [
      [0, '+inserted first', '+changed 35'],
      [1, '+changed 35', '+inserted first'],
    ] as const) {
      const selected = selectCapture(artifact, [artifact.files[0]?.hunks[index]?.id ?? '']);
      expect(selected.patch).toContain(included);
      expect(selected.patch).not.toContain(excluded);
      expect(selected.files[0]?.hunks).toHaveLength(1);
      writeFileSync(join(root, 'two.txt'), original);
      // Ground truth: each selected raw hunk independently passes git apply --check.
      execFileSync('git', ['apply', '--check', '-'], {
        cwd: root,
        env: setupEnv,
        input: selected.patch,
      });
      expect(readFileSync(join(root, '.git/index'))).toEqual(indexBefore);
      expect(readFileSync(join(root, 'two.txt'), 'utf8')).toBe(original);
    }
  });

  it('honors an alternate index without modifying either index', async () => {
    writeFileSync(join(root, 'file.txt'), 'baseline\n');
    commit();
    const indexPath = join(root, 'alternate-index');
    const env = { ...setupEnv, GIT_INDEX_FILE: indexPath };
    execFileSync('git', ['read-tree', 'HEAD'], { cwd: root, env });
    writeFileSync(join(root, 'file.txt'), 'staged alternative\n');
    execFileSync('git', ['add', 'file.txt'], { cwd: root, env });
    writeFileSync(join(root, 'file.txt'), 'working alternative\n');
    writeFileSync(join(root, 'alt-only.txt'), 'alternate index only\n');
    execFileSync('git', ['add', 'alt-only.txt'], { cwd: root, env });
    expect(git('ls-files')).not.toContain('alt-only.txt');
    vi.stubEnv('GIT_DIR', join(root, '.git'));
    vi.stubEnv('GIT_WORK_TREE', root);
    vi.stubEnv('GIT_INDEX_FILE', indexPath);
    const before = [readFileSync(indexPath), readFileSync(join(root, '.git/index'))];
    const artifact = await captureWorkingTree({ cwd: root });
    expect(artifact.patch).toContain('-baseline\n+working alternative\n');
    expect(artifact.files.map((file) => file.path)).toEqual(
      expect.arrayContaining(['alt-only.txt', 'file.txt']),
    );
    expect(artifact.files).toHaveLength(2);
    expect([readFileSync(indexPath), readFileSync(join(root, '.git/index'))]).toEqual(before);
  });

  it('anchors relative Git environment paths when untracked capture runs from a subdirectory', async () => {
    writeFileSync(join(root, 'tracked'), 'tracked\n');
    commit();
    mkdirSync(join(root, 'sub'));
    writeFileSync(join(root, 'sub', 'new.txt'), 'untracked\n');
    vi.stubEnv('GIT_DIR', '../.git');
    vi.stubEnv('GIT_WORK_TREE', '..');
    vi.stubEnv('GIT_INDEX_FILE', '../.git/index');
    const before = readFileSync(join(root, '.git/index'));
    const artifact = await captureWorkingTree({
      cwd: join(root, 'sub'),
      includeUntracked: true,
      pathspecs: ['new.txt'],
    });
    expect(artifact.files.map((file) => file.path)).toEqual(['sub/new.txt']);
    expect(readFileSync(join(root, '.git/index'))).toEqual(before);
  });

  it('captures untracked symlinks and empty files without reading symlink targets', async () => {
    writeFileSync(join(root, 'tracked'), 'tracked\n');
    commit();
    writeFileSync(join(root, 'empty.txt'), '');
    symlinkSync('/outside/capture/secret', join(root, 'link'));
    const artifact = await captureWorkingTree({ cwd: root, includeUntracked: true });
    expect(artifact.files.map((file) => file.path)).toEqual(['empty.txt', 'link']);
    expect(artifact.patch).toContain('new file mode 120000');
    expect(artifact.patch).toContain('+/outside/capture/secret');
    writeFileSync(join(root, '\uFEFFfile'), 'literal filename\n');
    const bomCapture = await captureWorkingTree({
      cwd: root,
      includeUntracked: true,
      pathspecs: ['\uFEFFfile'],
    });
    expect(bomCapture.files[0]?.path).toBe('\uFEFFfile');
  });

  it('resolves symlinked roots consistently and supports an unborn repository', async () => {
    const alias = `${root}-alias`;
    symlinkSync(root, alias, 'dir');
    try {
      const repository = await getCaptureRepository(alias);
      expect(repository.repositoryRoot).toBe(root);
      expect(repository.baseCommit).toBe('unborn');
      writeFileSync(join(root, 'new.txt'), 'initial\n');
      git('add', 'new.txt');
      const indexBefore = readFileSync(join(root, '.git/index'));
      const artifact = await captureWorkingTree({ cwd: alias });
      expect(artifact.repositoryId).toBe(repository.repositoryId);
      expect(artifact.files[0]?.path).toBe('new.txt');
      expect(readFileSync(join(root, '.git/index'))).toEqual(indexBefore);
    } finally {
      rmSync(alias);
    }
  });

  it('preserves binary blocks, mode-only changes, renames, and no-newline markers', async () => {
    writeFileSync(join(root, 'binary.bin'), Buffer.from([0, 1, 2, 3]));
    writeFileSync(join(root, 'run'), 'script\n');
    writeFileSync(join(root, 'old name.txt'), 'rename contents\n');
    writeFileSync(join(root, 'text.txt'), 'before');
    commit();
    writeFileSync(join(root, 'binary.bin'), Buffer.from([0, 5, 6, 7]));
    chmodSync(join(root, 'run'), 0o755);
    renameSync(join(root, 'old name.txt'), join(root, 'new name.txt'));
    git('add', 'old name.txt', 'new name.txt');
    writeFileSync(join(root, 'text.txt'), 'after');
    const artifact = await captureWorkingTree({ cwd: root });
    expect(artifact.patch).toContain('GIT binary patch');
    expect(artifact.patch).toContain('old mode 100644\nnew mode 100755');
    expect(artifact.files.find((file) => file.path === 'new name.txt')?.oldPath).toBe(
      'old name.txt',
    );
    expect(artifact.patch).toContain('\\ No newline at end of file');
    const selected = selectCapture(artifact, [
      artifact.files.find((file) => file.path === 'text.txt')?.hunks[0]?.id ?? '',
    ]);
    expect(selected.files.map((file) => file.path)).toEqual(['text.txt']);
  });

  it('retains prefixed blank context when diff.suppressBlankEmpty is enabled', async () => {
    writeFileSync(join(root, 'file.txt'), 'before\n\nold\n\nafter\n');
    commit();
    git('config', 'diff.suppressBlankEmpty', 'true');
    writeFileSync(join(root, 'file.txt'), 'before\n\nnew\n\nafter\n');
    const configuredPatch = git('diff', 'HEAD', '--', 'file.txt');
    expect(configuredPatch).toContain('\n\n-old\n+new\n\n');
    expect(() => capture(configuredPatch)).toThrow('Malformed patch hunk body');
    const artifact = await captureWorkingTree({ cwd: root });
    expect(artifact.patch).toContain('\n \n-old\n+new\n \n');
    expect(artifact.files[0]?.hunks).toHaveLength(1);
  });

  it('uses standard line indicators for tracked and untracked patches', async () => {
    writeFileSync(join(root, 'file.txt'), 'old words\n');
    commit();
    git('config', 'diff.outputIndicatorNew', '>');
    git('config', 'diff.outputIndicatorOld', '<');
    git('config', 'diff.outputIndicatorContext', '.');
    writeFileSync(join(root, 'file.txt'), 'new words\n');
    writeFileSync(join(root, 'new.txt'), 'new untracked words\n');
    const artifact = await captureWorkingTree({ cwd: root, includeUntracked: true });
    expect(artifact.patch).toContain('-old words\n+new words\n');
    expect(artifact.patch).toContain('+new untracked words\n');
    expect(artifact.files.map((file) => file.path)).toEqual(['file.txt', 'new.txt']);
  });

  it.each(['log', 'diff'])('uses a short gitlink patch when diff.submodule=%s', async (format) => {
    const module = join(root, 'module');
    mkdirSync(module);
    git('-C', module, 'init', '--quiet');
    writeFileSync(join(module, 'file.txt'), 'base\n');
    git('-C', module, 'add', '.');
    git('-C', module, 'commit', '--quiet', '--no-verify', '-m', 'module base');
    writeFileSync(
      join(root, '.gitmodules'),
      '[submodule "module"]\n\tpath = module\n\turl = ./module\n',
    );
    commit();
    const oldHead = git('-C', module, 'rev-parse', 'HEAD').trim();
    writeFileSync(join(module, 'file.txt'), 'changed\n');
    git('-C', module, 'add', '.');
    git('-C', module, 'commit', '--quiet', '--no-verify', '-m', 'module change');
    const newHead = git('-C', module, 'rev-parse', 'HEAD').trim();
    git('config', 'diff.submodule', format);
    const configuredPatch = git('diff', 'HEAD', '--', 'module');
    expect(configuredPatch).toMatch(/^Submodule module /);
    expect(() => capture(configuredPatch)).toThrow('Git or unified patch');
    const rootIndex = readFileSync(join(root, '.git/index'));
    const moduleIndex = readFileSync(join(module, '.git/index'));
    const artifact = await captureWorkingTree({ cwd: root, pathspecs: ['module'] });
    expect(artifact.files.map((file) => file.path)).toEqual(['module']);
    expect(artifact.patch).toContain(
      `-Subproject commit ${oldHead}\n+Subproject commit ${newHead}\n`,
    );
    expect(artifact.patch).toContain(' 160000\n');
    expect(readFileSync(join(root, '.git/index'))).toEqual(rootIndex);
    expect(readFileSync(join(module, '.git/index'))).toEqual(moduleIndex);
  });

  it('includes submodule pointer and dirty markers despite configured ignore rules', async () => {
    const module = join(root, 'module');
    mkdirSync(module);
    git('-C', module, 'init', '--quiet');
    writeFileSync(join(module, 'file.txt'), 'base\n');
    git('-C', module, 'add', '.');
    git('-C', module, 'commit', '--quiet', '--no-verify', '-m', 'module base');
    writeFileSync(
      join(root, '.gitmodules'),
      '[submodule "module"]\n\tpath = module\n\turl = ./module\n',
    );
    commit();
    git('config', 'diff.ignoreSubmodules', 'all');
    git('config', 'submodule.module.ignore', 'all');
    writeFileSync(join(module, 'file.txt'), 'changed contents that are not recursively captured\n');
    expect(git('diff', 'HEAD', '--', 'module')).toBe('');
    const dirty = await captureWorkingTree({ cwd: root, pathspecs: ['module'] });
    expect(dirty.patch).toMatch(/\+Subproject commit [a-f\d]{40}-dirty\n/);
    expect(dirty.patch).not.toContain('changed contents');
    git('-C', module, 'add', '.');
    git('-C', module, 'commit', '--quiet', '--no-verify', '-m', 'module update');
    const newHead = git('-C', module, 'rev-parse', 'HEAD').trim();
    const moved = await captureWorkingTree({ cwd: root, pathspecs: ['module'] });
    expect(moved.patch).toContain(`+Subproject commit ${newHead}\n`);
    writeFileSync(join(module, 'untracked.txt'), 'untracked child content\n');
    const untrackedDirty = await captureWorkingTree({ cwd: root, pathspecs: ['module'] });
    expect(untrackedDirty.patch).toContain(`+Subproject commit ${newHead}-dirty\n`);
    expect(untrackedDirty.patch).not.toContain('untracked child content');
  });

  it.each([false, true])(
    'disables nested submodule filters with root Git environment selectors=%s',
    async (selectors) => {
      const module = join(root, 'module');
      const nested = join(module, 'nested');
      mkdirSync(nested, { recursive: true });
      for (const directory of [nested, module]) {
        git('-C', directory, 'init', '--quiet');
        git('-C', directory, 'config', 'advice.addEmbeddedRepo', 'false');
        writeFileSync(join(directory, 'file.txt'), 'base\n');
        const filter = directory === nested ? 'nestedunsafe' : 'moduleunsafe';
        writeFileSync(join(directory, '.gitattributes'), `*.txt filter=${filter}\n`);
        if (directory === module)
          writeFileSync(
            join(directory, '.gitmodules'),
            '[submodule "nested"]\n\tpath = nested\n\turl = ./nested\n',
          );
        git('-C', directory, 'add', '.');
        git('-C', directory, 'commit', '--quiet', '--no-verify', '-m', 'module base');
      }
      writeFileSync(
        join(root, '.gitmodules'),
        '[submodule "module"]\n\tpath = module\n\turl = ./module\n',
      );
      commit();
      const indexes = [root, module, nested].map((directory) =>
        readFileSync(join(directory, '.git/index')),
      );
      for (const directory of [module, nested]) {
        const marker = join(directory, 'filter-ran');
        const filter = directory === nested ? 'nestedunsafe' : 'moduleunsafe';
        git('-C', directory, 'config', `filter.${filter}.clean`, `touch '${marker}'; cat`);
        const future = new Date(Date.now() + 5000);
        utimesSync(join(directory, 'file.txt'), future, future);
      }
      if (selectors) {
        vi.stubEnv('GIT_DIR', join(root, '.git'));
        vi.stubEnv('GIT_WORK_TREE', root);
        vi.stubEnv('GIT_INDEX_FILE', join(root, '.git/index'));
      }
      // Ground truth: git -c diff.autoRefreshIndex=false -c filter.moduleunsafe.clean=
      // -c filter.nestedunsafe.clean= diff --ignore-submodules=none HEAD -- module
      const reference = execFileSync(
        'git',
        [
          '-c',
          'diff.autoRefreshIndex=false',
          '-c',
          'filter.moduleunsafe.clean=',
          '-c',
          'filter.nestedunsafe.clean=',
          'diff',
          '--ignore-submodules=none',
          'HEAD',
          '--',
          'module',
        ],
        { cwd: root, env: { ...setupEnv, GIT_OPTIONAL_LOCKS: '0' }, encoding: 'utf8' },
      );
      expect(reference).toBe('');
      await expect(captureWorkingTree({ cwd: root, pathspecs: ['module'] })).rejects.toThrow(
        /module\/file\.txt.*moduleunsafe/,
      );
      for (const directory of [module, nested])
        expect(readdirSync(directory)).not.toContain('filter-ran');
      writeFileSync(join(nested, 'file.txt'), 'changed nested content\n');
      await expect(captureWorkingTree({ cwd: root, pathspecs: ['module'] })).rejects.toThrow(
        /module\/file\.txt.*moduleunsafe/,
      );
      expect(
        [root, module, nested].map((directory) => readFileSync(join(directory, '.git/index'))),
      ).toEqual(indexes);
      for (const directory of [module, nested])
        expect(readdirSync(directory)).not.toContain('filter-ran');
    },
  );

  it.each([false, true])(
    'rejects native filtered content before patch collection (large=%s), while allowing safe subsets and supplied patches',
    async (large) => {
      const marker = join(root, 'filter-ran');
      writeFileSync(join(root, '.gitattributes'), '*.txt filter=normalize\n');
      git('config', 'filter.normalize.clean', `touch '${marker}'; sed 's/.*/stored/'`);
      writeFileSync(join(root, 'asset.txt'), 'working\n');
      writeFileSync(join(root, 'code.ts'), 'old\n');
      commit();
      if (large)
        writeFileSync(join(root, 'asset.txt'), 'w'.repeat(MAX_CAPTURE_BYTES + 1024) + '\n');
      else {
        const future = new Date(Date.now() + 5000);
        utimesSync(join(root, 'asset.txt'), future, future);
      }
      // Ground truth: native Git executes the clean filter and sees the same stored blob.
      expect(git('-c', 'diff.autoRefreshIndex=false', 'diff', 'HEAD', '--', 'asset.txt')).toBe('');
      rmSync(marker, { force: true });
      const indexBefore = readFileSync(join(root, '.git/index'));
      await expect(captureWorkingTree({ cwd: root, pathspecs: ['asset.txt'] })).rejects.toThrow(
        /asset\.txt.*normalize/,
      );
      expect(readdirSync(root)).not.toContain('filter-ran');
      expect(readFileSync(join(root, '.git/index'))).toEqual(indexBefore);
      writeFileSync(join(root, 'code.ts'), 'new\n');
      const safe = await captureWorkingTree({ cwd: root, pathspecs: ['code.ts'] });
      expect(safe.files.map((file) => file.path)).toEqual(['code.ts']);
      expect(safe.patch).toContain('-old\n+new\n');
      const supplied = capturePatch(
        'diff --git a/asset.txt b/asset.txt\n--- a/asset.txt\n+++ b/asset.txt\n@@ -1 +1 @@\n-stored\n+next stored\n',
        { repositoryRoot: root, baseCommit: git('rev-parse', 'HEAD').trim() },
      );
      expect(supplied.files[0]?.path).toBe('asset.txt');
      expect(readdirSync(root)).not.toContain('filter-ran');
    },
  );

  it.each([false, true])(
    'rejects affected filtered paths in nested submodules with root selectors=%s',
    async (selectors) => {
      const module = join(root, 'module');
      const nested = join(module, 'nested');
      const marker = join(root, 'nested-filter-ran');
      mkdirSync(nested, { recursive: true });
      git('-C', nested, 'init', '--quiet');
      git(
        '-C',
        nested,
        'config',
        'filter.normalize.clean',
        `touch '${marker}'; sed 's/.*/stored/'`,
      );
      writeFileSync(join(nested, '.gitattributes'), '*.txt filter=normalize\n');
      writeFileSync(join(nested, 'file.txt'), 'working\n');
      git('-C', nested, 'add', '.');
      git('-C', nested, 'commit', '--quiet', '--no-verify', '-m', 'nested base');
      rmSync(marker, { force: true });
      git('-C', module, 'init', '--quiet');
      writeFileSync(
        join(module, '.gitmodules'),
        '[submodule "nested"]\n\tpath = nested\n\turl = ./nested\n',
      );
      git('-C', module, 'add', '.');
      git('-C', module, 'commit', '--quiet', '--no-verify', '-m', 'module base');
      writeFileSync(
        join(root, '.gitmodules'),
        '[submodule "module"]\n\tpath = module\n\turl = ./module\n',
      );
      writeFileSync(join(root, 'code.ts'), 'old\n');
      commit();
      const future = new Date(Date.now() + 5000);
      utimesSync(join(nested, 'file.txt'), future, future);
      // Ground truth: native Git's nested clean filter leaves this gitlink clean.
      expect(git('-c', 'diff.autoRefreshIndex=false', 'diff', 'HEAD', '--', 'module')).toBe('');
      const staleAgain = new Date(Date.now() + 10000);
      utimesSync(join(nested, 'file.txt'), staleAgain, staleAgain);
      rmSync(marker, { force: true });
      const indexes = [root, module, nested].map((directory) =>
        readFileSync(join(directory, '.git/index')),
      );
      if (selectors) {
        vi.stubEnv('GIT_DIR', join(root, '.git'));
        vi.stubEnv('GIT_WORK_TREE', root);
        vi.stubEnv('GIT_INDEX_FILE', join(root, '.git/index'));
      }
      await expect(captureWorkingTree({ cwd: root, pathspecs: ['module'] })).rejects.toThrow(
        /module\/nested\/file\.txt.*normalize/,
      );
      expect(readdirSync(root)).not.toContain('nested-filter-ran');
      expect(
        [root, module, nested].map((directory) => readFileSync(join(directory, '.git/index'))),
      ).toEqual(indexes);
      writeFileSync(join(root, 'code.ts'), 'new\n');
      const safe = await captureWorkingTree({ cwd: root, pathspecs: ['code.ts'] });
      expect(safe.files.map((file) => file.path)).toEqual(['code.ts']);
      expect(readdirSync(root)).not.toContain('nested-filter-ran');
    },
  );

  it('captures symlink targets without applying regular-file filter attributes', async () => {
    const marker = join(root, 'filter-ran');
    writeFileSync(join(root, '.gitattributes'), '*.txt filter=unsafe\n');
    git('config', 'filter.unsafe.clean', `touch '${marker}'; cat`);
    commit();
    symlinkSync('/outside/capture/target', join(root, 'link.txt'));
    git('add', 'link.txt');
    // Ground truth: Git stores/diffs a symlink target without invoking clean filters.
    const reference = git('-c', 'diff.autoRefreshIndex=false', 'diff', 'HEAD', '--', 'link.txt');
    expect(reference).toContain('new file mode 120000');
    expect(readdirSync(root)).not.toContain('filter-ran');
    const indexBefore = readFileSync(join(root, '.git/index'));
    const artifact = await captureWorkingTree({ cwd: root, pathspecs: ['link.txt'] });
    expect(artifact.patch).toContain('+/outside/capture/target');
    expect(readdirSync(root)).not.toContain('filter-ran');
    expect(readFileSync(join(root, '.git/index'))).toEqual(indexBefore);
  });

  it.each([false, true])(
    'limits submodule filter discovery to native pathspec selections with selectors=%s',
    async (selectors) => {
      const marker = join(root, 'healthy-filter-ran');
      for (const name of ['broken', 'healthy']) {
        const directory = join(root, name);
        mkdirSync(directory);
        git('-C', directory, 'init', '--quiet');
        writeFileSync(join(directory, 'file.txt'), 'base\n');
        writeFileSync(join(directory, '.gitattributes'), '*.txt filter=identity\n');
        git('-C', directory, 'add', '.');
        git('-C', directory, 'commit', '--quiet', '--no-verify', '-m', 'module base');
      }
      writeFileSync(
        join(root, '.gitmodules'),
        '[submodule "broken"]\n\tpath = broken\n\turl = ./broken\n[submodule "healthy"]\n\tpath = healthy\n\turl = ./healthy\n',
      );
      mkdirSync(join(root, 'sub'));
      writeFileSync(join(root, 'root.ts'), 'old\n');
      writeFileSync(join(root, 'sub/code.ts'), 'old\n');
      commit();
      git('-C', 'healthy', 'config', 'filter.identity.clean', `touch '${marker}'; cat`);
      renameSync(join(root, 'broken/.git'), join(root, 'saved-broken-git'));
      writeFileSync(join(root, 'broken/.git'), 'gitdir: missing-gitdir\n');
      writeFileSync(join(root, 'root.ts'), 'new\n');
      writeFileSync(join(root, 'sub/code.ts'), 'new\n');
      const cases = [
        { cwd: root, pathspecs: ['root.ts'] },
        { cwd: join(root, 'sub'), pathspecs: ['code.ts'] },
        { cwd: join(root, 'sub'), pathspecs: ['../root.ts'] },
        { cwd: join(root, 'sub'), pathspecs: [':/root.ts'] },
        { cwd: join(root, 'sub'), pathspecs: [':(top)root.ts'] },
        { cwd: join(root, 'sub'), pathspecs: [':'] },
        { cwd: join(root, 'sub'), pathspecs: [':(top,exclude)broken'], rejectsFilter: true },
        { cwd: join(root, 'sub'), pathspecs: [':!../broken'], rejectsFilter: true },
        { cwd: join(root, 'sub'), pathspecs: [':^../broken'], rejectsFilter: true },
        { cwd: join(root, 'sub'), pathspecs: [':/!broken'], rejectsFilter: true },
      ];
      for (const [index, selection] of cases.entries()) {
        const future = new Date(Date.now() + (index + 1) * 5000);
        utimesSync(join(root, 'healthy/file.txt'), future, future);
        // Ground truth: real Git owns matching and negative-only/top/cwd semantics.
        const reference = execFileSync(
          'git',
          [
            '-c',
            'diff.autoRefreshIndex=false',
            'diff',
            '--name-only',
            '--no-color',
            '--no-relative',
            '--ignore-submodules=none',
            'HEAD',
            '--',
            ...selection.pathspecs,
          ],
          { cwd: selection.cwd, env: { ...setupEnv, GIT_OPTIONAL_LOCKS: '0' }, encoding: 'utf8' },
        );
        const expected = reference.trim().split('\n').filter(Boolean).sort();
        expect(expected.length).toBeGreaterThan(0);
        rmSync(marker, { force: true });
        if (selectors) {
          const nestedCwd = selection.cwd !== root;
          vi.stubEnv('GIT_DIR', nestedCwd ? '../.git' : '.git');
          vi.stubEnv('GIT_WORK_TREE', nestedCwd ? '..' : '.');
          vi.stubEnv('GIT_INDEX_FILE', nestedCwd ? '../.git/index' : '.git/index');
        }
        const indexes = [
          readFileSync(join(root, '.git/index')),
          readFileSync(join(root, 'healthy/.git/index')),
        ];
        if (selection.rejectsFilter) {
          // Negative-only selection includes the stat-uncertain filtered healthy module.
          await expect(captureWorkingTree(selection)).rejects.toThrow(
            /healthy\/file\.txt.*identity/,
          );
        } else {
          const artifact = await captureWorkingTree(selection);
          expect(artifact.files.map((file) => file.path).sort()).toEqual(expected);
        }
        expect(readdirSync(root)).not.toContain('healthy-filter-ran');
        expect([
          readFileSync(join(root, '.git/index')),
          readFileSync(join(root, 'healthy/.git/index')),
        ]).toEqual(indexes);
      }
      vi.stubEnv('GIT_DIR', join(root, '.git'));
      vi.stubEnv('GIT_WORK_TREE', root);
      vi.stubEnv('GIT_INDEX_FILE', join(root, '.git/index'));
      // Git 2.56 reports a broken gitfile as "gitfile does not point to a valid
      // repository"; earlier versions say "not a git repository".
      const brokenRepository = /not a git repository|does not point to a valid repository/;
      await expect(captureWorkingTree({ cwd: root, pathspecs: ['broken'] })).rejects.toThrow(
        brokenRepository,
      );
      expect(() => git('diff', 'HEAD', '--', 'broken')).toThrow(brokenRepository);
    },
  );

  it.each(['untracked', 'typechange'])(
    'does not inspect filters in an undiscovered %s embedded repository',
    async (kind) => {
      const vendor = join(root, 'vendor');
      const inner = join(vendor, 'inner');
      const marker = join(root, 'embedded-filter-ran');
      writeFileSync(join(root, 'root.txt'), 'old\n');
      if (kind === 'typechange') writeFileSync(vendor, 'old blob\n');
      commit();
      if (kind === 'typechange') rmSync(vendor);
      mkdirSync(inner, { recursive: true });
      git('-C', inner, 'init', '--quiet');
      writeFileSync(join(inner, '.gitattributes'), '*.txt filter=innerunsafe\n');
      writeFileSync(join(inner, 'file.txt'), 'base\n');
      git('-C', inner, 'add', '.');
      git('-C', inner, 'commit', '--quiet', '--no-verify', '-m', 'inner base');
      git('-C', inner, 'config', 'filter.innerunsafe.clean', `touch '${marker}'; cat`);
      git('-C', vendor, 'init', '--quiet');
      git('-C', vendor, 'config', 'advice.addEmbeddedRepo', 'false');
      writeFileSync(
        join(vendor, '.gitmodules'),
        '[submodule "inner"]\n\tpath = inner\n\turl = ./inner\n',
      );
      git('-C', vendor, 'add', '.');
      git('-C', vendor, 'commit', '--quiet', '--no-verify', '-m', 'vendor base');
      const later = new Date(Date.now() + 5000);
      utimesSync(join(inner, 'file.txt'), later, later);
      writeFileSync(join(root, 'root.txt'), 'new\n');
      // Ground truth: the parent Git diff does not dirty-check repositories absent from its gitlink index.
      const reference = git(
        '-c',
        'diff.autoRefreshIndex=false',
        'diff',
        '--binary',
        '--full-index',
        '--no-color',
        '--no-ext-diff',
        '--no-textconv',
        '--submodule=short',
        '--ignore-submodules=none',
        '--src-prefix=a/',
        '--dst-prefix=b/',
        '--no-relative',
        'HEAD',
        '--',
      );
      expect(readdirSync(root)).not.toContain('embedded-filter-ran');
      const indexBefore = readFileSync(join(root, '.git/index'));
      if (kind === 'untracked')
        await expect(captureWorkingTree({ cwd: root, includeUntracked: true })).rejects.toThrow(
          'Cannot capture untracked directory: vendor/',
        );
      else expect((await captureWorkingTree({ cwd: root })).patch).toBe(reference);
      expect(readdirSync(root)).not.toContain('embedded-filter-ran');
      expect(readFileSync(join(root, '.git/index'))).toEqual(indexBefore);
    },
  );

  it.each([
    { selectors: false, offCwd: false },
    { selectors: true, offCwd: false },
    { selectors: false, offCwd: true },
    { selectors: true, offCwd: true },
  ])(
    'rejects filter-hidden dirty nested state: $selectors/$offCwd',
    async ({ selectors, offCwd }) => {
      const module = join(root, 'module');
      const nested = join(module, 'nested');
      const marker = join(root, 'hidden-filter-ran');
      mkdirSync(nested, { recursive: true });
      git('-C', nested, 'init', '--quiet');
      writeFileSync(join(nested, '.gitattributes'), '*.txt filter=upper\n');
      writeFileSync(join(nested, 'file.txt'), 'old\n');
      git('-C', nested, 'add', '.');
      git('-C', nested, 'commit', '--quiet', '--no-verify', '-m', 'nested base');
      git('-C', module, 'init', '--quiet');
      git('-C', module, 'config', 'advice.addEmbeddedRepo', 'false');
      writeFileSync(
        join(module, '.gitmodules'),
        '[submodule "nested"]\n\tpath = nested\n\turl = ./nested\n',
      );
      git('-C', module, 'add', '.');
      git('-C', module, 'commit', '--quiet', '--no-verify', '-m', 'module base');
      writeFileSync(
        join(root, '.gitmodules'),
        '[submodule "module"]\n\tpath = module\n\turl = ./module\n',
      );
      commit();
      git('-C', nested, 'config', 'filter.upper.clean', `touch '${marker}'; tr a-z A-Z`);
      const later = new Date(Date.now() + 5000);
      utimesSync(join(nested, 'file.txt'), later, later);
      mkdirSync(join(root, 'sub'));
      const cwd = offCwd ? join(root, 'sub') : root;
      const pathspecs = [offCwd ? '../module' : 'module'];
      // Ground truth: adding a transform after commit makes the raw-equal file natively dirty.
      const reference = execFileSync(
        'git',
        [
          '-c',
          'diff.autoRefreshIndex=false',
          'diff',
          '--no-color',
          '--ignore-submodules=none',
          'HEAD',
          '--',
          ...pathspecs,
        ],
        { cwd, env: { ...setupEnv, GIT_OPTIONAL_LOCKS: '0' }, encoding: 'utf8' },
      );
      expect(reference).toMatch(/\+Subproject commit [a-f\d]{40}-dirty\n/);
      rmSync(marker, { force: true });
      if (selectors) {
        vi.stubEnv('GIT_DIR', offCwd ? '../.git' : '.git');
        vi.stubEnv('GIT_WORK_TREE', offCwd ? '..' : '.');
        vi.stubEnv('GIT_INDEX_FILE', offCwd ? '../.git/index' : '.git/index');
      }
      const indexes = [root, module, nested].map((directory) =>
        readFileSync(join(directory, '.git/index')),
      );
      await expect(captureWorkingTree({ cwd, pathspecs })).rejects.toThrow(
        /module\/nested\/file\.txt.*upper/,
      );
      expect(readdirSync(root)).not.toContain('hidden-filter-ran');
      expect(readFileSync(join(nested, 'file.txt'), 'utf8')).toBe('old\n');
      expect(
        [root, module, nested].map((directory) => readFileSync(join(directory, '.git/index'))),
      ).toEqual(indexes);
    },
  );

  it.each([
    { pathspecs: [] },
    { pathspecs: [':!s.txt'] },
    { pathspecs: [':/root-untracked.txt'] },
    { pathspecs: [':(top)root.txt', ':(top)root-untracked.txt'] },
  ])('includes native off-cwd untracked selection $pathspecs', async ({ pathspecs }) => {
    mkdirSync(join(root, 'sub'));
    writeFileSync(join(root, 'root.txt'), 'old\n');
    writeFileSync(join(root, 'sub/s.txt'), 'old\n');
    commit();
    writeFileSync(join(root, 'root.txt'), 'new\n');
    writeFileSync(join(root, 'sub/s.txt'), 'new\n');
    writeFileSync(join(root, 'root-untracked.txt'), 'untracked\n');
    writeFileSync(join(root, 'sub/sub-untracked.txt'), 'untracked\n');
    const cwd = join(root, 'sub');
    // Ground truth: porcelain -z reports root-relative tracked and untracked names under these pathspecs.
    const reference = execFileSync(
      'git',
      ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...pathspecs],
      { cwd, env: { ...setupEnv, GIT_OPTIONAL_LOCKS: '0' }, encoding: 'utf8' },
    );
    const expected = reference
      .split('\0')
      .filter(Boolean)
      .map((entry) => entry.slice(3))
      .sort();
    const indexBefore = readFileSync(join(root, '.git/index'));
    const artifact = await captureWorkingTree({ cwd, pathspecs, includeUntracked: true });
    expect(artifact.files.map((file) => file.path).sort()).toEqual(expected);
    expect(readFileSync(join(root, 'root-untracked.txt'), 'utf8')).toBe('untracked\n');
    expect(readFileSync(join(root, '.git/index'))).toEqual(indexBefore);
  });

  it('keeps large submodule preflight metadata outside the patch byte limit', async () => {
    const module = join(root, 'module');
    mkdirSync(module);
    git('-C', module, 'init', '--quiet');
    const oldBlob = git('-C', module, 'hash-object', '-w', '--stdin').trim();
    const newBlob = execFileSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: module,
      env: setupEnv,
      input: 'new\n',
      encoding: 'utf8',
    }).trim();
    const paths = Array.from(
      { length: 22000 },
      (_, index) => `${'p'.repeat(200)}/${'f'.repeat(200)}${String(index).padStart(5, '0')}`,
    );
    const names = paths.join('\n') + '\n';
    expect(Buffer.byteLength(names)).toBeGreaterThan(MAX_CAPTURE_BYTES);
    const setIndex = (blob: string) => {
      execFileSync('git', ['update-index', '--index-info'], {
        cwd: module,
        env: setupEnv,
        input: paths.map((path) => `100644 ${blob}\t${path}\n`).join(''),
      });
      execFileSync('git', ['update-index', '--skip-worktree', '--stdin'], {
        cwd: module,
        env: setupEnv,
        input: names,
      });
    };
    setIndex(oldBlob);
    git('-C', module, 'commit', '--quiet', '--no-verify', '-m', 'indexed module base');
    writeFileSync(
      join(root, '.gitmodules'),
      '[submodule "module"]\n\tpath = module\n\turl = ./module\n',
    );
    commit();
    setIndex(newBlob);
    const marker = join(root, 'unused-filter-ran');
    git('-C', module, 'config', 'filter.unused.clean', `touch '${marker}'; cat`);
    // Ground truth: native Git reduces all staged module changes to one small dirty gitlink patch.
    const reference = git(
      '-c',
      'diff.autoRefreshIndex=false',
      'diff',
      '--binary',
      '--full-index',
      '--ignore-submodules=none',
      'HEAD',
      '--',
      'module',
    );
    expect(Buffer.byteLength(reference)).toBeLessThan(1024);
    expect(reference).toContain('-dirty');
    const indexDigest = () =>
      createHash('sha256')
        .update(readFileSync(join(module, '.git/index')))
        .digest('hex');
    const before = indexDigest();
    const artifact = await captureWorkingTree({ cwd: root, pathspecs: ['module'] });
    expect(artifact.files.map((file) => file.path)).toEqual(['module']);
    expect(artifact.patch).toContain('-dirty');
    expect(indexDigest()).toBe(before);
    expect(readdirSync(root)).not.toContain('unused-filter-ran');
  });

  it('captures a small selection when unrelated index metadata exceeds the patch limit', async () => {
    writeFileSync(join(root, 'target.txt'), 'old\n');
    commit();
    const blob = git('hash-object', '-w', '--stdin').trim();
    const entries = Array.from(
      { length: 22000 },
      (_, index) =>
        `100644 ${blob}\t${'p'.repeat(200)}/${'f'.repeat(200)}${String(index).padStart(5, '0')}\n`,
    ).join('');
    expect(Buffer.byteLength(entries)).toBeGreaterThan(MAX_CAPTURE_BYTES);
    execFileSync('git', ['update-index', '--index-info'], {
      cwd: root,
      env: setupEnv,
      input: entries,
    });
    writeFileSync(join(root, 'target.txt'), 'new\n');
    const indexDigest = () =>
      createHash('sha256')
        .update(readFileSync(join(root, '.git/index')))
        .digest('hex');
    const indexBefore = indexDigest();
    // Ground truth: git -c diff.autoRefreshIndex=false diff HEAD -- target.txt
    const reference = git('-c', 'diff.autoRefreshIndex=false', 'diff', 'HEAD', '--', 'target.txt');
    expect(Buffer.byteLength(reference)).toBeLessThan(1024);
    expect(indexDigest()).toBe(indexBefore);
    const artifact = await captureWorkingTree({ cwd: root, pathspecs: ['target.txt'] });
    expect(artifact.files.map((file) => file.path)).toEqual(['target.txt']);
    expect(artifact.patch).toContain('-old\n+new\n');
    const complete = await captureWorkingTree({ cwd: root });
    expect(complete.files.map((file) => file.path)).toEqual(['target.txt']);
    expect(indexDigest()).toBe(indexBefore);
  });

  it('disables filter names containing equals without changing tracked files', async () => {
    writeFileSync(join(root, '.gitattributes'), '*.txt filter=odd=name\n');
    writeFileSync(join(root, 'file.txt'), 'old\n');
    writeFileSync(join(root, 'sentinel'), 'untouched\n');
    commit();
    const sentinel = join(root, 'sentinel');
    git('config', 'filter.odd=name.clean', `printf overwritten > '${sentinel}'; cat`);
    writeFileSync(join(root, 'file.txt'), 'new\n');
    writeFileSync(join(root, 'new.txt'), 'untracked\n');
    const indexBefore = readFileSync(join(root, '.git/index'));
    // Ground truth: GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0='filter.odd=name.clean'
    // GIT_CONFIG_VALUE_0= git -c diff.autoRefreshIndex=false diff HEAD -- file.txt
    const reference = execFileSync(
      'git',
      ['-c', 'diff.autoRefreshIndex=false', 'diff', 'HEAD', '--', 'file.txt'],
      {
        cwd: root,
        env: {
          ...setupEnv,
          GIT_CONFIG_COUNT: '1',
          GIT_CONFIG_KEY_0: 'filter.odd=name.clean',
          GIT_CONFIG_VALUE_0: '',
        },
        encoding: 'utf8',
      },
    );
    expect(reference).toContain('-old\n+new\n');
    expect(readFileSync(sentinel, 'utf8')).toBe('untouched\n');
    await expect(captureWorkingTree({ cwd: root, pathspecs: ['file.txt'] })).rejects.toThrow(
      /file\.txt.*odd=name/,
    );
    await expect(
      captureWorkingTree({
        cwd: root,
        pathspecs: ['new.txt'],
        includeUntracked: true,
      }),
    ).rejects.toThrow(/new\.txt.*odd=name/);
    expect(readFileSync(sentinel, 'utf8')).toBe('untouched\n');
    expect(readFileSync(join(root, '.git/index'))).toEqual(indexBefore);
  });

  it('does not execute repository diff, clean-filter, or filesystem-monitor commands', async () => {
    writeFileSync(join(root, 'file.txt'), 'old\n');
    writeFileSync(join(root, '.gitattributes'), '*.txt filter=unsafe diff=unsafe\n');
    commit();
    const marker = join(root, 'external-command-ran');
    const external = join(root, 'external.sh');
    writeFileSync(external, `#!/bin/sh\ntouch '${marker}'\ncat\n`);
    chmodSync(external, 0o755);
    git('config', 'diff.external', external);
    git('config', 'diff.unsafe.command', external);
    git('config', 'diff.unsafe.textconv', external);
    git('config', 'filter.unsafe.clean', external);
    git('config', 'filter.unsafe.process', external);
    git('config', 'filter.unsafe.required', 'true');
    git('config', 'core.fsmonitor', external);
    writeFileSync(join(root, 'file.txt'), 'new\n');
    await expect(captureWorkingTree({ cwd: root })).rejects.toThrow(/file\.txt.*unsafe/);
    expect(readdirSync(root)).not.toContain('external-command-ran');
  });
});
