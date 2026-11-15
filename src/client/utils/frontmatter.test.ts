import { describe, it, expect, vi } from 'vitest';

import { extractFrontmatter, getFrontmatterLines } from './frontmatter';

describe('extractFrontmatter', () => {
  it('returns null data when there is no frontmatter', () => {
    const text = '# Hello\n\nJust a regular markdown document.';
    expect(extractFrontmatter(text)).toEqual({ data: null, content: text });
  });

  it('returns null data with stripped content for empty frontmatter', () => {
    const text = '---\n---\nBody text.';
    expect(extractFrontmatter(text)).toEqual({ data: null, content: 'Body text.' });
  });

  it('parses valid scalar YAML frontmatter', () => {
    const text = '---\ntitle: Hello\npublished: true\n---\nBody text.';
    const result = extractFrontmatter(text);
    expect(result.data).toEqual({ title: 'Hello', published: true });
    expect(typeof result.data?.title).toBe('string');
    expect(typeof result.data?.published).toBe('boolean');
    expect(result.content).toBe('Body text.');
  });

  it('falls back to the original text on YAML syntax errors', () => {
    const text = '---\n[unclosed\n---\nBody text.';
    expect(extractFrontmatter(text)).toEqual({ data: null, content: text });
  });

  it('returns null data when the top-level YAML value is not an object', () => {
    const text = '---\n42\n---\nBody text.';
    expect(extractFrontmatter(text)).toEqual({ data: null, content: 'Body text.' });
  });

  // Expected values are what js-yaml 4.3.2's load(), which this parser used
  // before js-yaml 5, returned for these blocks (checked 2026-11-05).
  it('strips a frontmatter block that holds only a blank line or a comment', () => {
    expect(extractFrontmatter('---\n\n---\nBody text.')).toEqual({
      data: null,
      content: 'Body text.',
    });
    expect(extractFrontmatter('---\n# draft\n---\nBody text.')).toEqual({
      data: null,
      content: 'Body text.',
    });
  });

  it('parses unquoted and tagged dates as Date values', () => {
    const expected = { date: new Date('2026-11-05T00:00:00.000Z') };
    expect(extractFrontmatter('---\ndate: 2026-11-05\n---\n').data).toEqual(expected);
    expect(extractFrontmatter('---\ndate: !!timestamp 2026-11-05\n---\n').data).toEqual(expected);
  });

  it('resolves merge keys and keeps yes as a string', () => {
    const text = '---\nbase: &b\n  a: 1\nderived:\n  <<: *b\n  c: 2\ndraft: yes\n---\n';
    expect(extractFrontmatter(text).data).toEqual({
      base: { a: 1 },
      derived: { a: 1, c: 2 },
      draft: 'yes',
    });
  });

  it('keeps ordinary shared aliases usable', () => {
    const text = '---\ntags: &tags [one, two]\nmore: *tags\n---\nBody.';
    expect(extractFrontmatter(text)).toEqual({
      data: { tags: ['one', 'two'], more: ['one', 'two'] },
      content: 'Body.',
    });
  });

  it('keeps many small aliases when their expanded graph fits', () => {
    const text = `---\ndefaults: &d {a: 1}\n${Array.from({ length: 150 }, (_, i) => `p${i}: *d`).join('\n')}\n---\nBody.`;
    expect(extractFrontmatter(text).data?.p149).toEqual({ a: 1 });
  });

  it('rejects complex set keys before converting alias graphs to strings', () => {
    const levels = ['a0: &a0 [one, two]'];
    for (let i = 1; i <= 5; i++)
      levels.push(
        `a${i}: &a${i} [${Array(8)
          .fill(`*a${i - 1}`)
          .join(', ')}]`,
      );
    const text = `---\n${levels.join('\n')}\ns: !!set\n  ? *a5\n---\nBody.`;
    // Array string conversion recursively expands aliases before the graph budget runs.
    const conversion = vi.spyOn(Array.prototype, 'toString');
    let calls: number;
    let result: ReturnType<typeof extractFrontmatter>;
    try {
      result = extractFrontmatter(text);
      calls = conversion.mock.calls.length;
    } finally {
      conversion.mockRestore();
    }
    expect(result).toEqual({ data: null, content: text });
    expect(calls).toBe(0);
  });

  it('keeps cyclic alias graphs as raw frontmatter', () => {
    const text = '---\ncycle: &cycle [*cycle]\n---\nBody.';
    expect(extractFrontmatter(text)).toEqual({ data: null, content: text });
  });

  it('bounds expanded alias work rather than only counting alias tokens', () => {
    const levels = ['a: &a [one, two]'];
    for (const [previous, next] of [
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'd'],
      ['d', 'e'],
      ['e', 'f'],
    ]) {
      levels.push(`${next}: &${next} [${Array(8).fill(`*${previous}`).join(', ')}]`);
    }
    const text = `---\n${levels.join('\n')}\n---\nBody.`;
    expect(extractFrontmatter(text)).toEqual({ data: null, content: text });
  });

  it('counts repeated scalar text toward the preview budget', () => {
    const text = `---\ntext: &text ${'x'.repeat(10_000)}\ncopies: [${Array(20).fill('*text').join(', ')}]\n---\nBody.`;
    expect(extractFrontmatter(text)).toEqual({ data: null, content: text });
  });

  it('bounds expanded depth even when the YAML syntax stays shallow', () => {
    const levels = ['a0: &a0 {value: one}'];
    for (let i = 1; i <= 60; i++) levels.push(`a${i}: &a${i} {wrap: {wrap: *a${i - 1}}}`);
    const text = `---\n${levels.join('\n')}\n---\nBody.`;
    expect(extractFrontmatter(text)).toEqual({ data: null, content: text });
  });

  it('keeps oversized frontmatter as raw text', () => {
    const text = `---\nvalue: ${'x'.repeat(100_001)}\n---\nBody.`;
    expect(extractFrontmatter(text)).toEqual({ data: null, content: text });
  });

  it('parses a !!set as an object whose keys map to null', () => {
    const text = '---\ntags: !!set {x, __proto__, 1}\ntitle: Old\n---\n';
    const data = extractFrontmatter(text).data;
    // JSON.parse, because a __proto__ key in an object literal sets the prototype.
    expect(data).toEqual(JSON.parse('{"tags":{"1":null,"x":null,"__proto__":null},"title":"Old"}'));
    expect(Object.keys(data?.tags ?? {})).toEqual(['1', 'x', '__proto__']);
  });

  it('falls back to the original text when a !!set entry has a value', () => {
    const text = '---\ns: !!set {x: 1}\n---\nBody.';
    expect(extractFrontmatter(text)).toEqual({ data: null, content: text });
  });

  it('falls back to the original text when the block holds several YAML documents', () => {
    const text = '---\na: 1\n...\nb: 2\n---\nBody.';
    expect(extractFrontmatter(text)).toEqual({ data: null, content: text });
  });

  it('returns empty content when the body is empty', () => {
    const text = '---\ntitle: X\n---\n';
    expect(extractFrontmatter(text)).toEqual({ data: { title: 'X' }, content: '' });
  });
});

describe('getFrontmatterLines', () => {
  it('returns an empty array when there is no frontmatter', () => {
    expect(getFrontmatterLines('# Hello\n\nBody.')).toEqual([]);
  });

  it('returns the delimiter and body lines of the frontmatter block', () => {
    const text = '---\ntitle: Hello\npublished: true\n---\nBody text.';
    expect(getFrontmatterLines(text)).toEqual(['---', 'title: Hello', 'published: true', '---']);
  });

  it('includes both delimiters for empty frontmatter', () => {
    expect(getFrontmatterLines('---\n---\nBody.')).toEqual(['---', '---']);
  });

  it('handles frontmatter at end of file without a trailing newline', () => {
    expect(getFrontmatterLines('---\ntitle: X\n---')).toEqual(['---', 'title: X', '---']);
  });

  it('strips carriage returns from CRLF frontmatter', () => {
    const text = '---\r\ntitle: X\r\n---\r\nBody.';
    expect(getFrontmatterLines(text)).toEqual(['---', 'title: X', '---']);
  });
});
