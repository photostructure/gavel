import { describe, it, expect } from 'vitest';

import { getPrismLanguageFromFilename, isWholeFileHighlightExtension } from './languageDetection';

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

  describe('isWholeFileHighlightExtension', () => {
    it('returns true for component-style extensions', () => {
      expect(isWholeFileHighlightExtension('src/App.vue')).toBe(true);
      expect(isWholeFileHighlightExtension('src/App.svelte')).toBe(true);
      expect(isWholeFileHighlightExtension('pages/index.astro')).toBe(true);
    });

    it('is case-insensitive', () => {
      expect(isWholeFileHighlightExtension('Component.VUE')).toBe(true);
      expect(isWholeFileHighlightExtension('Component.SVELTE')).toBe(true);
    });

    it('returns false for other extensions', () => {
      expect(isWholeFileHighlightExtension('src/app.ts')).toBe(false);
      expect(isWholeFileHighlightExtension('src/app.tsx')).toBe(false);
      expect(isWholeFileHighlightExtension('main.js')).toBe(false);
      expect(isWholeFileHighlightExtension('index.html')).toBe(false);
      expect(isWholeFileHighlightExtension('styles.css')).toBe(false);
      expect(isWholeFileHighlightExtension('README.md')).toBe(false);
    });

    it('returns false when there is no extension', () => {
      expect(isWholeFileHighlightExtension('Dockerfile')).toBe(false);
      expect(isWholeFileHighlightExtension('')).toBe(false);
    });
  });
});
