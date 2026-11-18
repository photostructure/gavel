import type { ReactNode } from 'react';

// Unicode bidi controls: the embeddings and overrides U+202A–U+202E, the isolates
// U+2066–U+2069, and the marks LRM, RLM and ALM. Each reorders the text around it, so a
// line can display as different code from what it contains ("Trojan Source",
// CVE-2021-42574). The UI shows each one as a marker naming its code point.
const BIDI_CONTROLS = /([\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C])/;

interface BidiControl {
  char: string;
  /** The code point as `U+202E`. */
  codepoint: string;
}

/** Splits `text` into runs of plain text and the bidi controls between them. */
export function splitBidiControls(text: string): Array<string | BidiControl> {
  // A capturing split puts each control at an odd index.
  return text
    .split(BIDI_CONTROLS)
    .map((part, index) =>
      index % 2 === 0
        ? part
        : {
            char: part,
            codepoint: `U+${part.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`,
          },
    )
    .filter((part) => part !== '');
}

/**
 * `text` with each bidi control wrapped in a `.bidi-control` marker. The marker keeps the
 * character as its text, so a copy and `textContent` still give the original string.
 */
export function renderBidiText(text: string): ReactNode {
  return splitBidiControls(text).map((part, index) =>
    typeof part === 'string' ? (
      part
    ) : (
      <span key={index} className="bidi-control" data-codepoint={part.codepoint}>
        {part.char}
      </span>
    ),
  );
}

// The parts of a hast tree this plugin reads: text nodes and nodes with children.
interface HastNode {
  type: string;
  value?: string;
  children?: HastNode[];
}

function markHastBidiControls(node: HastNode): void {
  if (!node.children) return;
  node.children = node.children.flatMap((child): HastNode[] => {
    if (child.type !== 'text' || child.value === undefined) {
      markHastBidiControls(child);
      return [child];
    }
    return splitBidiControls(child.value).map((part) =>
      typeof part === 'string'
        ? { type: 'text', value: part }
        : {
            type: 'element',
            tagName: 'span',
            properties: { className: ['bidi-control'], dataCodepoint: part.codepoint },
            children: [{ type: 'text', value: part.char }],
          },
    );
  });
}

/** A rehype plugin for react-markdown that marks bidi controls as `renderBidiText` does. */
export function rehypeBidiControls() {
  return markHastBidiControls;
}
