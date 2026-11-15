import { describe, expect, it } from 'vitest';

import { firstPort, nextPort } from './server-port';

describe('firstPort', () => {
  // Expected values: node -e 'const h=require("node:crypto").createHash("sha256").update(SEED).digest();
  // console.log(10081 + h.readUInt32BE(0) % 22687)'
  it('hashes a seed to the same port in 10081-32767 on every launch', () => {
    expect(firstPort('897a40b9-bf98-46a6-b4c7-10e4128fe8fe')).toBe(13490);
    expect(firstPort('/home/user/src/repo')).toBe(21974);
  });

  it('stays in 10081-32767 for any seed', () => {
    for (let i = 0; i < 1000; i++) {
      const port = firstPort(`seed-${i}`);
      expect(port).toBeGreaterThanOrEqual(10081);
      expect(port).toBeLessThanOrEqual(32767);
    }
  });
});

describe('nextPort', () => {
  it('steps up one port', () => {
    expect(nextPort(4966)).toBe(4967);
    expect(nextPort(13490)).toBe(13491);
  });

  // Above 32767 lie the ports the OS hands out on its own; 10080 is the last port browsers refuse.
  it('wraps from the top of the range to its bottom, past 10080', () => {
    expect(nextPort(32767)).toBe(10081);
  });
});
