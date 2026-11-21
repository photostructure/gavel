import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'global.css'), 'utf8');

describe('global.css', () => {
  // Every word of a syntax-highlighted line is a .word-token, and WebKit updates every
  // positioned element inside the diff scroller on each scroll step.
  it('leaves word tokens unpositioned', () => {
    const rule = /\.word-token\s*\{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    expect(rule![1]).not.toMatch(/position\s*:/);
  });
});
