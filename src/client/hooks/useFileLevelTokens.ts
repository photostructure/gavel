import { normalizeTokens, type Token } from 'prism-react-renderer';
import { useEffect, useMemo, useState } from 'react';

import { type DiffFile } from '../../types/diff';
import { getPrismLanguageFromFilename } from '../utils/languageDetection';
import { loadPrismLanguage } from '../utils/languageLoader';
import Prism from '../utils/prism';
import { apiFetch } from '../utils/accessToken';

import { blobUrl, type CaptureRef } from './useExpandedLines';

/**
 * A line's tokens from its whole file, or null when that file's line no longer holds `content`,
 * as when the working tree changed after the diff loaded.
 */
type LineTokensGetter = (lineNumber: number, content: string) => Token[] | null;

export interface FileLevelTokens {
  getOldTokens: LineTokensGetter | null;
  getNewTokens: LineTokensGetter | null;
}

const EMPTY: FileLevelTokens = { getOldTokens: null, getNewTokens: null };

// Whole-file tokenization is skipped for larger files so we don't pay the cost
// of highlighting the entire blob; these fall back to per-line highlighting.
const MAX_WHOLE_FILE_LINES = 2000;

async function fetchBlobText(url: string): Promise<string | null> {
  try {
    const response = await apiFetch(url);
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

function tokenizeContent(content: string, language: string): Token[][] | null {
  if (content.split('\n').length > MAX_WHOLE_FILE_LINES) return null;
  const grammar = Prism.languages[language];
  if (!grammar) return null;
  try {
    const raw = Prism.tokenize(content, grammar);
    return normalizeTokens(raw);
  } catch {
    return null;
  }
}

interface UseFileLevelTokensParams {
  file: DiffFile;
  enabled: boolean;
  baseCommitish?: string;
  targetCommitish?: string;
  /** The named review whose capture holds both sides, read instead of Git refs. */
  capture?: CaptureRef;
  reloadKey?: string | number;
}

export function useFileLevelTokens({
  file,
  enabled,
  baseCommitish,
  targetCommitish,
  capture,
  reloadKey,
}: UseFileLevelTokensParams): FileLevelTokens {
  const language = useMemo(() => getPrismLanguageFromFilename(file.path), [file.path]);
  const isStdinDiff = baseCommitish === 'stdin' || targetCommitish === 'stdin';

  const [oldContent, setOldContent] = useState<string | null>(null);
  const [newContent, setNewContent] = useState<string | null>(null);
  const [grammarReady, setGrammarReady] = useState<boolean>(() => !!Prism.languages[language]);

  useEffect(() => {
    if (!enabled) return;
    if (Prism.languages[language]) {
      setGrammarReady(true);
      return;
    }
    let cancelled = false;
    loadPrismLanguage(language)
      .then(() => {
        if (!cancelled) setGrammarReady(true);
      })
      .catch(() => {
        if (!cancelled) setGrammarReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, language]);

  useEffect(() => {
    if (!enabled || isStdinDiff) {
      setOldContent(null);
      setNewContent(null);
      return;
    }
    let cancelled = false;
    setOldContent(null);
    setNewContent(null);

    if (file.status !== 'added' && (capture || baseCommitish)) {
      const oldPath = file.oldPath || file.path;
      const source = capture ? { capture, side: 'old' as const } : { ref: baseCommitish ?? '' };
      void fetchBlobText(blobUrl(oldPath, source)).then((text) => {
        if (!cancelled) setOldContent(text);
      });
    }
    if (file.status !== 'deleted' && (capture || targetCommitish)) {
      const source = capture ? { capture, side: 'new' as const } : { ref: targetCommitish ?? '' };
      void fetchBlobText(blobUrl(file.path, source)).then((text) => {
        if (!cancelled) setNewContent(text);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [
    enabled,
    file.path,
    file.oldPath,
    file.status,
    baseCommitish,
    targetCommitish,
    capture,
    reloadKey,
    isStdinDiff,
  ]);

  const oldTokens = useMemo<Token[][] | null>(() => {
    if (!enabled || !grammarReady || oldContent == null) return null;
    return tokenizeContent(oldContent, language);
  }, [enabled, grammarReady, oldContent, language]);

  const newTokens = useMemo<Token[][] | null>(() => {
    if (!enabled || !grammarReady || newContent == null) return null;
    return tokenizeContent(newContent, language);
  }, [enabled, grammarReady, newContent, language]);

  return useMemo<FileLevelTokens>(() => {
    if (!enabled) return EMPTY;
    const lookup =
      (tokens: Token[][]): LineTokensGetter =>
      (lineNumber, content) => {
        const line = tokens[lineNumber - 1];
        // A diff line keeps a CRLF file's \r, which tokenizing splits off with the \n.
        const text = content.endsWith('\r') ? content.slice(0, -1) : content;
        return line && line.map((token) => token.content).join('') === text ? line : null;
      };
    const getOldTokens = oldTokens ? lookup(oldTokens) : null;
    const getNewTokens = newTokens ? lookup(newTokens) : null;
    return { getOldTokens, getNewTokens };
  }, [enabled, oldTokens, newTokens]);
}
