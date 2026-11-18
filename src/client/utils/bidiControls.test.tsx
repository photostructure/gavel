import { render } from '@testing-library/react';
import ReactMarkdown from 'react-markdown';
import { describe, expect, it } from 'vitest';

import { rehypeBidiControls, renderBidiText, splitBidiControls } from './bidiControls';

// The Trojan Source repro: displays as `if (accessLevel != "user") { // Check if admin`.
const TROJAN_LINE = 'if (accessLevel != "user\u202E \u2066// Check if admin\u2069 \u2066") {';

const markers = (container: HTMLElement) =>
  [...container.querySelectorAll('.bidi-control')].map((el) => el.getAttribute('data-codepoint'));

describe('splitBidiControls', () => {
  it.each([
    ...[0x202a, 0x202b, 0x202c, 0x202d, 0x202e],
    ...[0x2066, 0x2067, 0x2068, 0x2069],
    ...[0x200e, 0x200f, 0x061c],
  ])('marks U+%s', (codepoint) => {
    const char = String.fromCodePoint(codepoint);
    const label = `U+${codepoint.toString(16).toUpperCase().padStart(4, '0')}`;

    expect(splitBidiControls(`a${char}b`)).toEqual(['a', { char, codepoint: label }, 'b']);
  });

  it('leaves text without bidi controls whole', () => {
    expect(splitBidiControls('const x = "שלום";')).toEqual(['const x = "שלום";']);
  });

  it('marks adjacent controls without empty text between them', () => {
    expect(splitBidiControls('\u202E\u2066')).toEqual([
      { char: '\u202E', codepoint: 'U+202E' },
      { char: '\u2066', codepoint: 'U+2066' },
    ]);
  });
});

describe('renderBidiText', () => {
  it('wraps each control in a marker and keeps the original characters as text', () => {
    const { container } = render(<span>{renderBidiText(TROJAN_LINE)}</span>);

    expect(markers(container)).toEqual(['U+202E', 'U+2066', 'U+2069', 'U+2066']);
    expect(container.textContent).toBe(TROJAN_LINE);
  });
});

describe('rehypeBidiControls', () => {
  it('marks controls in Markdown text, inline code, and link text', () => {
    const { container } = render(
      <ReactMarkdown rehypePlugins={[rehypeBidiControls]}>
        {'a\u202Eb `c\u2066d` [e\u2069f](https://example.com)'}
      </ReactMarkdown>,
    );

    expect(markers(container)).toEqual(['U+202E', 'U+2066', 'U+2069']);
    expect(container.textContent).toBe('a\u202Eb c\u2066d e\u2069f');
  });
});
