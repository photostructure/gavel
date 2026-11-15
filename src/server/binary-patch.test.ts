import { deflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { applyGitDelta, forwardBinaryHunk } from './binary-patch.js';

const BLOB_LIMIT = 64 * 1024 * 1024;
const BASE85 =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{|}~';

// Encode the zlib bytes in Git's base85 transport, independently of the decoder.
function literal(bytes: Buffer, declaredSize = bytes.length): string[] {
  const compressed = deflateSync(bytes);
  const lines = [`literal ${declaredSize}`];
  for (let offset = 0; offset < compressed.length; offset += 52) {
    const chunk = compressed.subarray(offset, offset + 52);
    let line = String.fromCharCode(chunk.length <= 26 ? 64 + chunk.length : 70 + chunk.length);
    for (let group = 0; group < chunk.length; group += 4) {
      const word = Buffer.alloc(4);
      chunk.copy(word, 0, group, group + 4);
      const value = word.readUInt32BE();
      for (let power = 4; power >= 0; power--) line += BASE85[Math.floor(value / 85 ** power) % 85];
    }
    lines.push(line);
  }
  return [...lines, ''];
}

function size(value: number): number[] {
  const bytes: number[] = [];
  do {
    const byte = value % 128;
    value = Math.floor(value / 128);
    bytes.push(byte | (value ? 0x80 : 0));
  } while (value);
  return bytes;
}

describe('binary patch expansion limits', () => {
  it('preserves a valid literal and delta', () => {
    expect(forwardBinaryHunk(literal(Buffer.from('hello'))).data).toEqual(Buffer.from('hello'));
    expect(applyGitDelta(Buffer.alloc(0), Buffer.from([0, 3, 3, 1, 2, 3]))).toEqual(
      Buffer.from([1, 2, 3]),
    );
  });

  it('rejects an excessive declared literal before inflating it', () => {
    expect(() => forwardBinaryHunk(literal(Buffer.alloc(0), BLOB_LIMIT + 1))).toThrow('64 MiB');
  });

  it('bounds actual inflation even when the declared size is small', () => {
    const lines = literal(Buffer.alloc(BLOB_LIMIT + 1), 1);
    expect(() => forwardBinaryHunk(lines)).toThrow(/64 MiB|larger than/);
  });

  it('rejects an excessive delta result before allocating it', () => {
    expect(() => applyGitDelta(Buffer.alloc(0), Buffer.from([0, ...size(BLOB_LIMIT + 1)]))).toThrow(
      '64 MiB',
    );
  });
});
