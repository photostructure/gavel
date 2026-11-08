import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { GitDiffParser } from './git-diff.js';
import { capturePatch } from './review-capture.js';

const fixtureRoots: string[] = [];

interface Fixture {
  root: string;
  git: (...args: string[]) => string;
  /** Stage a blob through the index, so names the filesystem may refuse still reach Git. */
  stage: (path: string | Buffer, content: string, mode?: string) => void;
  /** Stage a blob's removal through the index. */
  unstage: (path: string | Buffer) => void;
  /** Stage a gitlink. Git records the commit ID without needing the commit to exist. */
  stageGitlink: (path: string, commitId: string) => void;
  commit: () => void;
  parseCommits: () => ReturnType<GitDiffParser['parseDiff']>;
}

function createFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'gavel-metadata-'));
  fixtureRoots.push(root);
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_NOSYSTEM: '1',
  };
  const run = (args: string[], input?: string | Buffer) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=gavel',
        '-c',
        'user.email=gavel@example.com',
        '-c',
        'commit.gpgsign=false',
        '-c',
        `core.hooksPath=${join(root, 'disabled-hooks')}`,
        ...args,
      ],
      { cwd: root, env, encoding: 'utf8', input },
    );
  const indexInfo = (mode: string, oid: string, path: string | Buffer) =>
    run(
      ['update-index', '-z', '--index-info'],
      Buffer.concat([Buffer.from(`${mode} ${oid}\t`), Buffer.from(path), Buffer.from([0])]),
    );
  run(['init', '--quiet']);
  // A developer's global diff.renames must not decide what these fixtures detect.
  run(['config', 'diff.renames', 'true']);
  return {
    root,
    git: (...args) => run(args),
    stage: (path, content, mode = '100644') => {
      indexInfo(mode, run(['hash-object', '-w', '--stdin'], content).trim(), path);
    },
    unstage: (path) => {
      indexInfo('0', '0'.repeat(40), path);
    },
    stageGitlink: (path, commitId) => {
      indexInfo('160000', commitId, path);
    },
    commit: () => {
      run(['commit', '--quiet', '--no-verify', '--allow-empty', '-m', 'fixture']);
    },
    parseCommits: () =>
      new GitDiffParser(root).parseDiff({ baseCommitish: 'HEAD~1', targetCommitish: 'HEAD' }),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('native Git metadata paths', () => {
  it.each(['plain space.sh', 'é space.sh', '🌲 space.sh', 'dir b/part name.sh'])(
    'renders a metadata-only mode change literally: %s',
    (path) => {
      const patch = `diff --git a/${path} b/${path}\nold mode 100644\nnew mode 100755\n`;
      const response = new GitDiffParser().parseStdinDiff(patch);
      expect(response.files).toEqual([
        expect.objectContaining({ path, status: 'modified', chunks: [] }),
      ]);
      expect(response.isEmpty).toBe(false);
    },
  );

  it.each([
    { operation: 'rename', status: 'renamed' },
    { operation: 'copy', status: 'copied' },
  ])(
    'preserves literal prefix-like directories in $operation metadata',
    ({ operation, status }) => {
      const patch = `diff --git a/a/old space.txt b/b/new space.txt\nsimilarity index 100%\n${operation} from a/old space.txt\n${operation} to b/new space.txt\n`;
      expect(new GitDiffParser().parseStdinDiff(patch).files).toEqual([
        expect.objectContaining({
          path: 'b/new space.txt',
          oldPath: 'a/old space.txt',
          status,
          chunks: [],
        }),
      ]);
    },
  );

  it('renders a pure copy from actual Git output without ordinary file headers', () => {
    const { root, git } = createFixture();
    git('config', 'color.ui', 'always');
    const original = 'one\ntwo\nthree\n';
    writeFileSync(join(root, 'old space.txt'), original);
    git('add', 'old space.txt');
    git('commit', '--quiet', '--no-verify', '-m', 'fixture');
    writeFileSync(join(root, 'new space.txt'), original);
    writeFileSync(join(root, 'old space.txt'), 'changed\ntwo\nthree\n');
    git('add', 'old space.txt', 'new space.txt');
    // git -c color.ui=always diff --color=never --find-copies HEAD -- keeps headers uncolored.
    const patch = git(
      'diff',
      '--color=never',
      '--no-ext-diff',
      '--no-textconv',
      '--find-copies',
      'HEAD',
      '--',
    );
    expect(patch).toContain('copy from old space.txt\ncopy to new space.txt\n');
    const files = new GitDiffParser(root).parseStdinDiff(patch).files;
    expect(files.map((file) => file.path)).toEqual(['new space.txt', 'old space.txt']);
    expect(files[0]).toMatchObject({ oldPath: 'old space.txt', status: 'copied', chunks: [] });
  });

  it('reports a copy and a rename distinctly for repository comparisons and imported patches', async () => {
    const fixture = createFixture();
    fixture.git('config', 'diff.renames', 'copies');
    const copySource = 'copy one\ncopy two\ncopy three\n';
    const renameSource = 'rename one\nrename two\nrename three\n';
    fixture.stage('copy-source.txt', copySource);
    fixture.stage('rename-source.txt', renameSource);
    fixture.commit();
    fixture.stage('copied.txt', copySource);
    fixture.stage('copy-source.txt', 'changed\ncopy two\ncopy three\n');
    fixture.stage('renamed.txt', renameSource);
    fixture.unstage('rename-source.txt');
    fixture.commit();

    const expected = [
      expect.objectContaining({
        path: 'copied.txt',
        oldPath: 'copy-source.txt',
        status: 'copied',
      }),
      expect.objectContaining({ path: 'copy-source.txt', status: 'modified' }),
      expect.objectContaining({
        path: 'renamed.txt',
        oldPath: 'rename-source.txt',
        status: 'renamed',
      }),
    ];
    expect((await fixture.parseCommits()).files).toEqual(expected);
    expect(
      new GitDiffParser(fixture.root).parseStdinDiff(fixture.git('diff', 'HEAD~1', 'HEAD')).files,
    ).toEqual(expected);
  });

  it.each(['src/dev/null.txt', 'src/dev/null'])('keeps %s modified', async (path) => {
    const fixture = createFixture();
    fixture.stage(path, 'one\n');
    fixture.commit();
    fixture.stage(path, 'two\n');
    fixture.commit();

    expect((await fixture.parseCommits()).files).toEqual([
      expect.objectContaining({ path, status: 'modified', additions: 1, deletions: 1 }),
    ]);
  });

  it.each([
    { direction: 'file to symlink', before: '100644', after: '120000' },
    { direction: 'symlink to file', before: '120000', after: '100644' },
  ])('folds a type change from $direction into one entry', async ({ before, after }) => {
    const fixture = createFixture();
    fixture.stage('changing', 'old one\nold two\n', before);
    fixture.stage('neighbor', 'one\n');
    fixture.commit();
    fixture.stage('changing', 'new one\n', after);
    fixture.stage('neighbor', 'two\n');
    fixture.commit();

    const { files } = await fixture.parseCommits();

    expect(files.map(({ path, status }) => ({ path, status }))).toEqual([
      { path: 'changing', status: 'modified' },
      { path: 'neighbor', status: 'modified' },
    ]);
    expect(files[0]).toMatchObject({ additions: 1, deletions: 2 });
    expect(files[0]?.oldPath).toBeUndefined();
    expect(files[0]?.chunks).toEqual([
      expect.objectContaining({ oldStart: 1, oldLines: 2, newStart: 1, newLines: 1 }),
    ]);
    expect(files[0]?.chunks[0]?.lines).toEqual([
      expect.objectContaining({ type: 'delete', content: 'old one', oldLineNumber: 1 }),
      expect.objectContaining({ type: 'delete', content: 'old two', oldLineNumber: 2 }),
      expect.objectContaining({ type: 'add', content: 'new one', newLineNumber: 1 }),
    ]);
  });
});

describe('repository comparisons under hostile Git config', () => {
  const COMMIT_A = 'a'.repeat(40);
  const COMMIT_B = 'b'.repeat(40);

  it.each([
    { name: 'diff.noPrefix', settings: [['diff.noPrefix', 'true']] },
    {
      name: 'diff.srcPrefix and diff.dstPrefix',
      settings: [
        ['diff.srcPrefix', 'y/'],
        ['diff.dstPrefix', 'z/'],
      ],
    },
    { name: 'diff.submodule=log', settings: [['diff.submodule', 'log']] },
    { name: 'diff.submodule=diff', settings: [['diff.submodule', 'diff']] },
  ])('yields the default files under $name', async ({ settings }) => {
    const fixture = createFixture();
    const moved = 'moved one\nmoved two\nmoved three\n';
    fixture.stage('README.md', 'one\n');
    fixture.stage('spaced name.txt', 'one\n');
    // A mode-only change has no ---/+++ paths, so its header alone names it.
    fixture.stage('spaced mode.sh', 'echo\n');
    fixture.stage('moved source.txt', moved);
    fixture.stageGitlink('vendor', COMMIT_A);
    fixture.commit();
    fixture.stage('README.md', 'two\n');
    fixture.stage('spaced name.txt', 'two\n');
    fixture.stage('spaced mode.sh', 'echo\n', '100755');
    fixture.stage('moved target.txt', moved);
    fixture.unstage('moved source.txt');
    fixture.stageGitlink('vendor', COMMIT_B);
    fixture.commit();

    const defaults = (await fixture.parseCommits()).files;
    expect(defaults.map(({ path, oldPath, status }) => ({ path, oldPath, status }))).toEqual([
      { path: 'README.md', oldPath: undefined, status: 'modified' },
      { path: 'moved target.txt', oldPath: 'moved source.txt', status: 'renamed' },
      { path: 'spaced mode.sh', oldPath: undefined, status: 'modified' },
      { path: 'spaced name.txt', oldPath: undefined, status: 'modified' },
      { path: 'vendor', oldPath: undefined, status: 'modified' },
    ]);

    for (const [key, value] of settings) fixture.git('config', key ?? '', value ?? '');

    expect((await fixture.parseCommits()).files).toEqual(defaults);
  });
});

describe('unusual path bytes', () => {
  const tabPath = 'with\ttab.txt';
  const newlinePath = 'with\nnewline.txt';
  const nonUtf8Name = (byte: number) =>
    Buffer.concat([Buffer.from('caf'), Buffer.from([byte]), Buffer.from('.txt')]);
  const firstNonUtf8 = '"caf\\351.txt"';
  const secondNonUtf8 = '"caf\\350.txt"';

  function createUnusualPathFixture(): Fixture {
    const fixture = createFixture();
    fixture.stage('anchor.txt', 'anchor\n');
    fixture.commit();
    fixture.stage(tabPath, 'tab\n');
    fixture.stage(newlinePath, 'newline\n');
    fixture.stage('ünïcode space.txt', 'unicode\n');
    fixture.stage(nonUtf8Name(0xe9), 'first\n');
    fixture.stage(nonUtf8Name(0xe8), 'second\n');
    fixture.commit();
    return fixture;
  }

  it('keeps tab, newline and non-UTF-8 names distinct and flags only the non-UTF-8 ones', async () => {
    const { files } = await createUnusualPathFixture().parseCommits();

    expect(
      files.map(({ path, status, hasNonUtf8Path }) => ({ path, status, hasNonUtf8Path })),
    ).toEqual([
      { path: secondNonUtf8, status: 'added', hasNonUtf8Path: true },
      { path: firstNonUtf8, status: 'added', hasNonUtf8Path: true },
      { path: tabPath, status: 'added', hasNonUtf8Path: undefined },
      { path: newlinePath, status: 'added', hasNonUtf8Path: undefined },
      { path: 'ünïcode space.txt', status: 'added', hasNonUtf8Path: undefined },
    ]);
  });

  it('reads the same names when core.quotePath is disabled', async () => {
    const fixture = createUnusualPathFixture();
    const defaults = (await fixture.parseCommits()).files;

    fixture.git('config', 'core.quotePath', 'false');

    expect((await fixture.parseCommits()).files).toEqual(defaults);
  });

  it('flags a rename whose old name is not valid UTF-8', async () => {
    const fixture = createFixture();
    const contents = 'one\ntwo\nthree\n';
    fixture.stage(nonUtf8Name(0xe9), contents);
    fixture.commit();
    fixture.unstage(nonUtf8Name(0xe9));
    fixture.stage('renamed.txt', contents);
    fixture.commit();

    expect((await fixture.parseCommits()).files).toEqual([
      expect.objectContaining({
        path: 'renamed.txt',
        oldPath: firstNonUtf8,
        status: 'renamed',
        hasNonUtf8Path: true,
      }),
    ]);
  });

  it('flags non-UTF-8 names in imported patches too', () => {
    const fixture = createUnusualPathFixture();
    const parsed = new GitDiffParser(fixture.root).parseStdinDiff(
      fixture.git('diff', 'HEAD~1', 'HEAD'),
    );

    expect(parsed.files.filter((file) => file.hasNonUtf8Path).map((file) => file.path)).toEqual([
      secondNonUtf8,
      firstNonUtf8,
    ]);
  });

  it('still rejects non-UTF-8 names in a capture', () => {
    const fixture = createUnusualPathFixture();

    expect(() =>
      capturePatch(fixture.git('diff', '--full-index', 'HEAD~1', 'HEAD'), {
        repositoryRoot: fixture.root,
        baseCommit: 'a'.repeat(40),
      }),
    ).toThrow('not valid UTF-8');
  });

  it('lists identical files under the C and C.utf8 locales', async () => {
    const fixture = createUnusualPathFixture();

    vi.stubEnv('LANG', 'C');
    vi.stubEnv('LC_ALL', 'C');
    const underC = (await fixture.parseCommits()).files;
    vi.stubEnv('LANG', 'C.utf8');
    vi.stubEnv('LC_ALL', 'C.utf8');
    const underUtf8 = (await fixture.parseCommits()).files;

    expect(underC).toHaveLength(5);
    expect(underUtf8).toEqual(underC);
  });
});

describe('combined diffs of a conflicted working tree', () => {
  function createConflict(): Fixture {
    const fixture = createFixture();
    const { root, git } = fixture;
    git('config', 'merge.conflictStyle', 'merge');
    git('checkout', '--quiet', '-b', 'fixture-base');
    for (const [name, content] of [
      ['a-first.txt', 'first\n'],
      ['conflict space.txt', 'base\n'],
      ['z-last.txt', 'last\n'],
    ] as const) {
      writeFileSync(join(root, name), content);
    }
    writeFileSync(join(root, 'conflict.bin'), Buffer.from([0, 1]));
    git('add', '.');
    fixture.commit();
    git('checkout', '--quiet', '-b', 'fixture-theirs');
    writeFileSync(join(root, 'conflict space.txt'), 'theirs\n');
    writeFileSync(join(root, 'conflict.bin'), Buffer.from([0, 2]));
    git('commit', '--quiet', '--no-verify', '-am', 'theirs');
    git('checkout', '--quiet', 'fixture-base');
    writeFileSync(join(root, 'conflict space.txt'), 'ours\n');
    writeFileSync(join(root, 'conflict.bin'), Buffer.from([0, 3]));
    git('commit', '--quiet', '--no-verify', '-am', 'ours');
    expect(() => git('merge', '--no-edit', 'fixture-theirs')).toThrow();
    return fixture;
  }

  const parseWorking = (root: string) =>
    new GitDiffParser(root).parseDiff({ baseCommitish: 'staged', targetCommitish: 'working' });

  it('lists a conflicted file as its own entry beside ordinary changes', async () => {
    const fixture = createConflict();
    writeFileSync(join(fixture.root, 'a-first.txt'), 'first changed\n');
    writeFileSync(join(fixture.root, 'z-last.txt'), 'last changed\n');
    // Ground truth: Git prints the combined blocks before the ordinary ones.
    expect(fixture.git('diff')).toMatch(/^diff --cc conflict space\.txt\n/);

    const { files } = await parseWorking(fixture.root);

    expect(files.map(({ path, status }) => ({ path, status }))).toEqual([
      { path: 'conflict space.txt', status: 'modified' },
      { path: 'conflict.bin', status: 'modified' },
      { path: 'a-first.txt', status: 'modified' },
      { path: 'z-last.txt', status: 'modified' },
    ]);
    expect(files[2]?.chunks).toHaveLength(1);
    expect(files[2]?.chunks[0]?.lines.map((line) => line.content)).toEqual([
      'first',
      'first changed',
    ]);
  });

  it('names a conflicted file correctly when nothing else changed', async () => {
    const { root } = createConflict();

    const { files } = await parseWorking(root);

    expect(files.map((file) => file.path)).toEqual(['conflict space.txt', 'conflict.bin']);
  });
});
