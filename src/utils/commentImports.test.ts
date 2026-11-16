import { describe, expect, it, vi } from 'vitest';

import type {
  CommentImport,
  DiffCommentThread,
  DiffLineRange,
  ThreadCommentImport,
} from '../types/diff';
import type { CapturedFile } from '../types/review';

import {
  commentsOutsideHunks,
  mergeCommentImports,
  mergeCommentThreads,
  parseCommentImportValue,
  serializeCommentImports,
} from './commentImports';

function createThread({
  id,
  filePath = 'src/example.ts',
  side = 'new',
  line = 10,
  body,
  updatedAt = '2024-01-01T00:00:00.000Z',
}: {
  id: string;
  filePath?: string;
  side?: 'old' | 'new';
  line?: number;
  body: string;
  updatedAt?: string;
}): DiffCommentThread {
  return {
    id,
    filePath,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt,
    position: {
      side,
      line,
    },
    messages: [
      {
        id,
        body,
        author: 'User',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt,
      },
    ],
  };
}

describe('commentImports', () => {
  describe('parseCommentImportValue', () => {
    it('parses a single thread import', () => {
      const imports = parseCommentImportValue(
        JSON.stringify({
          type: 'thread',
          filePath: 'src/example.ts',
          position: { side: 'new', line: 10 },
          body: 'Review comment',
        }),
      );

      expect(imports).toEqual([
        {
          type: 'thread',
          filePath: 'src/example.ts',
          position: { side: 'new', line: 10 },
          body: 'Review comment',
          id: undefined,
          author: undefined,
          createdAt: undefined,
          updatedAt: undefined,
          codeSnapshot: undefined,
        },
      ]);
    });

    it('parses an array of imports', () => {
      const imports = parseCommentImportValue(
        JSON.stringify([
          {
            type: 'thread',
            filePath: 'src/example.ts',
            position: { side: 'new', line: 10 },
            body: 'Root',
          },
          {
            type: 'reply',
            filePath: 'src/example.ts',
            position: { side: 'new', line: 10 },
            body: 'Reply',
          },
        ]),
      );

      expect(imports).toHaveLength(2);
      expect(imports[0]?.type).toBe('thread');
      expect(imports[1]?.type).toBe('reply');
    });

    it('rejects malformed json', () => {
      expect(() => parseCommentImportValue('{')).toThrow('Invalid --comment JSON');
    });

    it('rejects invalid import shape', () => {
      expect(() =>
        parseCommentImportValue(
          JSON.stringify({
            type: 'thread',
            filePath: '',
            position: { side: 'new', line: 0 },
            body: '',
          }),
        ),
      ).toThrow('Invalid comment import field: filePath');
    });
  });

  describe('serializeCommentImports', () => {
    it('creates a stable payload string for hashing', () => {
      const commentImports: CommentImport[] = [
        {
          type: 'thread',
          id: 'thread-1',
          filePath: 'src/example.ts',
          position: { side: 'new', line: { start: 10, end: 12 } },
          body: 'Root',
          author: 'AI',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          codeSnapshot: { content: 'const value = 1;' },
        },
      ];

      expect(serializeCommentImports(commentImports)).toBe(
        JSON.stringify([
          {
            type: 'thread',
            id: 'thread-1',
            filePath: 'src/example.ts',
            position: { side: 'new', line: { start: 10, end: 12 } },
            body: 'Root',
            author: 'AI',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
            codeSnapshot: { content: 'const value = 1;', language: undefined },
          },
        ]),
      );
    });
  });

  it('retains general scope, intent, and newer resolution across stale merges', () => {
    const base = createThread({ id: 'general', body: 'Question' });
    const general: DiffCommentThread = {
      id: base.id,
      scope: 'review',
      createdAt: base.createdAt,
      updatedAt: base.updatedAt,
      messages: base.messages.map((message) => ({ ...message, intent: 'question' as const })),
      resolution: { resolved: false, updatedAt: '2024-03-01T00:00:00.000Z' },
    };
    const stale: DiffCommentThread = {
      ...general,
      resolution: { resolved: true, updatedAt: '2024-02-01T00:00:00.000Z' },
    };
    for (const merged of [
      mergeCommentThreads([general], [stale]).threads,
      mergeCommentThreads([stale], [general]).threads,
    ]) {
      expect(merged).toHaveLength(1);
      expect(merged[0]).toMatchObject({
        scope: 'review',
        resolution: general.resolution,
        messages: [{ intent: 'question' }],
      });
      expect(merged[0]).not.toHaveProperty('position');
      expect(merged[0]).not.toHaveProperty('filePath');
    }
  });

  describe('mergeCommentImports', () => {
    it('adds a new thread import', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-02-01T00:00:00.000Z'));

      const result = mergeCommentImports(
        [],
        [
          {
            type: 'thread',
            filePath: 'src/example.ts',
            position: { side: 'new', line: 10 },
            body: 'Imported thread',
          },
        ],
      );

      expect(result.warnings).toEqual([]);
      expect(result.threads).toHaveLength(1);
      expect(result.threads[0]?.messages[0]?.body).toBe('Imported thread');

      vi.useRealTimers();
    });

    it('skips a duplicate thread import with the same root message', () => {
      const existing = [createThread({ id: 'thread-1', body: 'Imported thread' })];

      const result = mergeCommentImports(existing, [
        {
          type: 'thread',
          filePath: 'src/example.ts',
          position: { side: 'new', line: 10 },
          body: 'Imported thread',
          author: 'User',
        },
      ]);

      expect(result.threads).toHaveLength(1);
    });

    it('adds a reply to the newest matching thread', () => {
      const olderThread = createThread({
        id: 'thread-1',
        body: 'Root 1',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
      const newerThread = createThread({
        id: 'thread-2',
        body: 'Root 2',
        updatedAt: '2024-01-02T00:00:00.000Z',
      });

      const result = mergeCommentImports(
        [olderThread, newerThread],
        [
          {
            type: 'reply',
            filePath: 'src/example.ts',
            position: { side: 'new', line: 10 },
            body: 'Imported reply',
            author: 'AI',
          },
        ],
      );

      expect(result.threads[0]?.messages).toHaveLength(1);
      expect(result.threads[1]?.messages).toHaveLength(2);
      expect(result.threads[1]?.messages[1]?.body).toBe('Imported reply');
    });

    it('skips a duplicate reply import', () => {
      const existing = createThread({ id: 'thread-1', body: 'Root' });
      existing.messages.push({
        id: 'reply-1',
        body: 'Imported reply',
        author: 'AI',
        createdAt: '2024-01-02T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      });

      const result = mergeCommentImports(
        [existing],
        [
          {
            type: 'reply',
            id: 'reply-1',
            filePath: 'src/example.ts',
            position: { side: 'new', line: 10 },
            body: 'Imported reply',
            author: 'AI',
          },
        ],
      );

      expect(result.threads[0]?.messages).toHaveLength(2);
    });

    it('warns and skips reply import when no matching thread exists', () => {
      const result = mergeCommentImports(
        [],
        [
          {
            type: 'reply',
            filePath: 'src/example.ts',
            position: { side: 'new', line: 10 },
            body: 'Imported reply',
          },
        ],
      );

      expect(result.threads).toEqual([]);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('Skipped reply import');
    });
  });

  describe('commentsOutsideHunks', () => {
    // The no-close review: App.tsx line 1593 came from the file on a newer main, outside every hunk.
    const files: CapturedFile[] = [
      {
        id: 'f1',
        path: 'src/App.tsx',
        hunks: [
          { id: 'h1', oldStart: 1528, oldLines: 7, newStart: 1531, newLines: 7 },
          { id: 'h2', oldStart: 1590, oldLines: 4, newStart: 1600, newLines: 0 },
        ],
      },
      { id: 'f2', path: 'image.png', hunks: [] },
      // A file turned into a symlink: Git writes a deletion and an addition for one path.
      {
        id: 'f3',
        path: 'link',
        hunks: [{ id: 'h3', oldStart: 1, oldLines: 2, newStart: 0, newLines: 0 }],
      },
      {
        id: 'f4',
        path: 'link',
        hunks: [{ id: 'h4', oldStart: 0, oldLines: 0, newStart: 1, newLines: 1 }],
      },
    ];
    const thread = (
      filePath: string,
      side: 'old' | 'new',
      line: DiffLineRange,
    ): ThreadCommentImport => ({ type: 'thread', filePath, position: { side, line }, body: 'b' });

    it('accepts threads inside one hunk on the side they name, and replies anywhere', () => {
      expect(
        commentsOutsideHunks(
          [
            thread('src/App.tsx', 'new', 1531),
            thread('src/App.tsx', 'new', { start: 1534, end: 1537 }),
            thread('src/App.tsx', 'old', 1593),
            thread('link', 'old', 2),
            thread('link', 'new', 1),
            { ...thread('src/App.tsx', 'new', 1593), type: 'reply' },
          ],
          files,
        ),
      ).toBeUndefined();
    });

    it('refuses lines outside every hunk, ranges across hunks, and files the review lacks', () => {
      const refusal = commentsOutsideHunks(
        [
          thread('src/App.tsx', 'new', 1593),
          thread('src/App.tsx', 'new', 1530),
          thread('src/App.tsx', 'old', { start: 1530, end: 1590 }),
          thread('image.png', 'new', 1),
          thread('src/other.ts', 'new', 1),
          thread('src/App.tsx', 'new', 1531),
        ],
        files,
      );
      expect(refusal?.split('\n')).toEqual([
        'No comments were added: a named review shows only its hunks, numbered as its patch numbers them, and these comments fall outside them:',
        'src/App.tsx new line 1593: its new-side hunks are at 1531-1537',
        'src/App.tsx new line 1530: its new-side hunks are at 1531-1537',
        'src/App.tsx old lines 1530-1590: its old-side hunks are at 1528-1534, 1590-1593',
        'image.png new line 1: the review has no new-side lines of this file',
        'src/other.ts new line 1: the review has no such file',
      ]);
    });
  });
});

// Bootstrap treats the first argument as the server snapshot. Progress must not
// come from persisted browser data. Run: pnpm test src/utils/commentImports.test.ts
it('keeps server progress when restoring cached comments and clears it on local edits', () => {
  const server = createThread({ id: 'question', body: 'Why?' });
  server.messages[0]!.progress = {
    status: 'thinking',
    cursor: 'new:1',
    updatedAt: server.updatedAt,
  };
  const cached = structuredClone(server);
  cached.messages[0]!.progress = { status: 'read', cursor: 'old:1', updatedAt: cached.updatedAt };
  expect(mergeCommentThreads([server], [cached]).threads[0]!.messages[0]!.progress).toEqual(
    server.messages[0]!.progress,
  );
  expect(mergeCommentThreads([], [cached]).threads[0]!.messages[0]!.progress).toBeUndefined();
  cached.messages[0]!.body = 'Edited question';
  expect(mergeCommentThreads([server], [cached]).threads[0]!.messages[0]!.progress).toBeUndefined();
});
it('merges review-wide replies in either order without inventing a location', () => {
  const root = createThread({ id: 'general', body: 'Review-wide discussion' });
  const general: DiffCommentThread = {
    id: root.id,
    scope: 'review',
    createdAt: root.createdAt,
    updatedAt: root.updatedAt,
    messages: root.messages,
  };
  const replied = {
    ...general,
    updatedAt: '2024-02-01T00:00:00Z',
    messages: [
      ...general.messages,
      {
        id: 'reply',
        body: 'Reply',
        createdAt: '2024-02-01T00:00:00Z',
        updatedAt: '2024-02-01T00:00:00Z',
      },
    ],
  };
  for (const merged of [
    mergeCommentThreads([general], [replied]),
    mergeCommentThreads([replied], [general]),
  ]) {
    expect(merged.threads).toHaveLength(1);
    expect(merged.threads[0]).toMatchObject({
      scope: 'review',
      messages: [{ body: 'Review-wide discussion' }, { body: 'Reply' }],
    });
    expect(merged.threads[0]).not.toHaveProperty('position');
    expect(merged.threads[0]).not.toHaveProperty('filePath');
  }
  const imported = mergeCommentImports(
    [general],
    [
      {
        type: 'thread',
        filePath: 'src/example.ts',
        position: { side: 'new', line: 10 },
        body: 'Inline comment',
      },
      {
        type: 'reply',
        filePath: 'src/example.ts',
        position: { side: 'new', line: 10 },
        body: 'Inline reply',
      },
    ],
  );
  expect(imported.threads).toHaveLength(2);
  expect(imported.threads[0]).toEqual(general);
  expect(imported.threads[1]!.messages).toHaveLength(2);
  expect(imported.warnings).toEqual([]);
});

it.each(['review', 'line'] as const)(
  'keeps the newest %s question setting regardless of merge order',
  (scope) => {
    const inline = createThread({ id: 'question', body: 'Why?' });
    const original: DiffCommentThread =
      scope === 'review'
        ? {
            id: inline.id,
            scope,
            messages: inline.messages,
            createdAt: inline.createdAt,
            updatedAt: inline.updatedAt,
          }
        : inline;
    const question = { ...original, isQuestion: true, updatedAt: '2024-01-02T00:00:00.000Z' };
    const normal = { ...question, isQuestion: undefined, updatedAt: '2024-01-03T00:00:00.000Z' };
    for (const [older, newer] of [
      [original, question],
      [question, normal],
    ] as const) {
      for (const [existing, incoming] of [
        [older, newer],
        [newer, older],
      ] as const) {
        expect(mergeCommentThreads([existing], [incoming]).threads[0]?.isQuestion).toBe(
          newer.isQuestion,
        );
      }
    }
  },
);
