import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WordHighlightProvider } from '../contexts/WordHighlightContext';

import { DiffCodeLine } from './DiffCodeLine';

describe('DiffCodeLine', () => {
  it.each([
    ['add', '+'],
    ['delete', '-'],
  ] as const)('keeps the %s prefix out of copied text', (type, prefix) => {
    render(
      <WordHighlightProvider>
        <DiffCodeLine
          line={{ type, content: 'const value = 1;', oldLineNumber: 1, newLineNumber: 1 }}
        />
      </WordHighlightProvider>,
    );

    expect(screen.getByText(prefix)).toHaveClass('select-none');
  });
});

describe('DiffCodeLine bidi controls', () => {
  // The Trojan Source repro: displays as `if (accessLevel != "user") { // Check if admin`.
  const content = 'if (accessLevel != "user\u202E \u2066// Check if admin\u2069 \u2066") {';
  const markers = (container: HTMLElement) =>
    [...container.querySelectorAll('.bidi-control')].map((el) => el.getAttribute('data-codepoint'));

  it.each([
    ['syntax tokens', undefined],
    [
      'word-diff segments',
      [
        { type: 'unchanged' as const, value: 'if (accessLevel != ' },
        { type: 'added' as const, value: content.slice('if (accessLevel != '.length) },
      ],
    ],
  ])('marks each control in %s and copies the original line', (_path, diffSegments) => {
    const { container } = render(
      <WordHighlightProvider>
        <DiffCodeLine
          line={{ type: 'add', content, newLineNumber: 1 }}
          filename="check.js"
          diffSegments={diffSegments}
        />
      </WordHighlightProvider>,
    );

    expect(markers(container)).toEqual(['U+202E', 'U+2066', 'U+2069', 'U+2066']);
    // A selection copy takes the text nodes, so the code cell's text is what a copy yields.
    expect(container.querySelector('.select-text')?.textContent).toBe(content);
  });
});
