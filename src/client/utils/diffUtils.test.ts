import { describe, expect, it } from 'vitest';

import { isLargeDiffFile } from './diffUtils';

describe('isLargeDiffFile', () => {
  it('counts added and deleted lines, and calls a file large past 1024 of them', () => {
    expect(isLargeDiffFile({ additions: 1024, deletions: 0 })).toBe(false);
    expect(isLargeDiffFile({ additions: 1025, deletions: 0 })).toBe(true);
    expect(isLargeDiffFile({ additions: 600, deletions: 425 })).toBe(true);
  });
});
