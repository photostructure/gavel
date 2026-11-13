import { inflateSync } from 'node:zlib';

/** One `literal` or `delta` block of a `GIT binary patch`, inflated. */
interface BinaryHunk {
  kind: 'literal' | 'delta';
  data: Buffer;
}

const BASE85 =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{|}~';
const BASE85_VALUES = new Map(BASE85.split('').map((character, value) => [character, value]));

/** Git's base85 line: a length character (A–Z = 1–26, a–z = 27–52), then 5 characters per 4 bytes. */
function decodeBase85Line(line: string): Buffer {
  const code = line.charCodeAt(0);
  const length =
    code >= 65 && code <= 90 ? code - 64 : code >= 97 && code <= 122 ? code - 96 + 26 : 0;
  const encoded = line.slice(1);
  if (length === 0 || encoded.length !== Math.ceil(length / 4) * 5)
    throw new Error('Malformed binary patch line');
  const bytes = Buffer.alloc(Math.ceil(length / 4) * 4);
  for (let group = 0; group < encoded.length / 5; group++) {
    let value = 0;
    for (const character of encoded.slice(group * 5, group * 5 + 5)) {
      const digit = BASE85_VALUES.get(character);
      if (digit === undefined) throw new Error('Malformed binary patch line');
      value = value * 85 + digit;
    }
    if (value > 0xffffffff) throw new Error('Malformed binary patch line');
    bytes.writeUInt32BE(value, group * 4);
  }
  return bytes.subarray(0, length);
}

/**
 * The forward hunk of a `GIT binary patch` block: the first `literal` or `delta` block, which
 * builds the new side. `lines` starts on the line after `GIT binary patch`.
 */
export function forwardBinaryHunk(lines: string[]): BinaryHunk {
  const match = lines[0]?.match(/^(literal|delta) (\d+)$/);
  if (!match?.[1] || !match[2]) throw new Error('Malformed binary patch');
  const kind = match[1] as BinaryHunk['kind'];
  const size = Number(match[2]);
  const parts: Buffer[] = [];
  for (const line of lines.slice(1)) {
    if (line === '') break;
    parts.push(decodeBase85Line(line));
  }
  const data = inflateSync(Buffer.concat(parts));
  if (data.length !== size) throw new Error('Binary patch size does not match its contents');
  return { kind, data };
}

/** Rebuild a file from its base and a Git delta (the format of a pack's deltified objects). */
export function applyGitDelta(base: Buffer, delta: Buffer): Buffer {
  let position = 0;
  const readSize = (): number => {
    let value = 0;
    let scale = 1;
    let byte: number;
    do {
      byte = delta.readUInt8(position++);
      value += (byte & 0x7f) * scale;
      scale *= 128;
    } while (byte & 0x80);
    return value;
  };
  if (readSize() !== base.length) throw new Error('Binary delta does not match its base');
  const result = Buffer.alloc(readSize());
  let written = 0;
  while (position < delta.length) {
    const opcode = delta.readUInt8(position++);
    if (opcode & 0x80) {
      let offset = 0;
      for (let i = 0; i < 4; i++)
        if (opcode & (1 << i)) offset += delta.readUInt8(position++) * 2 ** (8 * i);
      let length = 0;
      for (let i = 0; i < 3; i++)
        if (opcode & (0x10 << i)) length += delta.readUInt8(position++) * 2 ** (8 * i);
      if (length === 0) length = 0x10000;
      if (offset + length > base.length || written + length > result.length)
        throw new Error('Binary delta copies outside its base or result');
      written += base.copy(result, written, offset, offset + length);
    } else if (opcode !== 0) {
      if (position + opcode > delta.length || written + opcode > result.length)
        throw new Error('Binary delta inserts outside its result');
      written += delta.copy(result, written, position, position + opcode);
      position += opcode;
    } else {
      throw new Error('Binary delta has a reserved opcode');
    }
  }
  if (written !== result.length) throw new Error('Binary delta result has the wrong size');
  return result;
}
