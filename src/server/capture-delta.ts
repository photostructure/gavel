import type { CaptureDelta, FileDelta } from '../types/diff.js';

import { parsePatch } from './review-capture.js';

/**
 * A hunk's raw lines, final-newline marker included, and its header's context text, without
 * the line numbers a rebase shifts.
 */
function hunkText(raw: string): string {
  return raw.replace(/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/, '@@');
}

type PatchFile = ReturnType<typeof parsePatch>[number];

function headerText(file: PatchFile): string {
  return file.hunks.length === 0
    ? file.raw
    : file.header.replace(/^(?:index .*|(?:dis)?similarity index \d+%)\n/gm, '');
}

/** Per path, how often each hunk text and each header text occurs across the path's records. */
function countByPath(files: PatchFile[]) {
  const byPath = new Map<string, { hunks: Map<string, number>; headers: Map<string, number> }>();
  const add = (counts: Map<string, number>, text: string) =>
    counts.set(text, (counts.get(text) ?? 0) + 1);
  for (const file of files) {
    const counts = byPath.get(file.path) ?? {
      hunks: new Map<string, number>(),
      headers: new Map<string, number>(),
    };
    byPath.set(file.path, counts);
    for (const hunk of file.hunks) add(counts.hunks, hunkText(hunk.raw));
    add(counts.headers, headerText(file));
  }
  return byPath;
}

/**
 * Compares two patches path by path. Git can write two records for one path (a typechange), so
 * a path's hunks are compared across all its records. Each earlier occurrence accounts for at
 * most one current one, so when a hunk or header occurs more often than before, every copy counts
 * as changed: which copy is new cannot be told.
 */
export function captureDelta(previousPatch: string, currentPatch: string): CaptureDelta {
  const previous = countByPath(parsePatch(previousPatch));
  const currentFiles = parsePatch(currentPatch);
  const current = countByPath(currentFiles);
  const lastRecord = new Map(currentFiles.map((file) => [file.path, file]));
  const empty = { hunks: new Map<string, number>(), headers: new Map<string, number>() };
  const kept = (now: Map<string, number>, before: Map<string, number>, text: string) =>
    (now.get(text) ?? 0) <= (before.get(text) ?? 0);
  const files = currentFiles.map((file): FileDelta => {
    const now = current.get(file.path) ?? empty;
    const before = previous.get(file.path) ?? empty;
    let removedHunks = 0;
    if (lastRecord.get(file.path) === file)
      for (const [text, count] of before.hunks)
        removedHunks += Math.max(0, count - (now.hunks.get(text) ?? 0));
    return {
      path: file.path,
      unchanged: file.hunks.map((hunk) => kept(now.hunks, before.hunks, hunkText(hunk.raw))),
      headerUnchanged: kept(now.headers, before.headers, headerText(file)),
      removedHunks,
    };
  });
  return {
    files,
    removedPaths: [...previous.keys()].filter((path) => !current.has(path)),
  };
}
