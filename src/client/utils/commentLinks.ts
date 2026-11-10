import type { DiffSide, LineNumber } from '../../types/diff';
import { EDITOR_SESSION_FRAGMENT_KEY } from '../../utils/editorOptions';

// Links in comment bodies that move around gavel: the query names a named review
// (`?review=api-split`), and the fragment names a place in the review (`#thread=tour-2`,
// `#file=src/parse.ts&line=40-52&side=old`). The page URL uses the same form, so a
// copied URL opens the same place.

export type CommentLinkPlace =
  | { kind: 'thread'; threadId: string }
  | { kind: 'file'; filePath: string; side: DiffSide; line?: LineNumber };

export interface CommentLink {
  review?: string;
  place?: CommentLinkPlace;
}

const PLACE_KEYS = ['thread', 'file', 'line', 'side'] as const;
// Errors reach the reader, who did not write the link, as the notice text.
const CANNOT = "Can't follow this link:";
const NO_FILE = `${CANNOT} it gives a line or side but no file.`;
const LINE_PATTERN = /^(\d+)(?:-(\d+))?$/;

function parseLine(value: string): LineNumber | null {
  const match = LINE_PATTERN.exec(value);
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] === undefined ? start : Number(match[2]);
  // Number() reads a long run of digits as Infinity, or rounds it past 2^53 - 1.
  if (!Number.isSafeInteger(end) || start < 1 || end < start) return null;
  return start === end ? start : [start, end];
}

function parsePlace(fragment: string): CommentLinkPlace | { error: string } | null {
  // A bare `#file` or `#thread` is an ordinary heading anchor.
  if (!fragment.includes('=')) return null;
  const params = new URLSearchParams(fragment);
  if (!PLACE_KEYS.some((key) => params.has(key))) return null;
  for (const key of params.keys()) {
    if (key !== EDITOR_SESSION_FRAGMENT_KEY && !(PLACE_KEYS as readonly string[]).includes(key))
      return { error: `${CANNOT} it has an unknown part, "${key}".` };
  }
  const thread = params.get('thread');
  const file = params.get('file');
  const line = params.get('line');
  const side = params.get('side');
  if (thread !== null && file !== null)
    return { error: `${CANNOT} it names both a comment and a file.` };
  if (thread !== null) {
    if (!thread) return { error: `${CANNOT} it names no comment.` };
    if (line !== null || side !== null) return { error: NO_FILE };
    return { kind: 'thread', threadId: thread };
  }
  if (file === null) return { error: NO_FILE };
  if (!file) return { error: `${CANNOT} it names no file.` };
  if (side !== null && side !== 'old' && side !== 'new')
    return { error: `${CANNOT} its side, "${side}", is neither old nor new.` };
  const place: CommentLinkPlace = { kind: 'file', filePath: file, side: side ?? 'new' };
  if (line === null) return place;
  const lineNumber = parseLine(line);
  if (lineNumber === null)
    return { error: `${CANNOT} "${line}" is not a line number like 40 or a range like 40-52.` };
  return { ...place, line: lineNumber };
}

/**
 * Reads a gavel link from an href. Returns null for any other href (an external URL,
 * a plain `#heading`), and an error for a gavel link it cannot follow.
 */
export function parseCommentLink(href: string): CommentLink | { error: string } | null {
  if (href.startsWith('#')) {
    const place = parsePlace(href.slice(1));
    if (place === null || 'error' in place) return place;
    return { place };
  }
  if (!href.startsWith('?')) return null;
  const hashIndex = href.indexOf('#');
  const query = new URLSearchParams(href.slice(1, hashIndex === -1 ? undefined : hashIndex));
  const review = query.get('review');
  if (review === null) return null;
  if (!review) return { error: `${CANNOT} it names no review.` };
  const place = hashIndex === -1 ? null : parsePlace(href.slice(hashIndex + 1));
  if (place === null) return { review };
  if ('error' in place) return place;
  return { review, place };
}

/** A fragment (with its `#`, or empty) naming `place`, keeping only the editor token of `hash`. */
export function withLinkPlace(hash: string, place: CommentLinkPlace | undefined): string {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get(EDITOR_SESSION_FRAGMENT_KEY);
  const params = new URLSearchParams();
  if (token !== null) params.set(EDITOR_SESSION_FRAGMENT_KEY, token);
  if (place?.kind === 'thread') params.set('thread', place.threadId);
  if (place?.kind === 'file') {
    params.set('file', place.filePath);
    if (place.line !== undefined)
      params.set(
        'line',
        typeof place.line === 'number' ? String(place.line) : `${place.line[0]}-${place.line[1]}`,
      );
    if (place.side === 'old') params.set('side', 'old');
  }
  // Fragments allow a literal slash, so a copied URL shows paths the way links write them.
  const fragment = params.toString().replaceAll('%2F', '/');
  return fragment ? `#${fragment}` : '';
}

/** `hash` without a comment link's place; any other fragment stays as it is. */
export function withoutLinkPlace(hash: string): string {
  // As in parsePlace, a bare `#file` or `#thread` is a heading anchor.
  if (!hash.includes('=')) return hash;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (!PLACE_KEYS.some((key) => params.has(key))) return hash;
  for (const key of PLACE_KEYS) params.delete(key);
  const fragment = params.toString().replaceAll('%2F', '/');
  return fragment ? `#${fragment}` : '';
}
