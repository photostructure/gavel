import { describe, it, expect } from 'vitest';

import { getPrismLanguageFromFilename } from './languageDetection';
import { loadPrismLanguage } from './languageLoader';
import Prism from './prism';

// One filename per Prism language the detection maps can return. A language
// missing from both prism-react-renderer's bundle and the loader renders as
// plain text.
const FILENAMES = [
  'app.ts',
  'App.tsx',
  'main.js',
  'App.jsx',
  'package.json',
  'styles.css',
  'index.html',
  'run.sh',
  'ci.yml',
  'README.md',
  'notes.markdown',
  'main.py',
  'app.rb',
  'main.go',
  'lib.rs',
  'Main.java',
  'main.c',
  'main.cpp',
  'main.cc',
  'main.cxx',
  'util.h',
  'util.hh',
  'util.hpp',
  'index.php',
  'schema.sql',
  'pom.xml',
  'App.swift',
  'Main.kt',
  'Main.scala',
  'App.svelte',
  'analysis.r',
  'init.lua',
  'script.pl',
  'Dockerfile',
  'Makefile',
  '.gitignore',
  '.env',
  'site.conf',
  'setup.ini',
  'Cargo.toml',
  'Token.sol',
  '.vimrc.vim',
  'main.dart',
  'Program.cs',
  'api.proto',
  'main.tf',
  'app.ex',
  'flake.nix',
  'Main.hs',
  'core.clj',
  'player.gd',
  'build.gradle',
  'schema.graphql',
];

describe('loadPrismLanguage', () => {
  it.each(FILENAMES)('makes a Prism grammar available for %s', async (filename) => {
    const lang = getPrismLanguageFromFilename(filename);
    expect(lang).not.toBe('text');
    if (!Prism.languages[lang]) await loadPrismLanguage(lang);
    expect(Prism.languages[lang]).toBeDefined();
  });
});
