type FrontmatterDiffStatus = 'added' | 'removed' | 'modified' | 'unchanged';

export type FrontmatterDiffEntry = {
  key: string;
  status: FrontmatterDiffStatus;
  oldValue: unknown;
  newValue: unknown;
};

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  const record = value as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const sorted: Record<string, unknown> = {};
  for (const k of sortedKeys) {
    sorted[k] = canonicalize(record[k]);
  }
  return sorted;
}

function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function computeFrontmatterDiff(
  oldData: Record<string, unknown> | null,
  newData: Record<string, unknown> | null,
): FrontmatterDiffEntry[] {
  if (newData === null) {
    if (oldData === null) {
      return [];
    }
    return Object.keys(oldData).map((key) => ({
      key,
      status: 'removed',
      oldValue: oldData[key],
      newValue: undefined,
    }));
  }

  if (oldData === null) {
    return Object.keys(newData).map((key) => ({
      key,
      status: 'added',
      oldValue: undefined,
      newValue: newData[key],
    }));
  }

  const entries: FrontmatterDiffEntry[] = [];

  for (const key of Object.keys(newData)) {
    if (!(key in oldData)) {
      entries.push({ key, status: 'added', oldValue: undefined, newValue: newData[key] });
      continue;
    }
    const oldValue = oldData[key];
    const newValue = newData[key];
    const status =
      canonicalStringify(oldValue) === canonicalStringify(newValue) ? 'unchanged' : 'modified';
    entries.push({ key, status, oldValue, newValue });
  }

  for (const key of Object.keys(oldData)) {
    if (!(key in newData)) {
      entries.push({ key, status: 'removed', oldValue: oldData[key], newValue: undefined });
    }
  }

  return entries;
}

// A plain, double-quoted, or single-quoted mapping key at column 0.
const KEY_LINE_PATTERN = /^(?:"([^"]*)"|'([^']*)'|([^\s#"'].*?))\s*:(?:\s|$)/;

/**
 * Returns the lines between the frontmatter delimiters that no changed key owns.
 * A key owns its `key:` line and the following lines that are indented or start
 * with `-` at column 0, which is how a sequence value may sit under its key. A
 * blank line or column-0 comment is always returned, without ending the key: a
 * block scalar or sequence can continue after one. A line the pattern cannot
 * attribute ends the key and is returned.
 */
function linesOutsideChangedKeys(frontmatterLines: string[], changedKeys: Set<string>): string[] {
  const lines: string[] = [];
  let inChangedKey = false;

  for (const line of frontmatterLines.slice(1, -1)) {
    if (line === '' || line.startsWith('#')) {
      lines.push(line);
      continue;
    }
    if (!/^[\s-]/.test(line)) {
      const match = KEY_LINE_PATTERN.exec(line);
      const key = match?.[1] ?? match?.[2] ?? match?.[3];
      inChangedKey = key !== undefined && changedKeys.has(key);
    }
    if (!inChangedKey) {
      lines.push(line);
    }
  }

  return lines;
}

/**
 * Whether the frontmatter table shows every changed frontmatter line, so the raw
 * lines can be hidden. Both arguments are `getFrontmatterLines` output, empty
 * for a side without frontmatter. Comments on a changed key's own lines are not
 * compared, so `title: Old # a` to `title: New # b` counts as accounted for.
 */
export function tableAccountsForFrontmatterEdit(
  baseLines: string[],
  targetLines: string[],
  entries: FrontmatterDiffEntry[],
): boolean {
  const changedKeys = new Set(
    entries.filter((entry) => entry.status !== 'unchanged').map((entry) => entry.key),
  );
  return (
    canonicalStringify(linesOutsideChangedKeys(baseLines, changedKeys)) ===
    canonicalStringify(linesOutsideChangedKeys(targetLines, changedKeys))
  );
}
