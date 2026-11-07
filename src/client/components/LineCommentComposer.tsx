import { useMemo } from 'react';

import type { DiffLine, DiffSide, LineNumber } from '../../types/diff';
import {
  draftKey,
  useCommentDraft,
  useLineDraftAnchors,
  type LineDraftAnchor,
} from '../hooks/useCommentDrafts';

import { CommentForm, type CommentSubmitOptions } from './CommentForm';
import type { AppearanceSettings } from './SettingsModal';

interface LineTarget {
  side: DiffSide;
  lineNumber: LineNumber;
}

export const lastLineOf = (lineNumber: LineNumber) =>
  Array.isArray(lineNumber) ? lineNumber[1] : lineNumber;

const numberOn = (line: DiffLine, side: DiffSide) =>
  side === 'old' ? line.oldLineNumber : line.newLineNumber;

const rangeOf = (lineNumber: LineNumber): [number, number] =>
  Array.isArray(lineNumber) ? lineNumber : [lineNumber, lineNumber];

// Whether the form for this target sits under this line: the line with the
// target's last number on its side. Deleted lines have no new number and added
// lines no old one, so unified and split view place a form the same way; in
// unified view an old-side target written in split view sits under the deleted
// or unchanged line with that old number.
export const lineShowsTarget = (line: DiffLine, target: LineTarget) =>
  numberOn(line, target.side) === lastLineOf(target.lineNumber);

const chunkShowsLine = (lines: DiffLine[], target: LineTarget) =>
  lines.some((line) => lineShowsTarget(line, target));

// The drafts no chunk shows: these sit at the top of their file, and DiffViewer
// expands the hidden context that holds them. A draft on a shown line never
// expands anything, so typing in it cannot move its form to another chunk.
export const anchorsNotShown = (
  anchors: LineDraftAnchor[],
  chunks: readonly { lines: DiffLine[] }[],
) => anchors.filter((anchor) => !chunks.some((chunk) => chunkShowsLine(chunk.lines, anchor)));

// "line 12", "lines 3–5", or "old line 12", for form titles.
export function describeLines({ side, lineNumber }: LineTarget): string {
  const lines = Array.isArray(lineNumber)
    ? `lines ${lineNumber[0]}–${lineNumber[1]}`
    : `line ${lineNumber}`;
  return side === 'old' ? `old ${lines}` : lines;
}

export function targetCovers(target: LineTarget, side: DiffSide, lineNumber: number) {
  const [start, end] = rangeOf(target.lineNumber);
  return target.side === side && lineNumber >= start && lineNumber <= end;
}

// Whether this line is one of the target's lines.
export function lineInTarget(line: DiffLine, target: LineTarget) {
  const number = numberOn(line, target.side);
  return number !== undefined && targetCovers(target, target.side, number);
}

// The code under the target, or undefined when these lines miss part of it (a
// range whose first lines were expanded context before a reload, say).
export function shownCodeFor(lines: DiffLine[], target: LineTarget): string | undefined {
  const [start, end] = rangeOf(target.lineNumber);
  const shown = lines.filter((line) => lineInTarget(line, target));
  return shown.length === end - start + 1
    ? shown.map((line) => line.content ?? '').join('\n')
    : undefined;
}

// The code of a line draft in the diff's files, whether or not the page has rendered
// the file yet: undefined when the file is not in the diff or its hunks miss part of
// the target. Whitespace-hidden chunks keep their full lines in snapshotLines.
export function codeInFiles(
  files: readonly {
    path: string;
    chunks: readonly { lines: DiffLine[]; snapshotLines?: DiffLine[] }[];
  }[],
  anchor: LineDraftAnchor,
): string | undefined {
  const file = files.find((candidate) => candidate.path === anchor.filePath);
  if (!file) return undefined;
  return shownCodeFor(
    file.chunks.flatMap((chunk) => chunk.snapshotLines ?? chunk.lines),
    anchor,
  );
}

// The forms a chunk shows: every saved line draft it draws, plus the form the
// reviewer just opened, which has no saved copy until the reviewer types or picks
// an intent.
export function useChunkComposers(
  filePath: string,
  lines: DiffLine[],
  opened: LineTarget | null,
): LineDraftAnchor[] {
  const saved = useLineDraftAnchors(filePath);
  return useMemo(() => {
    const anchors = saved.filter((anchor) => chunkShowsLine(lines, anchor));
    if (opened) {
      const anchor: LineDraftAnchor = { kind: 'line', filePath, ...opened };
      if (!anchors.some((other) => draftKey(other) === draftKey(anchor))) anchors.push(anchor);
    }
    return anchors;
  }, [saved, filePath, lines, opened]);
}

export const isComposerFor = (anchor: LineDraftAnchor, target: LineTarget | null) =>
  target !== null &&
  anchor.side === target.side &&
  JSON.stringify(anchor.lineNumber) === JSON.stringify(target.lineNumber);

interface LineCommentComposerProps {
  anchor: LineDraftAnchor;
  // The code under the target as the hunk shows it now (shownCodeFor), undefined
  // when the hunk misses part of the target. The form uses it when it is there, so
  // a draft carried into a later capture sends the current code; otherwise it uses
  // the code the draft saved with its first write.
  selectedCode?: string | undefined;
  syntaxTheme?: AppearanceSettings['syntaxTheme'];
  title?: string;
  // Only the form the reviewer just opened takes focus; a restored draft does not.
  autoFocus: boolean;
  onSubmit: (body: string, options: CommentSubmitOptions, code?: string) => Promise<void>;
  onClose: () => void;
  // When given, Escape in a form with text calls this and keeps the draft; without
  // it, Escape discards the draft like Cancel.
  onEscape?: () => void;
}

export function LineCommentComposer({
  anchor,
  selectedCode,
  syntaxTheme,
  title,
  autoFocus,
  onSubmit,
  onClose,
  onEscape,
}: LineCommentComposerProps) {
  const draft = useCommentDraft(anchor, undefined, selectedCode);
  const code = selectedCode ?? draft.savedCode;
  return (
    <CommentForm
      value={draft.body}
      onChange={draft.setBody}
      intentValue={draft.intent}
      onIntentChange={draft.setIntent}
      onSubmit={async (body, options) => {
        await onSubmit(body, options, code);
        draft.clear();
        onClose();
      }}
      onCancel={(text) => {
        // Cancel passes '', so only Escape in a form with text reaches onEscape.
        if (onEscape && text.trim()) {
          onEscape();
          return;
        }
        draft.clear();
        onClose();
      }}
      selectedCode={code}
      syntaxTheme={syntaxTheme}
      filename={anchor.filePath}
      title={title}
      autoFocus={autoFocus}
      draftKey={draft.key}
    />
  );
}
