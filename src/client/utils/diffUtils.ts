import { type DiffFile } from '../../types/diff';
export { getLanguageFromPath } from './languageDetection';

/**
 * A file with more changed lines than this starts collapsed. Rendering one of tens of thousands
 * of lines took seconds and slowed every later update of the page. Lines are counted, not their
 * length, so a smaller file of very long lines still renders open.
 */
export const LARGE_DIFF_CHANGED_LINES = 1024;

export function isLargeDiffFile(file: Pick<DiffFile, 'additions' | 'deletions'>): boolean {
  return file.additions + file.deletions > LARGE_DIFF_CHANGED_LINES;
}

/**
 * Generate SHA-256 hash of diff content
 */
export async function generateDiffHash(diffContent: string): Promise<string> {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(diffContent);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // Fallback to simple hash if crypto API is not available
    console.warn('Crypto API not available, using fallback hash');
    return simpleHash(diffContent);
  }
}

/**
 * Simple hash function as fallback
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16);
}

/**
 * Generate diff content string for hashing
 */
export function getDiffContentForHashing(file: DiffFile): string {
  // Create a stable string representation of the diff
  const chunks = file.chunks
    .map((chunk) => {
      const lines = chunk.lines
        .filter((line) => line.type !== 'hunk' && line.type !== 'header')
        .map((line) => `${line.type}:${line.content}`)
        .join('\n');
      return `${chunk.header}\n${lines}`;
    })
    .join('\n\n');

  return `${file.path}\n${file.status}\n${chunks}`;
}
