import { lstatSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const claudeReject = join(root, 'skills/gavel/references/reject.md');
const codexReject = join(root, '.codex/skills/gavel/references/reject.md');

describe('gavel skills', () => {
  // Codex's skill installer copies .codex/skills/gavel by itself, so a symlink out of that
  // directory arrives broken; the Codex skill keeps its own copy of the Reject steps instead.
  it('give Codex its own copy of the Reject steps', () => {
    expect(lstatSync(codexReject).isSymbolicLink()).toBe(false);
  });

  it('give Claude Code and Codex the same Reject steps', () => {
    expect(readFileSync(codexReject, 'utf8')).toBe(readFileSync(claudeReject, 'utf8'));
  });
});
