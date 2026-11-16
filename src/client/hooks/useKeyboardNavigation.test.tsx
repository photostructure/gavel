import { renderHook, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type React from 'react';
import { HotkeysProvider } from 'react-hotkeys-hook';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { DiffFile } from '../../types/diff';

import type { CursorPosition } from './keyboardNavigation/types';

import { useKeyboardNavigation } from './useKeyboardNavigation';

// Mock scrollIntoView and getElementById
Element.prototype.scrollIntoView = vi.fn();
const mockGetElementById = vi.spyOn(document, 'getElementById');
const mockQuerySelector = vi.spyOn(document, 'querySelector');

// Mock window properties
Object.defineProperty(window, 'innerHeight', {
  writable: true,
  configurable: true,
  value: 768,
});

Object.defineProperty(window, 'pageYOffset', {
  writable: true,
  configurable: true,
  value: 0,
});

window.scrollTo = vi.fn();

// Helper to create mock elements
const createMockElement = () => ({
  scrollIntoView: vi.fn(),
  getBoundingClientRect: vi.fn(() => ({
    top: 100,
    bottom: 200,
    left: 0,
    right: 100,
    width: 100,
    height: 100,
  })),
  offsetTop: 150,
});

// Helper to create mock scrollable container
const createMockScrollContainer = () => ({
  getBoundingClientRect: vi.fn(() => ({
    top: 0,
    bottom: 768,
    left: 0,
    right: 1024,
    width: 1024,
    height: 768,
  })),
  scrollTop: 0,
  scrollHeight: 2000,
  clientHeight: 768,
});

// Sample diff data for testing
const mockFiles: DiffFile[] = [
  {
    path: 'file1.js',
    status: 'modified',
    additions: 1,
    deletions: 1,
    chunks: [
      {
        oldStart: 1,
        oldLines: 3,
        newStart: 1,
        newLines: 4,
        lines: [
          { type: 'delete', oldLineNumber: 1, content: '- old line' },
          { type: 'add', newLineNumber: 1, content: '+ new line' },
          {
            type: 'normal',
            oldLineNumber: 2,
            newLineNumber: 2,
            content: '  unchanged',
          },
          {
            type: 'normal',
            oldLineNumber: 3,
            newLineNumber: 3,
            content: '  another unchanged',
          },
        ],
        header: '@@ -1,3 +1,4 @@',
      },
    ],
  },
  {
    path: 'file2.js',
    status: 'modified',
    additions: 1,
    deletions: 0,
    chunks: [
      {
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 2,
        lines: [
          {
            type: 'normal',
            oldLineNumber: 1,
            newLineNumber: 1,
            content: '  first line',
          },
          { type: 'add', newLineNumber: 2, content: '+ added line' },
        ],
        header: '@@ -1,2 +1,2 @@',
      },
    ],
  },
];

// Wrapper component - using the mocked HotkeysProvider
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <HotkeysProvider initiallyActiveScopes={['navigation']}>{children}</HotkeysProvider>
);

describe('useKeyboardNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetElementById.mockImplementation(() => createMockElement() as any);
    mockQuerySelector.mockImplementation(() => createMockScrollContainer() as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Line Navigation (j/k)', () => {
    it('should navigate to next line with j key', async () => {
      const user = userEvent.setup();

      const { result } = renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments: [],
            viewMode: 'unified',
            onToggleReviewed: vi.fn(),
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
          }),
        { wrapper },
      );

      await user.keyboard('j');

      expect(result.current.cursor).toEqual({
        fileIndex: 0,
        chunkIndex: 0,
        lineIndex: 0,
        side: 'left',
      });
    });

    it('should navigate to next line with down arrow', async () => {
      const user = userEvent.setup();

      const { result } = renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments: [],
            viewMode: 'unified',
            onToggleReviewed: vi.fn(),
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
          }),
        { wrapper },
      );

      await user.keyboard('{ArrowDown}');

      expect(result.current.cursor).toEqual({
        fileIndex: 0,
        chunkIndex: 0,
        lineIndex: 0,
        side: 'left',
      });
    });

    it('should navigate to previous line with k key', async () => {
      const user = userEvent.setup();

      const { result } = renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments: [],
            viewMode: 'unified',
            onToggleReviewed: vi.fn(),
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
          }),
        { wrapper },
      );

      // First set cursor to a line
      act(() => {
        result.current.setCursorPosition({
          fileIndex: 0,
          chunkIndex: 0,
          lineIndex: 2,
          side: 'right',
        });
      });

      await user.keyboard('k');

      expect(result.current.cursor).toEqual({
        fileIndex: 0,
        chunkIndex: 0,
        lineIndex: 1,
        side: 'right',
      });
    });

    // A file with no lines on the cursor's side used to be skipped, so j wrapped to the top.
    const sideOnlyFile = (path: string, type: 'add' | 'delete'): DiffFile => ({
      path,
      status: type === 'add' ? 'added' : 'deleted',
      additions: type === 'add' ? 2 : 0,
      deletions: type === 'delete' ? 2 : 0,
      chunks: [
        {
          header: '@@',
          oldStart: 1,
          oldLines: 0,
          newStart: 1,
          newLines: 2,
          lines: [1, 2].map((n) =>
            type === 'add'
              ? { type, newLineNumber: n, content: `+ ${n}` }
              : { type, oldLineNumber: n, content: `- ${n}` },
          ),
        },
      ],
    });

    it('should move j from the old column into a new file on its new column', async () => {
      const user = userEvent.setup();
      const files = [mockFiles[0]!, sideOnlyFile('new.js', 'add')];

      const { result } = renderHook(
        () =>
          useKeyboardNavigation({
            files,
            comments: [],
            viewMode: 'split',
            onToggleReviewed: vi.fn(),
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
          }),
        { wrapper },
      );

      act(() => {
        result.current.setCursorPosition({
          fileIndex: 0,
          chunkIndex: 0,
          lineIndex: 3,
          side: 'left',
        });
      });

      await user.keyboard('j');

      expect(result.current.cursor).toEqual({
        fileIndex: 1,
        chunkIndex: 0,
        lineIndex: 0,
        side: 'right',
      });
    });

    it('should move k from the new column into a deleted file on its old column', async () => {
      const user = userEvent.setup();
      const files = [sideOnlyFile('gone.js', 'delete'), mockFiles[1]!];

      const { result } = renderHook(
        () =>
          useKeyboardNavigation({
            files,
            comments: [],
            viewMode: 'split',
            onToggleReviewed: vi.fn(),
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
          }),
        { wrapper },
      );

      act(() => {
        result.current.setCursorPosition({
          fileIndex: 1,
          chunkIndex: 0,
          lineIndex: 0,
          side: 'right',
        });
      });

      await user.keyboard('k');

      expect(result.current.cursor).toEqual({
        fileIndex: 0,
        chunkIndex: 0,
        lineIndex: 1,
        side: 'left',
      });
    });

    // Line keys follow what is on screen: a Viewed file opened from the file list shows its
    // lines, and a file collapsed from its header hides them.
    it('should move j into a Viewed file that is expanded', async () => {
      const user = userEvent.setup();

      const { result } = renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments: [],
            viewMode: 'unified',
            onToggleReviewed: vi.fn(),
            reviewedFiles: new Set<string>(['file2.js']),
            collapsedFiles: new Set<string>(),
          }),
        { wrapper },
      );

      act(() => {
        result.current.setCursorPosition({
          fileIndex: 0,
          chunkIndex: 0,
          lineIndex: 3,
          side: 'right',
        });
      });

      await user.keyboard('j');

      expect(result.current.cursor).toEqual({
        fileIndex: 1,
        chunkIndex: 0,
        lineIndex: 0,
        side: 'right',
      });
    });

    it('should move j past a collapsed file that is not Viewed', async () => {
      const user = userEvent.setup();

      const files = [...mockFiles, { ...mockFiles[1]!, path: 'file3.js' }];

      const { result } = renderHook(
        () =>
          useKeyboardNavigation({
            files,
            comments: [],
            viewMode: 'unified',
            onToggleReviewed: vi.fn(),
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(['file2.js']),
          }),
        { wrapper },
      );

      act(() => {
        result.current.setCursorPosition({
          fileIndex: 0,
          chunkIndex: 0,
          lineIndex: 3,
          side: 'right',
        });
      });

      await user.keyboard('j');

      expect(result.current.cursor).toEqual({
        fileIndex: 2,
        chunkIndex: 0,
        lineIndex: 0,
        side: 'right',
      });
    });
  });

  // Navigation stops at the first and last line of the review instead of wrapping around.
  describe('Ends of the review', () => {
    const renderAt = (cursor: CursorPosition) => {
      const hook = renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments: [],
            viewMode: 'unified',
            onToggleReviewed: vi.fn(),
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
          }),
        { wrapper },
      );
      act(() => {
        hook.result.current.setCursorPosition(cursor);
      });
      return hook.result;
    };

    it('should keep the cursor on the last line of the last file with j', async () => {
      const user = userEvent.setup();
      const last = { fileIndex: 1, chunkIndex: 0, lineIndex: 1, side: 'right' } as const;
      const result = renderAt(last);

      await user.keyboard('j');

      expect(result.current.cursor).toEqual(last);
    });

    it('should keep the cursor on the first line of the first file with k', async () => {
      const user = userEvent.setup();
      const first = { fileIndex: 0, chunkIndex: 0, lineIndex: 0, side: 'left' } as const;
      const result = renderAt(first);

      await user.keyboard('k');

      expect(result.current.cursor).toEqual(first);
    });

    it('should keep the cursor in the last file with ]', async () => {
      const user = userEvent.setup();
      const lastFile = { fileIndex: 1, chunkIndex: 0, lineIndex: 0, side: 'right' } as const;
      const result = renderAt(lastFile);

      await user.keyboard('{\\]}');

      expect(result.current.cursor).toEqual(lastFile);
    });
  });

  describe('File Navigation (]/[)', () => {
    it('should navigate to previous file with [ key', async () => {
      const user = userEvent.setup();
      const { result } = renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments: [],
            viewMode: 'unified',
            onToggleReviewed: vi.fn(),
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
          }),
        { wrapper },
      );

      // Set cursor to second file
      act(() => {
        result.current.setCursorPosition({
          fileIndex: 1,
          chunkIndex: 0,
          lineIndex: 0,
          side: 'right',
        });
      });

      await user.keyboard('{\\[}');

      expect(result.current.cursor?.fileIndex).toBe(0);
    });

    it('should jump to first file with Shift+[ key', async () => {
      const user = userEvent.setup();
      const { result } = renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments: [],
            viewMode: 'unified',
            onToggleReviewed: vi.fn(),
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
          }),
        { wrapper },
      );

      // Set cursor to second file
      act(() => {
        result.current.setCursorPosition({
          fileIndex: 1,
          chunkIndex: 0,
          lineIndex: 0,
          side: 'right',
        });
      });

      // Shift+[ on a US keyboard: the browser reports key '{' with shiftKey.
      await user.keyboard('{Shift>}{{{/Shift}');

      expect(result.current.cursor?.fileIndex).toBe(0);
      expect(result.current.cursor?.chunkIndex).toBe(0);
      expect(result.current.cursor?.lineIndex).toBe(0);
    });

    it('should jump to last file with Shift+] key', async () => {
      const user = userEvent.setup();
      const { result } = renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments: [],
            viewMode: 'unified',
            onToggleReviewed: vi.fn(),
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
          }),
        { wrapper },
      );

      // Set cursor to first file
      act(() => {
        result.current.setCursorPosition({
          fileIndex: 0,
          chunkIndex: 0,
          lineIndex: 0,
          side: 'right',
        });
      });

      // Shift+] on a US keyboard: the browser reports key '}' with shiftKey.
      await user.keyboard('{Shift>}}{/Shift}');

      expect(result.current.cursor?.fileIndex).toBe(mockFiles.length - 1);
      expect(result.current.cursor?.chunkIndex).toBe(0);
      expect(result.current.cursor?.lineIndex).toBe(0);
    });

    // German layout: AltGr+0 types }. Windows reports AltGr as Ctrl+Alt with
    // AltGraph; Linux reports AltGraph alone, which is what user-event sends
    // for {AltGraph} by itself; Firefox on macOS reports Option as Alt with
    // AltGraph (MDN, KeyboardEvent.getModifierState).
    it.each([
      ['Windows', '{Control>}{Alt>}{AltGraph>}[Digit0]{/AltGraph}{/Alt}{/Control}'],
      ['Linux', '{AltGraph>}[Digit0]{/AltGraph}'],
      ['macOS', '{Alt>}{AltGraph>}[Digit0]{/AltGraph}{/Alt}'],
    ])('should jump to last file with } typed with AltGr (%s)', async (_platform, keys) => {
      const user = userEvent.setup({ keyboardMap: [{ code: 'Digit0', key: '}' }] });
      const { result } = renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments: [],
            viewMode: 'unified',
            onToggleReviewed: vi.fn(),
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
          }),
        { wrapper },
      );

      act(() => {
        result.current.setCursorPosition({
          fileIndex: 0,
          chunkIndex: 0,
          lineIndex: 0,
          side: 'right',
        });
      });

      await user.keyboard(keys);

      expect(result.current.cursor?.fileIndex).toBe(mockFiles.length - 1);
    });

    // An added file has nothing in split view's left column
    const addedFile = (path: string): DiffFile => ({
      path,
      status: 'added',
      additions: 1,
      deletions: 0,
      chunks: [
        {
          oldStart: 0,
          oldLines: 0,
          newStart: 1,
          newLines: 1,
          header: '@@ -0,0 +1,1 @@',
          lines: [{ type: 'add', newLineNumber: 1, content: 'added' }],
        },
      ],
    });

    it.each([
      ['{Shift>}{{{/Shift}', 0],
      ['{Shift>}}{/Shift}', 2],
    ])(
      'should put the cursor on the column with content when %s jumps to an added file in split view',
      async (keys, fileIndex) => {
        const user = userEvent.setup();
        const files = [addedFile('first.js'), mockFiles[0]!, addedFile('last.js')];
        const { result } = renderHook(
          () =>
            useKeyboardNavigation({
              files,
              comments: [],
              viewMode: 'split',
              onToggleReviewed: vi.fn(),
              reviewedFiles: new Set<string>(),
              collapsedFiles: new Set<string>(),
            }),
          { wrapper },
        );

        act(() => {
          result.current.setCursorPosition({
            fileIndex: 1,
            chunkIndex: 0,
            lineIndex: 2,
            side: 'left',
          });
        });

        await user.keyboard(keys);

        expect(result.current.cursor).toEqual({
          fileIndex,
          chunkIndex: 0,
          lineIndex: 0,
          side: 'right',
        });
      },
    );

    it('should keep the cursor where it is when Shift+[ finds no lines in the first file', async () => {
      const user = userEvent.setup();
      const binary: DiffFile = {
        path: 'image.png',
        status: 'modified',
        additions: 0,
        deletions: 0,
        chunks: [],
      };
      const { result } = renderHook(
        () =>
          useKeyboardNavigation({
            files: [binary, ...mockFiles],
            comments: [],
            viewMode: 'unified',
            onToggleReviewed: vi.fn(),
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
          }),
        { wrapper },
      );
      const start = { fileIndex: 1, chunkIndex: 0, lineIndex: 2, side: 'right' } as const;
      act(() => {
        result.current.setCursorPosition(start);
      });

      await user.keyboard('{Shift>}{{{/Shift}');

      expect(result.current.cursor).toEqual(start);
    });
  });

  describe('Chunk Navigation (n/p)', () => {
    it('should navigate to next chunk with n key', async () => {
      const user = userEvent.setup();

      const { result } = renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments: [],
            viewMode: 'unified',
            onToggleReviewed: vi.fn(),
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
          }),
        { wrapper },
      );

      // The first chunk starts on file1.js's deleted line
      await user.keyboard('n');
      expect(result.current.cursor).toEqual({
        fileIndex: 0,
        chunkIndex: 0,
        lineIndex: 0,
        side: 'left',
      });

      // The next chunk skips file1.js's unchanged lines and starts on file2.js's added line
      await user.keyboard('n');
      expect(result.current.cursor).toEqual({
        fileIndex: 1,
        chunkIndex: 0,
        lineIndex: 1,
        side: 'right',
      });
    });

    it('should navigate to previous chunk with p key', async () => {
      const user = userEvent.setup();

      const { result } = renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments: [],
            viewMode: 'unified',
            onToggleReviewed: vi.fn(),
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
          }),
        { wrapper },
      );

      // First navigate to a chunk
      await user.keyboard('n');
      await user.keyboard('n');

      // Then navigate back
      await user.keyboard('p');

      expect(result.current.cursor).toEqual({
        fileIndex: 0,
        chunkIndex: 0,
        lineIndex: 0,
        side: 'left',
      });
    });
  });

  describe('Comment Navigation (N/P)', () => {
    it('should navigate to old-side and new-side comments on the same line separately', async () => {
      const user = userEvent.setup();
      const comments = [
        { file: 'file1.js', line: 1, side: 'old' as const },
        { file: 'file1.js', line: 1, side: 'new' as const },
      ];

      const { result } = renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments,
            viewMode: 'unified',
            onToggleReviewed: vi.fn(),
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
          }),
        { wrapper },
      );

      await user.keyboard('{Shift>}n{/Shift}');
      expect(result.current.cursor).toEqual({
        fileIndex: 0,
        chunkIndex: 0,
        lineIndex: 0,
        side: 'left',
      });

      await user.keyboard('{Shift>}n{/Shift}');
      expect(result.current.cursor).toEqual({
        fileIndex: 0,
        chunkIndex: 0,
        lineIndex: 1,
        side: 'right',
      });
    });

    it('should navigate back to the old-side comment with Shift+P', async () => {
      const user = userEvent.setup();
      const comments = [
        { file: 'file1.js', line: 1, side: 'old' as const },
        { file: 'file1.js', line: 1, side: 'new' as const },
      ];

      const { result } = renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments,
            viewMode: 'unified',
            onToggleReviewed: vi.fn(),
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
          }),
        { wrapper },
      );

      await user.keyboard('{Shift>}n{/Shift}');
      await user.keyboard('{Shift>}n{/Shift}');
      await user.keyboard('{Shift>}p{/Shift}');

      expect(result.current.cursor).toEqual({
        fileIndex: 0,
        chunkIndex: 0,
        lineIndex: 0,
        side: 'left',
      });
    });

    // A range comment's card renders under its last line, so Shift+N goes there. The hunk
    // shows new lines 10 and 11; a range from line 5 starts above it.
    const hunkAtTen: DiffFile[] = [
      {
        path: 'range.js',
        status: 'modified',
        additions: 1,
        deletions: 0,
        chunks: [
          {
            oldStart: 10,
            oldLines: 1,
            newStart: 10,
            newLines: 2,
            header: '@@ -10,1 +10,2 @@',
            lines: [
              { type: 'normal', oldLineNumber: 10, newLineNumber: 10, content: 'same' },
              { type: 'add', newLineNumber: 11, content: 'added' },
            ],
          },
        ],
      },
    ];

    it.each([[[10, 11]], [[5, 11]]] as const)(
      'should navigate to the last line of a range comment on lines %j',
      async (line) => {
        const user = userEvent.setup();
        const { result } = renderHook(
          () =>
            useKeyboardNavigation({
              files: hunkAtTen,
              comments: [{ file: 'range.js', line: [...line], side: 'new' }],
              viewMode: 'unified',
              onToggleReviewed: vi.fn(),
              reviewedFiles: new Set<string>(),
              collapsedFiles: new Set<string>(),
            }),
          { wrapper },
        );

        await user.keyboard('{Shift>}n{/Shift}');

        expect(result.current.cursor).toEqual({
          fileIndex: 0,
          chunkIndex: 0,
          lineIndex: 1,
          side: 'right',
        });
      },
    );
  });

  describe('Help Modal (?)', () => {
    it('should toggle help modal with ? key', async () => {
      const user = userEvent.setup();
      const { result } = renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments: [],
            viewMode: 'unified',
            onToggleReviewed: vi.fn(),
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
          }),
        { wrapper },
      );

      expect(result.current.isHelpOpen).toBe(false);

      // ? is Shift + / on US keyboard
      await user.keyboard('{Shift>}?{/Shift}');
      // await user.keyboard('[ShiftLeft>][Slash]');

      expect(result.current.isHelpOpen).toBe(true);
    });

    it('should toggle help modal with ? typed without Shift', async () => {
      const user = userEvent.setup({
        // A keyboard or input method that reports ? with shiftKey false.
        keyboardMap: [{ code: 'Minus', key: '?' }],
      });
      const { result } = renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments: [],
            viewMode: 'unified',
            onToggleReviewed: vi.fn(),
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
          }),
        { wrapper },
      );

      await user.keyboard('[Minus]');

      expect(result.current.isHelpOpen).toBe(true);
    });

    it('should allow closing help modal with setIsHelpOpen', () => {
      const { result } = renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments: [],
            viewMode: 'unified',
            onToggleReviewed: vi.fn(),
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
          }),
        { wrapper },
      );

      act(() => {
        result.current.setIsHelpOpen(true);
      });

      expect(result.current.isHelpOpen).toBe(true);

      act(() => {
        result.current.setIsHelpOpen(false);
      });

      expect(result.current.isHelpOpen).toBe(false);
    });
  });

  describe('Review Toggle and Advance (v)', () => {
    it('should mark current file as viewed and move cursor to next unviewed file', async () => {
      const user = userEvent.setup();
      const onToggleReviewed = vi.fn();

      const { result } = renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments: [],
            viewMode: 'unified',
            onToggleReviewed,
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
          }),
        { wrapper },
      );

      // Set cursor first
      act(() => {
        result.current.setCursorPosition({
          fileIndex: 0,
          chunkIndex: 0,
          lineIndex: 0,
          side: 'left',
        });
      });

      await user.keyboard('v');

      expect(onToggleReviewed).toHaveBeenCalledWith('file1.js');
      expect(result.current.cursor?.fileIndex).toBe(1);
    });

    it('should un-mark an already viewed file and keep the cursor on it', async () => {
      const user = userEvent.setup();
      const onToggleReviewed = vi.fn();

      const { result } = renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments: [],
            viewMode: 'unified',
            onToggleReviewed,
            reviewedFiles: new Set<string>(['file1.js']),
            collapsedFiles: new Set<string>(),
          }),
        { wrapper },
      );

      act(() => {
        result.current.setCursorPosition({
          fileIndex: 0,
          chunkIndex: 0,
          lineIndex: 0,
          side: 'left',
        });
      });

      await user.keyboard('v');

      expect(onToggleReviewed).toHaveBeenCalledWith('file1.js');
      expect(result.current.cursor?.fileIndex).toBe(0);
    });

    it('should keep cursor when all other files are already viewed', async () => {
      const user = userEvent.setup();
      const onToggleReviewed = vi.fn();

      const { result } = renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments: [],
            viewMode: 'unified',
            onToggleReviewed,
            reviewedFiles: new Set<string>(['file2.js']),
            collapsedFiles: new Set<string>(),
          }),
        { wrapper },
      );

      act(() => {
        result.current.setCursorPosition({
          fileIndex: 0,
          chunkIndex: 0,
          lineIndex: 0,
          side: 'left',
        });
      });

      await user.keyboard('v');

      expect(onToggleReviewed).toHaveBeenCalledWith('file1.js');
      expect(result.current.cursor?.fileIndex).toBe(0);
    });

    it('should mark hovered file as viewed and move cursor to next unviewed file when there is no cursor', async () => {
      const user = userEvent.setup();
      const onToggleReviewed = vi.fn();

      const { result } = renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments: [],
            viewMode: 'unified',
            onToggleReviewed,
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
            getHoveredFileIndex: () => 1,
          }),
        { wrapper },
      );

      await user.keyboard('v');

      expect(onToggleReviewed).toHaveBeenCalledWith('file2.js');
      expect(result.current.cursor?.fileIndex).toBe(0);
    });

    it('should prefer cursor file over hovered file', async () => {
      const user = userEvent.setup();
      const onToggleReviewed = vi.fn();

      const { result } = renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments: [],
            viewMode: 'unified',
            onToggleReviewed,
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
            getHoveredFileIndex: () => 1,
          }),
        { wrapper },
      );

      act(() => {
        result.current.setCursorPosition({
          fileIndex: 0,
          chunkIndex: 0,
          lineIndex: 0,
          side: 'left',
        });
      });

      await user.keyboard('v');

      expect(onToggleReviewed).toHaveBeenCalledWith('file1.js');
    });

    it('should not toggle reviewed state when no file is selected', async () => {
      const user = userEvent.setup();
      const onToggleReviewed = vi.fn();

      renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments: [],
            viewMode: 'unified',
            onToggleReviewed,
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
          }),
        { wrapper },
      );

      await user.keyboard('v');

      expect(onToggleReviewed).not.toHaveBeenCalled();
    });
  });

  // A toggle that fell back to the remembered cursor position could un-mark a
  // file the user cannot see, so neither key uses it.
  it.each(['v', '{Shift>}v{/Shift}'])(
    'should not toggle the remembered file with %s after the cursor is cleared',
    async (keys) => {
      const user = userEvent.setup();
      const onToggleReviewed = vi.fn();

      const { result } = renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments: [],
            viewMode: 'unified',
            onToggleReviewed,
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
          }),
        { wrapper },
      );

      act(() => {
        result.current.setCursorPosition({
          fileIndex: 0,
          chunkIndex: 0,
          lineIndex: 0,
          side: 'left',
        });
      });
      act(() => {
        result.current.setCursorPosition(null);
      });

      await user.keyboard(keys);

      expect(onToggleReviewed).not.toHaveBeenCalled();
    },
  );

  describe('Review Toggle in Place (Shift+V)', () => {
    it.each([
      ['an unviewed', new Set<string>()],
      ['a viewed', new Set<string>(['file1.js'])],
    ])('should toggle %s current file and keep the cursor on it', async (_, reviewedFiles) => {
      const user = userEvent.setup();
      const onToggleReviewed = vi.fn();

      const { result } = renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments: [],
            viewMode: 'unified',
            onToggleReviewed,
            reviewedFiles,
            collapsedFiles: new Set<string>(),
          }),
        { wrapper },
      );

      act(() => {
        result.current.setCursorPosition({
          fileIndex: 0,
          chunkIndex: 0,
          lineIndex: 0,
          side: 'left',
        });
      });

      await user.keyboard('{Shift>}v{/Shift}');

      expect(onToggleReviewed).toHaveBeenCalledWith('file1.js');
      expect(result.current.cursor?.fileIndex).toBe(0);
    });

    it('should toggle hovered file without showing the cursor when there is no cursor', async () => {
      const user = userEvent.setup();
      const onToggleReviewed = vi.fn();

      const { result } = renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments: [],
            viewMode: 'unified',
            onToggleReviewed,
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
            getHoveredFileIndex: () => 1,
          }),
        { wrapper },
      );

      await user.keyboard('{Shift>}v{/Shift}');

      expect(onToggleReviewed).toHaveBeenCalledWith('file2.js');
      expect(result.current.cursor).toBeNull();
    });
  });

  describe('Cursor Memory', () => {
    it('should resume file navigation from the last cursor after it is cleared', async () => {
      const user = userEvent.setup();

      const { result } = renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments: [],
            viewMode: 'unified',
            onToggleReviewed: vi.fn(),
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
          }),
        { wrapper },
      );

      // Navigate to a position, then clear the cursor (as a mouse click does)
      act(() => {
        result.current.setCursorPosition({
          fileIndex: 0,
          chunkIndex: 0,
          lineIndex: 2,
          side: 'right',
        });
      });
      act(() => {
        result.current.setCursorPosition(null);
      });

      expect(result.current.cursor).toBeNull();

      await user.keyboard('{\\]}');

      // Should move to the file after the remembered position, not wrap to the end
      expect(result.current.cursor?.fileIndex).toBe(1);
    });

    it('should remember a file position without showing the cursor', async () => {
      const user = userEvent.setup();

      const { result } = renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments: [],
            viewMode: 'unified',
            onToggleReviewed: vi.fn(),
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
          }),
        { wrapper },
      );

      act(() => {
        result.current.rememberFilePosition(0);
      });

      // No visible cursor appears for a mouse interaction
      expect(result.current.cursor).toBeNull();

      // But keyboard navigation resumes from the remembered file
      await user.keyboard('{\\]}');
      expect(result.current.cursor?.fileIndex).toBe(1);
    });
  });

  describe('Refresh (shift+r)', () => {
    it('should trigger refresh with shift+r key', async () => {
      const user = userEvent.setup();
      const onRefresh = vi.fn();

      renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments: [],
            viewMode: 'unified',
            onToggleReviewed: vi.fn(),
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
            onRefresh,
          }),
        { wrapper },
      );

      await user.keyboard('{Shift>}r{/Shift}');

      expect(onRefresh).toHaveBeenCalled();
    });

    it('should not trigger refresh when onRefresh is not provided', async () => {
      const user = userEvent.setup();

      renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments: [],
            viewMode: 'unified',
            onToggleReviewed: vi.fn(),
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
          }),
        { wrapper },
      );

      // A refresh handler that threw would reject this promise
      await expect(user.keyboard('{Shift>}r{/Shift}')).resolves.toBeUndefined();
    });
  });

  describe('File tree (f)', () => {
    it('toggles the file tree with f', async () => {
      const user = userEvent.setup();
      const onToggleFileTree = vi.fn();

      renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments: [],
            viewMode: 'unified',
            onToggleReviewed: vi.fn(),
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
            onToggleFileTree,
          }),
        { wrapper },
      );

      await user.keyboard('f');

      expect(onToggleFileTree).toHaveBeenCalledTimes(1);
    });
  });

  describe('Verdict (shift+a, shift+x)', () => {
    const renderWithVerdict = (onVerdict: (verdict: 'approve' | 'reject') => void) =>
      renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments: [],
            viewMode: 'unified',
            onToggleReviewed: vi.fn(),
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
            onVerdict,
          }),
        { wrapper },
      );

    it('approves with shift+a and rejects with shift+x, but not with a or x alone', async () => {
      const user = userEvent.setup();
      const onVerdict = vi.fn();
      renderWithVerdict(onVerdict);

      await user.keyboard('ax');
      expect(onVerdict).not.toHaveBeenCalled();

      await user.keyboard('{Shift>}A{/Shift}{Shift>}X{/Shift}');
      expect(onVerdict.mock.calls).toEqual([['approve'], ['reject']]);
    });

    it('gives no verdict while a capital A or X is typed into a comment box', async () => {
      const user = userEvent.setup();
      const onVerdict = vi.fn();
      const textarea = document.createElement('textarea');
      document.body.appendChild(textarea);
      textarea.focus();
      renderWithVerdict(onVerdict);

      await user.keyboard('{Shift>}A{/Shift}{Shift>}X{/Shift}');

      expect(textarea.value).toBe('AX');
      expect(onVerdict).not.toHaveBeenCalled();
      document.body.removeChild(textarea);
    });
  });

  describe('Add Comment (c)', () => {
    it('should trigger comment creation on add/normal lines with c key', async () => {
      const user = userEvent.setup();
      const onCreateComment = vi.fn();

      const { result } = renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments: [],
            viewMode: 'unified',
            onToggleReviewed: vi.fn(),
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
            onCreateComment,
          }),
        { wrapper },
      );

      // Navigate to a normal line
      act(() => {
        result.current.setCursorPosition({
          fileIndex: 0,
          chunkIndex: 0,
          lineIndex: 2,
          side: 'right',
        });
      });

      await user.keyboard('c');

      expect(onCreateComment).toHaveBeenCalled();
    });

    it('should not trigger comment creation on deleted lines', async () => {
      const user = userEvent.setup();
      const onCreateComment = vi.fn();

      const { result } = renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments: [],
            viewMode: 'unified',
            onToggleReviewed: vi.fn(),
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
            onCreateComment,
          }),
        { wrapper },
      );

      // Navigate to a delete line
      act(() => {
        result.current.setCursorPosition({
          fileIndex: 0,
          chunkIndex: 0,
          lineIndex: 0,
          side: 'left',
        });
      });

      await user.keyboard('c');

      expect(onCreateComment).not.toHaveBeenCalled();
    });
  });

  describe('Side Switching (h/l)', () => {
    it('should switch to left side with h key', async () => {
      const user = userEvent.setup();

      const { result } = renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments: [],
            viewMode: 'split',
            onToggleReviewed: vi.fn(),
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
          }),
        { wrapper },
      );

      // Set cursor to right side
      act(() => {
        result.current.setCursorPosition({
          fileIndex: 0,
          chunkIndex: 0,
          lineIndex: 2,
          side: 'right',
        });
      });

      await user.keyboard('h');

      expect(result.current.cursor?.side).toBe('left');
    });

    it('should switch to right side with l key', async () => {
      const user = userEvent.setup();

      const { result } = renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments: [],
            viewMode: 'split',
            onToggleReviewed: vi.fn(),
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
          }),
        { wrapper },
      );

      // Set cursor to left side
      act(() => {
        result.current.setCursorPosition({
          fileIndex: 0,
          chunkIndex: 0,
          lineIndex: 0,
          side: 'left',
        });
      });

      await user.keyboard('l');

      expect(result.current.cursor?.side).toBe('right');
    });

    // Split view shows the k-th deletion of a run beside the k-th addition after it:
    // line 0 beside line 2, and line 1 beside line 3.
    const twoForTwo: DiffFile[] = [
      {
        path: 'pairs.js',
        status: 'modified',
        additions: 2,
        deletions: 2,
        chunks: [
          {
            oldStart: 1,
            oldLines: 3,
            newStart: 1,
            newLines: 3,
            header: '@@ -1,3 +1,3 @@',
            lines: [
              { type: 'delete', oldLineNumber: 1, content: 'old one' },
              { type: 'delete', oldLineNumber: 2, content: 'old two' },
              { type: 'add', newLineNumber: 1, content: 'new one' },
              { type: 'add', newLineNumber: 2, content: 'new two' },
              { type: 'normal', oldLineNumber: 3, newLineNumber: 3, content: 'same' },
            ],
          },
        ],
      },
    ];

    it.each([
      ['h', 2, 'right', 0, 'left'],
      ['h', 3, 'right', 1, 'left'],
      ['l', 0, 'left', 2, 'right'],
      ['l', 1, 'left', 3, 'right'],
    ] as const)(
      'should move %s from line %i to the line split view shows beside it',
      async (key, fromLine, fromSide, toLine, toSide) => {
        const user = userEvent.setup();
        const { result } = renderHook(
          () =>
            useKeyboardNavigation({
              files: twoForTwo,
              comments: [],
              viewMode: 'split',
              onToggleReviewed: vi.fn(),
              reviewedFiles: new Set<string>(),
              collapsedFiles: new Set<string>(),
            }),
          { wrapper },
        );

        act(() => {
          result.current.setCursorPosition({
            fileIndex: 0,
            chunkIndex: 0,
            lineIndex: fromLine,
            side: fromSide,
          });
        });

        await user.keyboard(key);

        expect(result.current.cursor).toEqual({
          fileIndex: 0,
          chunkIndex: 0,
          lineIndex: toLine,
          side: toSide,
        });
      },
    );
  });

  describe('Move to Center (.)', () => {
    it('should move cursor to the center of viewport with . key', async () => {
      const user = userEvent.setup();
      const { result } = renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments: [],
            viewMode: 'unified',
            onToggleReviewed: vi.fn(),
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
          }),
        { wrapper },
      );

      // Mock multiple elements at different positions
      const elements = [
        { id: 'file-0-chunk-0-line-0', top: 100, bottom: 150 },
        { id: 'file-0-chunk-0-line-1', top: 300, bottom: 350 },
        { id: 'file-0-chunk-0-line-2', top: 380, bottom: 430 }, // Closest to center (384)
        { id: 'file-0-chunk-0-line-3', top: 500, bottom: 550 },
      ];

      mockGetElementById.mockImplementation((id) => {
        const element = elements.find((e) => e.id === id);
        if (element) {
          return {
            getBoundingClientRect: () => ({
              top: element.top,
              bottom: element.bottom,
              height: element.bottom - element.top,
            }),
          } as any;
        }
        return null;
      });

      await user.keyboard('{.}');

      expect(result.current.cursor).toEqual({
        fileIndex: 0,
        chunkIndex: 0,
        lineIndex: 2,
        side: 'right',
      });
    });

    it.each(['Control', 'Alt', 'Meta'])('should ignore . pressed with %s', async (modifier) => {
      const user = userEvent.setup();
      const { result } = renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments: [],
            viewMode: 'unified',
            onToggleReviewed: vi.fn(),
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
          }),
        { wrapper },
      );
      mockGetElementById.mockImplementation(
        () =>
          ({
            getBoundingClientRect: () => ({ top: 380, bottom: 430, height: 50 }),
          }) as any,
      );

      await user.keyboard(`{${modifier}>}{.}{/${modifier}}`);

      expect(result.current.cursor).toBeNull();
    });
  });

  describe('Scope handling', () => {
    it('should use navigation scope for hotkeys', async () => {
      const user = userEvent.setup();
      // A modal replaces the navigation scope with its own
      const modalWrapper = ({ children }: { children: React.ReactNode }) => (
        <HotkeysProvider initiallyActiveScopes={['modal']}>{children}</HotkeysProvider>
      );
      const { result } = renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments: [],
            viewMode: 'unified',
            onToggleReviewed: vi.fn(),
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
          }),
        { wrapper: modalWrapper },
      );

      await user.keyboard('j');

      expect(result.current.cursor).toBeNull();
    });
  });

  describe('Input Field Handling', () => {
    it('should not handle shortcuts when typing in input fields', async () => {
      const user = userEvent.setup();
      const onToggleReviewed = vi.fn();

      // Create an input element
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      const { result } = renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments: [],
            viewMode: 'unified',
            onToggleReviewed,
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
            getHoveredFileIndex: () => 0,
          }),
        { wrapper },
      );

      // Outside a form field, j moves the cursor and v marks the hovered file viewed
      await user.keyboard('jv');

      expect(input.value).toBe('jv');
      expect(result.current.cursor).toBeNull();
      expect(onToggleReviewed).not.toHaveBeenCalled();

      // Cleanup
      document.body.removeChild(input);
    });

    it('should not handle shortcuts when typing in textarea', async () => {
      const user = userEvent.setup();
      const onToggleReviewed = vi.fn();

      // Create a textarea element
      const textarea = document.createElement('textarea');
      document.body.appendChild(textarea);
      textarea.focus();

      const { result } = renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments: [],
            viewMode: 'unified',
            onToggleReviewed,
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
            getHoveredFileIndex: () => 0,
          }),
        { wrapper },
      );

      // Outside a form field, j moves the cursor and v marks the hovered file viewed
      await user.keyboard('jv');

      expect(textarea.value).toBe('jv');
      expect(result.current.cursor).toBeNull();
      expect(onToggleReviewed).not.toHaveBeenCalled();

      // Cleanup
      document.body.removeChild(textarea);
    });
  });

  describe('Set Cursor Position', () => {
    it('should set cursor position when setCursorPosition is called', () => {
      const { result } = renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments: [],
            viewMode: 'unified',
            onToggleReviewed: vi.fn(),
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
          }),
        { wrapper },
      );

      const position = {
        fileIndex: 0,
        chunkIndex: 0,
        lineIndex: 1,
        side: 'right' as const,
      };

      act(() => {
        result.current.setCursorPosition(position);
      });

      expect(result.current.cursor).toEqual(position);
    });

    it('should fix side when setting cursor position in split mode', () => {
      const { result } = renderHook(
        () =>
          useKeyboardNavigation({
            files: mockFiles,
            comments: [],
            viewMode: 'split',
            onToggleReviewed: vi.fn(),
            reviewedFiles: new Set<string>(),
            collapsedFiles: new Set<string>(),
          }),
        { wrapper },
      );

      // Try to set cursor on a delete line with right side
      const position = {
        fileIndex: 0,
        chunkIndex: 0,
        lineIndex: 0, // Delete line
        side: 'right' as const,
      };

      act(() => {
        result.current.setCursorPosition(position);
      });

      // Should fix to left side since delete lines only have content on left
      expect(result.current.cursor).toEqual({
        ...position,
        side: 'left',
      });
    });
  });
});
