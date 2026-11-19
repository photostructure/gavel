import { describe, expect, it, vi } from 'vitest';

import { localControlPath } from './local-control.js';

vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  userInfo: () => {
    throw new Error('uv_os_get_passwd returned ENOENT');
  },
}));

describe('local control addresses', () => {
  // Ground truth: unshare -U --map-user=54321 node -e "console.log(process.getuid()); require('node:os').userInfo()"
  it.skipIf(process.platform === 'win32')('works for a numeric UID with no passwd entry', () => {
    const id = '12345678-1234-1234-1234-123456789abc';
    expect(localControlPath(id)).toBe(`/tmp/gavel-${process.getuid!()}-control/${id}.sock`);
  });
});
