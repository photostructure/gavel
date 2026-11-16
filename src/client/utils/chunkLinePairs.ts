import type { DiffLine } from '../../types/diff';

/** One row of the split view: the indices into the chunk's lines of its left and right cells. */
interface SplitRow {
  oldIndex: number | undefined;
  newIndex: number | undefined;
}

/**
 * Lays a chunk's lines out in split-view rows. An unchanged line fills both cells. A run of
 * deletions and the run of additions right after it share rows, the k-th deletion beside the
 * k-th addition. An addition with no deletion before it gets a row of its own.
 */
export function pairChangedLines(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line) {
      i++;
      continue;
    }

    if (line.type === 'normal') {
      rows.push({ oldIndex: i, newIndex: i });
      i++;
    } else if (line.type === 'delete') {
      let j = i + 1;
      while (j < lines.length && lines[j]?.type === 'delete') {
        j++;
      }
      const deleteStartIndex = i;
      const deleteCount = j - i;
      const addStartIndex = j;
      while (j < lines.length && lines[j]?.type === 'add') {
        j++;
      }
      const addCount = j - addStartIndex;

      for (let k = 0; k < Math.max(deleteCount, addCount); k++) {
        rows.push({
          oldIndex: k < deleteCount ? deleteStartIndex + k : undefined,
          newIndex: k < addCount ? addStartIndex + k : undefined,
        });
      }
      i = j;
    } else if (line.type === 'add') {
      rows.push({ oldIndex: undefined, newIndex: i });
      i++;
    }
  }
  return rows;
}
