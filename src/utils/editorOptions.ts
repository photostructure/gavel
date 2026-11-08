export type EditorOptionId =
  | 'vscode'
  | 'cursor'
  | 'zed'
  | 'textmate'
  | 'bbedit'
  | 'emacs'
  | 'macvim'
  | 'sublime'
  | 'nova'
  | 'custom'
  | 'none';

interface EditorOption {
  readonly id: EditorOptionId;
  /**
   * Executable to run. Empty string for the `custom` placeholder (filled in by
   * server environment settings) and for `none` (open-in-editor disabled).
   */
  readonly command: string;
  /**
   * Whitespace-separated argument template. Supports the `%file` and `%line`
   * placeholders. Parsed just before spawning so quoted segments survive:
   * e.g. `'-l %line "%file"'`.
   */
  readonly argsTemplate: string;
}

export const CUSTOM_EDITOR_ID: EditorOptionId = 'custom';
export const NONE_EDITOR_ID: EditorOptionId = 'none';
export const DEFAULT_EDITOR_ID: EditorOptionId = 'vscode';
export const EDITOR_SESSION_FRAGMENT_KEY = 'gavel-editor-token';
export const EDITOR_SESSION_HEADER = 'X-Gavel-Editor-Token';

export const EDITOR_OPTIONS: readonly [EditorOption, ...EditorOption[]] = [
  {
    id: 'vscode',
    command: 'code',
    argsTemplate: '-g %file:%line',
  },
  {
    id: 'cursor',
    command: 'cursor',
    argsTemplate: '-g %file:%line',
  },
  {
    id: 'zed',
    command: 'zed',
    argsTemplate: '%file:%line',
  },
  {
    id: 'textmate',
    command: 'mate',
    argsTemplate: '-l %line %file',
  },
  {
    id: 'bbedit',
    command: 'bbedit',
    argsTemplate: '+%line %file',
  },
  {
    id: 'emacs',
    command: 'emacsclient',
    argsTemplate: '--no-wait +%line %file',
  },
  {
    id: 'macvim',
    command: 'mvim',
    argsTemplate: '--remote-silent +%line %file',
  },
  {
    id: 'sublime',
    command: 'subl',
    argsTemplate: '%file:%line',
  },
  {
    id: 'nova',
    command: 'nova',
    argsTemplate: 'open %file -l %line',
  },
  {
    id: 'custom',
    command: '',
    argsTemplate: '',
  },
  {
    id: 'none',
    command: '',
    argsTemplate: '',
  },
];

const DEFAULT_EDITOR_OPTION: EditorOption =
  EDITOR_OPTIONS.find((option) => option.id === DEFAULT_EDITOR_ID) ?? EDITOR_OPTIONS[0];

/**
 * Case-insensitive lookup by id. Used mostly for the `GAVEL_EDITOR` / `EDITOR`
 * environment-variable selection on the server.
 */
export const resolveEditorOption = (input?: string): EditorOption => {
  const normalized = (input ?? DEFAULT_EDITOR_ID).toLowerCase();
  const matched = EDITOR_OPTIONS.find((option) => option.id === normalized);
  return matched ?? DEFAULT_EDITOR_OPTION;
};

/**
 * Tokenise a user-supplied arguments template string into individual CLI
 * arguments. Supports single and double quoted segments so paths and flags
 * containing spaces can be preserved.
 *
 * Inside double-quoted segments `\"` decodes to a literal `"` and `\\` to a
 * literal `\`, mirroring common shell intuition. Other `\x` sequences pass
 * through untouched so Lisp/regex fragments like `\s` or `\$` stay intact.
 * Single-quoted segments are fully literal. The template is handed to
 * `spawn` as argv directly – no shell is involved.
 */
export const parseEditorArgsTemplate = (template: string | undefined | null): string[] => {
  const input = template ?? '';
  const tokens: string[] = [];
  const n = input.length;
  let i = 0;

  while (i < n) {
    while (i < n && /\s/.test(input[i] ?? '')) i++;
    if (i >= n) break;

    let token = '';
    let inQuote: '"' | "'" | null = null;
    while (i < n) {
      const ch = input[i];
      if (ch === undefined) break;

      if (inQuote === '"') {
        if (ch === '\\' && i + 1 < n) {
          const next = input[i + 1];
          if (next === '"' || next === '\\') {
            token += next;
            i += 2;
            continue;
          }
        }
        if (ch === inQuote) {
          inQuote = null;
          i++;
        } else {
          token += ch;
          i++;
        }
        continue;
      }

      if (inQuote === "'") {
        if (ch === inQuote) {
          inQuote = null;
          i++;
        } else {
          token += ch;
          i++;
        }
        continue;
      }

      if (ch === '"' || ch === "'") {
        inQuote = ch;
        i++;
        continue;
      }

      if (/\s/.test(ch)) break;

      token += ch;
      i++;
    }

    tokens.push(token);
  }

  return tokens;
};

interface EditorSpawnSpec {
  readonly command: string;
  readonly args: readonly string[];
}

interface BuildEditorSpawnSpecInput {
  readonly command: string;
  readonly argsTemplate: string;
  readonly filePath: string;
  readonly lineNumber: number | null;
}

/**
 * Build the final `{ command, args }` tuple to hand to `child_process.spawn`.
 * Returns `null` when the command is empty so callers can surface a clear
 * "not configured" error instead of spawning an empty process.
 *
 * `%file` and `%line` are substituted as-is inside each token, so composite
 * tokens such as `"%file:%line"` become `"/abs/file.ts:42"`. When no line
 * number is available the substitution falls back to `1`.
 */
export const buildEditorSpawnSpec = (input: BuildEditorSpawnSpecInput): EditorSpawnSpec | null => {
  const command = input.command.trim();
  if (!command) return null;

  const tokens = parseEditorArgsTemplate(input.argsTemplate);
  const lineValue = String(input.lineNumber ?? 1);

  const args = tokens.map((piece) =>
    piece.replaceAll('%file', input.filePath).replaceAll('%line', lineValue),
  );

  return { command, args };
};
