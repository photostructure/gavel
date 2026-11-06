import {
  CORE_SCHEMA,
  binaryTag,
  defineMappingTag,
  loadAll,
  mergeTag,
  omapTag,
  pairsTag,
  timestampTag,
} from 'js-yaml';

// js-yaml 4 loaded !!set as an object whose keys map to null. js-yaml 5's
// setTag builds a Set, which the frontmatter table and diff cannot show.
const objectSetTag = defineMappingTag<Record<string, null>>('tag:yaml.org,2002:set', {
  create: () => ({}),
  addPair: (carrier, key, value) => {
    if (value !== null) return 'a !!set entry must not have a value';
    // defineProperty keeps a __proto__ entry as an own key, as js-yaml 4 did.
    Object.defineProperty(carrier, String(key), {
      value: null,
      enumerable: true,
      writable: true,
      configurable: true,
    });
    return '';
  },
  has: (carrier, key) => Object.hasOwn(carrier, String(key)),
  keys: (result) => Object.keys(result),
  get: (result, key) => result[String(key)],
  identify: () => false,
});

// js-yaml 5's default schema lacks js-yaml 4's timestamp, merge, binary, omap,
// pairs, and set tags; adding them back keeps unquoted dates, merge keys, and
// the rest parsing as they did before.
const FRONTMATTER_SCHEMA = CORE_SCHEMA.withTags(
  timestampTag,
  mergeTag,
  binaryTag,
  omapTag,
  pairsTag,
  objectSetTag,
);

const FRONTMATTER_PATTERN = /^---\r?\n(?:([\s\S]*?)\r?\n)?---\r?\n?/;

export function extractFrontmatter(text: string): {
  data: Record<string, unknown> | null;
  content: string;
} {
  const match = text.match(FRONTMATTER_PATTERN);
  if (!match) {
    return { data: null, content: text };
  }

  const content = text.slice(match[0].length);
  const yamlSource = match[1];

  if (yamlSource === undefined) {
    return { data: null, content };
  }

  try {
    // loadAll returns no documents for a blank or comment-only block, where
    // js-yaml 5's load throws.
    const documents: unknown[] = loadAll(yamlSource, { schema: FRONTMATTER_SCHEMA });
    if (documents.length > 1) {
      return { data: null, content: text };
    }
    const parsed = documents[0];
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { data: parsed as Record<string, unknown>, content };
    }
    return { data: null, content };
  } catch {
    return { data: null, content: text };
  }
}

/**
 * Returns the individual lines occupied by the leading YAML frontmatter block,
 * including the enclosing `---` delimiters. Returns an empty array when the text
 * has no frontmatter. Trailing carriage returns are stripped so the values can
 * be compared directly against diff line content.
 */
export function getFrontmatterLines(text: string): string[] {
  const match = text.match(FRONTMATTER_PATTERN);
  if (!match) {
    return [];
  }

  const matched = match[0].replace(/\r?\n$/, '');
  return matched.split('\n').map((line) => line.replace(/\r$/, ''));
}
