import { describe, expect, it } from 'vitest';

import { captureDelta } from './capture-delta.js';

function gitFile(
  path: string,
  hunks: string[],
  index = 'index 1111111..2222222 100644',
  modes = '',
): string {
  return `diff --git a/${path} b/${path}\n${modes}${index}\n--- a/${path}\n+++ b/${path}\n${hunks.join('')}`;
}

const hunk = (start: number, removed: string, added: string, context = 'function f()') =>
  `@@ -${start},3 +${start},3 @@ ${context}\n keep\n-${removed}\n+${added}\n keep\n`;

// A typechange from a file to a symlink, as Git writes it: a deletion record and an addition
// record for the same path.
const deletion =
  'diff --git a/t.txt b/t.txt\ndeleted file mode 100644\nindex 1111111..0000000\n--- a/t.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-hello\n';
const addition =
  'diff --git a/t.txt b/t.txt\nnew file mode 120000\nindex 0000000..2222222\n--- /dev/null\n+++ b/t.txt\n@@ -0,0 +1 @@\n+a.ts\n\\ No newline at end of file\n';

describe('captureDelta', () => {
  it('calls every hunk unchanged after a rebase that only moved hunks and changed blob ids', () => {
    const before = gitFile('src/a.ts', [hunk(10, 'a', 'b'), hunk(40, 'c', 'd')]);
    const after = gitFile(
      'src/a.ts',
      [hunk(13, 'a', 'b'), hunk(43, 'c', 'd')],
      'index 3333333..4444444 100644',
    );
    expect(captureDelta(before, after)).toEqual({
      files: [
        { path: 'src/a.ts', unchanged: [true, true], headerUnchanged: true, removedHunks: 0 },
      ],
      removedPaths: [],
    });
  });

  it('marks an edited hunk changed and counts the hunk it replaced as removed', () => {
    const before = gitFile('src/a.ts', [hunk(10, 'a', 'b'), hunk(40, 'c', 'd')]);
    const after = gitFile('src/a.ts', [hunk(10, 'a', 'b'), hunk(40, 'c', 'e')]);
    expect(captureDelta(before, after).files).toEqual([
      { path: 'src/a.ts', unchanged: [true, false], headerUnchanged: true, removedHunks: 1 },
    ]);
  });

  it('counts a reverted hunk as removed', () => {
    const before = gitFile('src/a.ts', [hunk(10, 'a', 'b'), hunk(40, 'c', 'd')]);
    const after = gitFile('src/a.ts', [hunk(10, 'a', 'b')]);
    expect(captureDelta(before, after).files).toEqual([
      { path: 'src/a.ts', unchanged: [true], headerUnchanged: true, removedHunks: 1 },
    ]);
  });

  it('marks a hunk that merged two earlier hunks changed', () => {
    const before = gitFile('src/a.ts', [hunk(10, 'a', 'b'), hunk(16, 'c', 'd')]);
    const merged =
      '@@ -10,7 +10,7 @@ function f()\n keep\n-a\n+b\n keep\n-x\n+y\n keep\n-c\n+d\n keep\n';
    expect(captureDelta(before, gitFile('src/a.ts', [merged])).files).toEqual([
      { path: 'src/a.ts', unchanged: [false], headerUnchanged: true, removedHunks: 2 },
    ]);
  });

  it('marks a whitespace-only edit changed', () => {
    const before = gitFile('src/a.ts', [hunk(10, 'a', 'b')]);
    const after = gitFile('src/a.ts', [hunk(10, 'a', 'b ')]);
    expect(captureDelta(before, after).files[0]?.unchanged).toEqual([false]);
  });

  it('marks adding or removing the final newline changed', () => {
    const withNewline = gitFile('src/a.ts', ['@@ -1 +1 @@\n-a\n+b\n']);
    const without = gitFile('src/a.ts', ['@@ -1 +1 @@\n-a\n+b\n\\ No newline at end of file\n']);
    expect(captureDelta(withNewline, without).files[0]?.unchanged).toEqual([false]);
    expect(captureDelta(without, withNewline).files[0]?.unchanged).toEqual([false]);
  });

  it('counts a change to the hunk header context alone as changed', () => {
    const before = gitFile('src/a.ts', [hunk(10, 'a', 'b', 'function f()')]);
    const after = gitFile('src/a.ts', [hunk(10, 'a', 'b', 'function g()')]);
    expect(captureDelta(before, after).files[0]?.unchanged).toEqual([false]);
  });

  it('marks every copy changed when an edit now appears more often than before', () => {
    const before = gitFile('config.json', [hunk(10, '"timeout": 5', '"timeout": 9', '')]);
    const after = gitFile('config.json', [
      hunk(10, '"timeout": 5', '"timeout": 9', ''),
      hunk(40, '"timeout": 5', '"timeout": 9', ''),
    ]);
    expect(captureDelta(before, after).files).toEqual([
      { path: 'config.json', unchanged: [false, false], headerUnchanged: true, removedHunks: 0 },
    ]);
  });

  it('matches by the new path, so a newly renamed file is all changed', () => {
    const before = gitFile('src/a.ts', [hunk(10, 'a', 'b')]);
    const after = [
      'diff --git a/src/a.ts b/src/b.ts',
      'similarity index 90%',
      'rename from src/a.ts',
      'rename to src/b.ts',
      'index 1111111..2222222 100644',
      '--- a/src/a.ts',
      '+++ b/src/b.ts',
      hunk(10, 'a', 'b'),
    ].join('\n');
    expect(captureDelta(before, after)).toEqual({
      files: [{ path: 'src/b.ts', unchanged: [false], headerUnchanged: false, removedHunks: 0 }],
      removedPaths: ['src/a.ts'],
    });
  });

  it('ignores a rename similarity percentage that a rebase recomputed', () => {
    const renamed = (similarity: number) =>
      [
        'diff --git a/src/a.ts b/src/b.ts',
        `similarity index ${similarity}%`,
        'rename from src/a.ts',
        'rename to src/b.ts',
        'index 1111111..2222222 100644',
        '--- a/src/a.ts',
        '+++ b/src/b.ts',
        hunk(10, 'a', 'b'),
      ].join('\n');
    expect(captureDelta(renamed(89), renamed(91)).files).toEqual([
      { path: 'src/b.ts', unchanged: [true], headerUnchanged: true, removedHunks: 0 },
    ]);
  });

  it('reports a mode change beside unchanged hunks through the header', () => {
    const modes = 'old mode 100644\nnew mode 100755\n';
    const before = gitFile('s.sh', [hunk(1, 'a', 'b')], 'index 1111111..2222222', modes);
    const after = gitFile('s.sh', [hunk(1, 'a', 'b')]);
    expect(captureDelta(before, after).files).toEqual([
      { path: 's.sh', unchanged: [true], headerUnchanged: false, removedHunks: 0 },
    ]);
  });

  it('compares the records of a typechange, which share a path', () => {
    expect(captureDelta(deletion + addition, deletion + addition).files).toEqual([
      { path: 't.txt', unchanged: [true], headerUnchanged: true, removedHunks: 0 },
      { path: 't.txt', unchanged: [true], headerUnchanged: true, removedHunks: 0 },
    ]);
  });

  it('finds a typechange hunk in whichever record of its path it now sits', () => {
    // A rebase over an upstream deletion of the file leaves only the addition record.
    expect(captureDelta(deletion + addition, addition).files).toEqual([
      { path: 't.txt', unchanged: [true], headerUnchanged: true, removedHunks: 1 },
    ]);
  });

  it('compares a file without hunks, such as a binary file, by its whole record', () => {
    const binary = (newBlob: string) =>
      `diff --git a/logo.png b/logo.png\nindex ${'1'.repeat(40)}..${newBlob} 100644\nBinary files a/logo.png and b/logo.png differ\n`;
    const v1 = binary('2'.repeat(40));
    expect(captureDelta(v1, v1).files).toEqual([
      { path: 'logo.png', unchanged: [], headerUnchanged: true, removedHunks: 0 },
    ]);
    expect(captureDelta(v1, binary('3'.repeat(40))).files).toEqual([
      { path: 'logo.png', unchanged: [], headerUnchanged: false, removedHunks: 0 },
    ]);
  });
});
