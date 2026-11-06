import { describe, it, expect } from 'vitest';

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
