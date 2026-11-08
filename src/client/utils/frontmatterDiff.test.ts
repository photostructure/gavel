import { describe, it, expect } from 'vitest';

import { extractFrontmatter, getFrontmatterLines } from './frontmatter';
import { computeFrontmatterDiff, tableAccountsForFrontmatterEdit } from './frontmatterDiff';

describe('tableAccountsForFrontmatterEdit', () => {
  const toDocument = (yaml: string) => `---\n${yaml}\n---\n\nBody\n`;

  const tableAccounts = (oldYaml: string | null, newYaml: string) => {
    const oldDocument = oldYaml === null ? null : toDocument(oldYaml);
    const newDocument = toDocument(newYaml);
    return tableAccountsForFrontmatterEdit(
      oldDocument === null ? [] : getFrontmatterLines(oldDocument),
      getFrontmatterLines(newDocument),
      computeFrontmatterDiff(
        oldDocument === null ? null : extractFrontmatter(oldDocument).data,
        extractFrontmatter(newDocument).data,
      ),
    );
  };

  it.each([
    ['a comment edit', '# draft\ntitle: Same', '# final\ntitle: Same'],
    ['a quoting edit', 'title: Old', 'title: "Old"'],
    ['a key order edit', 'a: 1\nb: 2', 'b: 2\na: 1'],
    ['a comment edit mixed with a value edit', '# draft\ntitle: Old', '# final\ntitle: New'],
    ['a key order edit mixed with a value edit', 'a: 1\nb: 2\nc: 3', 'c: 3\na: 1\nb: 9'],
    ['an added blank line', 'title: Same\nauthor: X', 'title: Same\n\nauthor: X'],
    ['a blank line added above a changed key', 'title: Old', '\ntitle: New'],
    ['a comment edit below a changed key', 'title: Old\n# a', 'title: New\n# b'],
    ['a blank line added below a changed key', 'title: Old\nauthor: X', 'title: New\n\nauthor: X'],
    ['a flow to block style edit', 'tags: [a, b]', 'tags:\n- a\n- b'],
    ['an inline comment on an unchanged line', 'title: Same # a', 'title: Same # b'],
  ])('does not account for %s', (_case, oldYaml, newYaml) => {
    expect(tableAccounts(oldYaml, newYaml)).toBe(false);
  });

  it.each([
    ['identical frontmatter', '# note\ntitle: Same', '# note\ntitle: Same'],
    ['a plain value edit', 'title: Old', 'title: New'],
    ['an added key', 'title: Same', 'title: Same\nauthor: X'],
    ['a nested value edit', 'seo:\n  title: A', 'seo:\n  title: B'],
    ['a column-0 sequence value edit', 'tags:\n- a\n- b', 'tags:\n- a\n- c'],
    [
      'a block scalar edit after a blank line',
      'description: |\n  one\n\n  two',
      'description: |\n  one\n\n  TWO',
    ],
    ['a nested value edit after a blank line', 'seo:\n  a: 1\n\n  b: 2', 'seo:\n  a: 1\n\n  b: 3'],
    [
      'a sequence edit after a column-0 comment',
      'tags:\n- a\n# note\n- b',
      'tags:\n- a\n# note\n- c',
    ],
    ['a double-quoted key value edit', '"title": Old', '"title": New'],
    ['a single-quoted key value edit', "'title': Old", "'title': New"],
    ['a number becoming a quoted string', 'version: 1', 'version: "1"'],
    ['a boolean becoming a quoted string', 'draft: true', 'draft: "true"'],
  ])('accounts for %s', (_case, oldYaml, newYaml) => {
    expect(tableAccounts(oldYaml, newYaml)).toBe(true);
  });

  it('accounts for an added file with no comments', () => {
    expect(tableAccounts(null, 'title: Same\nauthor: X')).toBe(true);
  });

  it('does not account for an added file with a comment', () => {
    expect(tableAccounts(null, '# note\ntitle: Same')).toBe(false);
  });

  // Known limits: both comments sit on lines attributed to a key the table shows
  // as changed, so they are dropped from the comparison and stay hidden.
  it('accounts for an inline comment on a changed line, which stays hidden', () => {
    expect(tableAccounts('title: Old # a', 'title: New # b')).toBe(true);
  });

  it('accounts for an indented comment inside a changed key, which stays hidden', () => {
    expect(tableAccounts('seo:\n  # a\n  title: A', 'seo:\n  # b\n  title: B')).toBe(true);
  });
});

describe('computeFrontmatterDiff', () => {
  it('treats key order changes as unchanged (canonical stringify)', () => {
    const old = { a: 1, b: 2 };
    const new_ = { b: 2, a: 1 };
    expect(computeFrontmatterDiff(old, new_)).toEqual([
      { key: 'b', status: 'unchanged', oldValue: 2, newValue: 2 },
      { key: 'a', status: 'unchanged', oldValue: 1, newValue: 1 },
    ]);
  });

  it('detects type conversions as modified', () => {
    const old = { published: 'true' };
    const new_ = { published: true };
    expect(computeFrontmatterDiff(old, new_)).toEqual([
      { key: 'published', status: 'modified', oldValue: 'true', newValue: true },
    ]);
  });

  it('treats nested object key order changes as unchanged', () => {
    const old = { seo: { title: 'A', desc: 'X' } };
    const new_ = { seo: { desc: 'X', title: 'A' } };
    expect(computeFrontmatterDiff(old, new_)).toEqual([
      { key: 'seo', status: 'unchanged', oldValue: old.seo, newValue: new_.seo },
    ]);
  });

  it('detects nested value changes as modified', () => {
    const old = { seo: { title: 'A' } };
    const new_ = { seo: { title: 'B' } };
    expect(computeFrontmatterDiff(old, new_)).toEqual([
      { key: 'seo', status: 'modified', oldValue: old.seo, newValue: new_.seo },
    ]);
  });

  it('treats identical arrays as unchanged', () => {
    const old = { tags: ['a', 'b'] };
    const new_ = { tags: ['a', 'b'] };
    expect(computeFrontmatterDiff(old, new_)).toEqual([
      { key: 'tags', status: 'unchanged', oldValue: old.tags, newValue: new_.tags },
    ]);
  });

  it('treats array order changes as modified', () => {
    const old = { tags: ['a', 'b'] };
    const new_ = { tags: ['b', 'a'] };
    expect(computeFrontmatterDiff(old, new_)).toEqual([
      { key: 'tags', status: 'modified', oldValue: old.tags, newValue: new_.tags },
    ]);
  });

  it('detects null to value transitions as modified', () => {
    const old = { x: null };
    const new_ = { x: 'value' };
    expect(computeFrontmatterDiff(old, new_)).toEqual([
      { key: 'x', status: 'modified', oldValue: null, newValue: 'value' },
    ]);
  });

  it('treats both-null values as unchanged', () => {
    const old = { x: null };
    const new_ = { x: null };
    expect(computeFrontmatterDiff(old, new_)).toEqual([
      { key: 'x', status: 'unchanged', oldValue: null, newValue: null },
    ]);
  });

  it('returns an empty array when both sides are null', () => {
    expect(computeFrontmatterDiff(null, null)).toEqual([]);
  });

  it('returns all keys as added when oldData is null', () => {
    expect(computeFrontmatterDiff(null, { title: 'X', desc: 'Y' })).toEqual([
      { key: 'title', status: 'added', oldValue: undefined, newValue: 'X' },
      { key: 'desc', status: 'added', oldValue: undefined, newValue: 'Y' },
    ]);
  });

  it('returns all keys as removed when newData is null', () => {
    expect(computeFrontmatterDiff({ old_key: 'X' }, null)).toEqual([
      { key: 'old_key', status: 'removed', oldValue: 'X', newValue: undefined },
    ]);
  });

  it('orders entries as new-first then old-only appendix', () => {
    const old = { common: 'Y', old_only: 'Z' };
    const new_ = { new_key: 'X', common: 'Y' };
    expect(computeFrontmatterDiff(old, new_)).toEqual([
      { key: 'new_key', status: 'added', oldValue: undefined, newValue: 'X' },
      { key: 'common', status: 'unchanged', oldValue: 'Y', newValue: 'Y' },
      { key: 'old_only', status: 'removed', oldValue: 'Z', newValue: undefined },
    ]);
  });

  it('treats equal Date values as unchanged', () => {
    const d1 = new Date('2020-01-01T00:00:00Z');
    const d2 = new Date('2020-01-01T00:00:00Z');
    expect(computeFrontmatterDiff({ date: d1 }, { date: d2 })).toEqual([
      { key: 'date', status: 'unchanged', oldValue: d1, newValue: d2 },
    ]);
  });
});
