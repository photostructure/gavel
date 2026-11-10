import { describe, expect, it } from 'vitest';

import { parseCommentLink, withLinkPlace, withoutLinkPlace } from './commentLinks';

describe('parseCommentLink', () => {
  it('reads a thread in the same review', () => {
    expect(parseCommentLink('#thread=tour-2')).toEqual({
      place: { kind: 'thread', threadId: 'tour-2' },
    });
  });

  it('reads a file, a line, and a range, with new as the default side', () => {
    expect(parseCommentLink('#file=src/parse.ts')).toEqual({
      place: { kind: 'file', filePath: 'src/parse.ts', side: 'new' },
    });
    expect(parseCommentLink('#file=src/parse.ts&line=40')).toEqual({
      place: { kind: 'file', filePath: 'src/parse.ts', side: 'new', line: 40 },
    });
    expect(parseCommentLink('#file=src/parse.ts&line=40-52&side=old')).toEqual({
      place: { kind: 'file', filePath: 'src/parse.ts', side: 'old', line: [40, 52] },
    });
    expect(parseCommentLink('#file=a.ts&line=7-7')).toEqual({
      place: { kind: 'file', filePath: 'a.ts', side: 'new', line: 7 },
    });
    // Any range of real line numbers stays a link, however large: it opens the hidden context
    // it covers, as Expand all lines does.
    expect(parseCommentLink(`#file=a.ts&line=1-${Number.MAX_SAFE_INTEGER}`)).toEqual({
      place: { kind: 'file', filePath: 'a.ts', side: 'new', line: [1, Number.MAX_SAFE_INTEGER] },
    });
  });

  it('decodes percent-encoded paths', () => {
    expect(parseCommentLink('#file=src/c%2B%2B/a%26b.cc')).toEqual({
      place: { kind: 'file', filePath: 'src/c++/a&b.cc', side: 'new' },
    });
  });

  it('reads another review, with or without a place in it', () => {
    expect(parseCommentLink('?review=api-split')).toEqual({ review: 'api-split' });
    expect(parseCommentLink('?review=api-split#thread=tour-1')).toEqual({
      review: 'api-split',
      place: { kind: 'thread', threadId: 'tour-1' },
    });
  });

  it('ignores the editor token that the launch URL carries in the fragment', () => {
    expect(parseCommentLink('#gavel-editor-token=abc&thread=tour-2')).toEqual({
      place: { kind: 'thread', threadId: 'tour-2' },
    });
    expect(parseCommentLink('#gavel-editor-token=abc')).toBeNull();
  });

  it('leaves links that are not gavel links alone', () => {
    for (const href of [
      'https://example.com/#thread=x',
      '#heading',
      '#file',
      '#thread',
      '/docs',
      '?base=main',
      '',
    ]) {
      expect(parseCommentLink(href)).toBeNull();
    }
  });

  it.each([
    ['#thread=a&file=b.ts', "Can't follow this link: it names both a comment and a file."],
    ['#thread=', "Can't follow this link: it names no comment."],
    ['#file=', "Can't follow this link: it names no file."],
    ['#thread=a&line=3', "Can't follow this link: it gives a line or side but no file."],
    ['#line=3', "Can't follow this link: it gives a line or side but no file."],
    [
      '#file=a.ts&line=0',
      `Can't follow this link: "0" is not a line number like 40 or a range like 40-52.`,
    ],
    [
      '#file=a.ts&line=9-3',
      `Can't follow this link: "9-3" is not a line number like 40 or a range like 40-52.`,
    ],
    [
      '#file=a.ts&line=x',
      `Can't follow this link: "x" is not a line number like 40 or a range like 40-52.`,
    ],
    // Number() reads 400 nines as Infinity, and loses precision past 2^53 - 1.
    [
      `#file=a.ts&line=1-${'9'.repeat(400)}`,
      `Can't follow this link: "1-${'9'.repeat(400)}" is not a line number like 40 or a range like 40-52.`,
    ],
    [
      '#file=a.ts&line=9007199254740993',
      `Can't follow this link: "9007199254740993" is not a line number like 40 or a range like 40-52.`,
    ],
    ['#file=a.ts&side=left', `Can't follow this link: its side, "left", is neither old nor new.`],
    ['#file=a.ts&lines=3', `Can't follow this link: it has an unknown part, "lines".`],
    ['?review=', "Can't follow this link: it names no review."],
    ['?review=a#line=2', "Can't follow this link: it gives a line or side but no file."],
  ])('reports a malformed link %s', (href, error) => {
    expect(parseCommentLink(href)).toEqual({ error });
  });
});

describe('withLinkPlace', () => {
  it('replaces the place and keeps the editor token', () => {
    expect(
      withLinkPlace('#gavel-editor-token=abc&file=a.ts&line=3', {
        kind: 'thread',
        threadId: 'tour-2',
      }),
    ).toBe('#gavel-editor-token=abc&thread=tour-2');
  });

  it('writes a file place that reads back the same', () => {
    const place = {
      kind: 'file' as const,
      filePath: 'src/c++/a b.cc',
      side: 'old' as const,
      line: [4, 9] as [number, number],
    };
    expect(parseCommentLink(withLinkPlace('', place))).toEqual({ place });
  });

  it('drops a plain heading anchor, and writes paths with their slashes', () => {
    expect(
      withLinkPlace('#summary', { kind: 'file', filePath: 'src/a b.ts', side: 'new', line: 3 }),
    ).toBe('#file=src/a+b.ts&line=3');
  });

  it('drops the place and leaves an empty fragment empty', () => {
    expect(withLinkPlace('#thread=tour-2', undefined)).toBe('');
  });
});

describe('withoutLinkPlace', () => {
  it('removes only the place', () => {
    expect(withoutLinkPlace('#gavel-editor-token=k&file=a/b.ts&line=3')).toBe(
      '#gavel-editor-token=k',
    );
    expect(withoutLinkPlace('#thread=t1')).toBe('');
  });

  it('leaves other fragments untouched', () => {
    for (const hash of ['#summary', '#file', '#editor-session=token', '']) {
      expect(withoutLinkPlace(hash)).toBe(hash);
    }
  });
});
