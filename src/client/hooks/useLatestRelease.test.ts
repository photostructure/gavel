import { describe, expect, it } from 'vitest';

import { isNewerRelease } from './useLatestRelease';

describe('isNewerRelease', () => {
  it.each([
    ['6.10.0', '6.9.0', true],
    ['6.0.10', '6.0.9', true],
    ['7.0.0', '6.99.99', true],
    ['6.0.0', '6.0.0', false],
    ['6.9.0', '6.10.0', false],
    ['5.99.99', '6.0.0', false],
  ])('says whether %s is newer than %s, comparing each part as a number', (a, b, newer) => {
    expect(isNewerRelease(a, b)).toBe(newer);
  });

  it('throws on a version that is not x.y.z', () => {
    expect(() => isNewerRelease('6.1.0-beta.1', '6.0.0')).toThrow('Not an x.y.z release version');
  });
});
