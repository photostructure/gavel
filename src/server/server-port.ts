import { createHash } from 'node:crypto';

// Ports a server picks for itself. They stay below the ports Linux hands out on its own
// (32768-60999), so a port the OS gave another program rarely takes one, and above 10080, the
// last port browsers refuse to load (the Fetch standard's "bad ports").
const FIRST = 10081;
const LAST = 32767;

/**
 * The port a server tries first, hashed from its agent session and repository, or its repository
 * alone without a session. A browser keeps a review's unsent changes and drafts per address, so a
 * server the same session restarts for a repository gets its open pages back, and a server for
 * another session or repository rarely lands on the address of one that stopped.
 */
export function firstPort(seed: string): number {
  const hash = createHash('sha256').update(seed).digest();
  return FIRST + (hash.readUInt32BE(0) % (LAST - FIRST + 1));
}

/** The port to try after `port` is busy, wrapping from the top of the range to its bottom. */
export function nextPort(port: number): number {
  return port === LAST ? FIRST : port + 1;
}
