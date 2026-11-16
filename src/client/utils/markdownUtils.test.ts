import { describe, expect, it } from 'vitest';

import { isExternalUrl, isSafeUrl } from './markdownUtils';

describe('isSafeUrl', () => {
  it.each([
    'https://example.com/a',
    'HTTPS://example.com/a',
    'http://example.com/a',
    'mailto:someone@example.com',
    '#section',
    '/',
    '/docs/a.md',
    './docs/a.md',
    '../docs/a.md',
    '  /docs/a.md',
  ])('accepts %s', (url) => {
    expect(isSafeUrl(url)).toBe(true);
  });

  it.each([
    '//evil.example/x',
    '/\\evil.example/x',
    './/evil.example/x',
    '../\\evil.example/x',
    '  //evil.example/x',
    'javascript:alert(1)',
    'data:text/html,hi',
  ])('refuses %s', (url) => {
    expect(isSafeUrl(url)).toBe(false);
  });
});

describe('isExternalUrl', () => {
  it.each(['https://example.com', 'HTTPS://example.com', 'Http://example.com'])(
    'treats %s as external',
    (url) => {
      expect(isExternalUrl(url)).toBe(true);
    },
  );

  it.each(['/docs/a.md', './docs/a.md', '#section', 'mailto:someone@example.com'])(
    'treats %s as local',
    (url) => {
      expect(isExternalUrl(url)).toBe(false);
    },
  );
});
