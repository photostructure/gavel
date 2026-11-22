import { describe, it, expect } from 'vitest';

import { getPrismLanguageFromFilename } from './languageDetection';

describe('languageDetection', () => {
  describe('getPrismLanguageFromFilename', () => {
    it('highlights C and C++ headers and sources with the C++ grammar', () => {
      for (const filename of ['util.h', 'util.hh', 'util.hpp', 'main.cc', 'main.cxx']) {
        expect(getPrismLanguageFromFilename(filename)).toBe('cpp');
      }
    });

    it('highlights .markdown files as Markdown', () => {
      expect(getPrismLanguageFromFilename('docs/notes.markdown')).toBe('markdown');
    });

    it('highlights .gitignore with the ignore-file grammar', () => {
      expect(getPrismLanguageFromFilename('.gitignore')).toBe('ignore');
      expect(getPrismLanguageFromFilename('src/.gitignore')).toBe('ignore');
    });
  });
});
