import { describe, it, expect } from 'vitest';

import type { Comment, CommentThread } from '../types/diff';

import {
  formatCommentThreadPrompt,
  formatAllCommentThreadsPrompt,
  formatCommentsOutput,
} from './commentFormatting';

describe('commentFormatting', () => {
  describe('formatAllCommentThreadsPrompt', () => {
    const timestamp = '2024-01-01T00:00:00Z';
    const threads: CommentThread[] = [
      {
        id: 'old-thread',
        file: 'docs/SUMMARY.md',
        line: 85,
        side: 'old',
        createdAt: timestamp,
        updatedAt: timestamp,
        messages: [
          {
            id: 'old-message',
            body: 'Explain why this was removed.',
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ],
      },
      {
        id: 'new-thread',
        file: 'docs/SUMMARY.md',
        line: [242, 244],
        side: 'new',
        createdAt: timestamp,
        updatedAt: timestamp,
        messages: [
          {
            id: 'new-message',
            body: 'Should this remain grouped?',
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          {
            id: 'reply-message',
            body: 'Related entries are below.',
            author: 'Reviewer',
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ],
      },
    ];

    it('should format a merge-base range with resolved hashes', () => {
      const result = formatAllCommentThreadsPrompt(threads, {
        requestedBaseCommitish: 'main',
        requestedTargetCommitish: 'feature/docs-update',
        baseMode: 'merge-base',
        resolvedBaseCommitish: 'abcdef1',
        resolvedTargetCommitish: '1234567',
      });

      expect(result).toBe(`<review-threads diff="main...feature/docs-update (abcdef1...1234567)">
<review-thread location="docs/SUMMARY.md:L85 (old)">
<comment>
Explain why this was removed.
</comment>
</review-thread>
<review-thread location="docs/SUMMARY.md:L242-L244">
<comment>
Should this remain grouped?
</comment>
<reply number="1" author="Reviewer">
Related entries are below.
</reply>
</review-thread>
</review-threads>`);
    });

    it('should use a direct range and omit identical resolved refs', () => {
      const result = formatAllCommentThreadsPrompt([threads[1]!], {
        requestedBaseCommitish: 'abcdef1',
        requestedTargetCommitish: '1234567',
        baseMode: 'direct',
        resolvedBaseCommitish: 'abcdef1',
        resolvedTargetCommitish: '1234567',
      });

      expect(result).toBe(`<review-threads diff="abcdef1..1234567">
<review-thread location="docs/SUMMARY.md:L242-L244">
<comment>
Should this remain grouped?
</comment>
<reply number="1" author="Reviewer">
Related entries are below.
</reply>
</review-thread>
</review-threads>`);
    });

    it.each(['working', 'staged', '.', 'stdin'])(
      'should omit the header for non-range target %s',
      (target) => {
        const result = formatAllCommentThreadsPrompt([threads[0]!], {
          requestedBaseCommitish: 'HEAD',
          requestedTargetCommitish: target,
          baseMode: 'direct',
          resolvedBaseCommitish: 'abcdef1',
        });

        expect(result).toBe(`<review-threads>
<review-thread location="docs/SUMMARY.md:L85 (old)">
<comment>
Explain why this was removed.
</comment>
</review-thread>
</review-threads>`);
      },
    );

    it('should omit an incomplete resolved range', () => {
      const result = formatAllCommentThreadsPrompt([threads[1]!], {
        requestedBaseCommitish: 'main',
        requestedTargetCommitish: 'feature/docs-update',
        baseMode: 'merge-base',
        resolvedBaseCommitish: 'abcdef1',
      });

      expect(result).toContain('<review-threads diff="main...feature/docs-update">');
      expect(result).not.toContain('abcdef1');
    });

    it('should omit the header when the requested range is incomplete', () => {
      const result = formatAllCommentThreadsPrompt([threads[0]!], {
        requestedTargetCommitish: 'feature/docs-update',
        baseMode: 'merge-base',
        resolvedTargetCommitish: '1234567',
      });

      expect(result).toBe(`<review-threads>
<review-thread location="docs/SUMMARY.md:L85 (old)">
<comment>
Explain why this was removed.
</comment>
</review-thread>
</review-threads>`);
    });

    it('should keep individual thread prompts free of the diff header', () => {
      const result = formatCommentThreadPrompt(threads[0]!);
      expect(result).toBe(`<review-thread location="docs/SUMMARY.md:L85 (old)">
<comment>
Explain why this was removed.
</comment>
</review-thread>`);
    });

    it('should name the review tab on the thread', () => {
      const result = formatCommentThreadPrompt(threads[0]!, { reviewTabName: 'task-a' });
      expect(result).toBe(`<review-thread tab="task-a" location="docs/SUMMARY.md:L85 (old)">
<comment>
Explain why this was removed.
</comment>
</review-thread>`);
    });

    it('should give the repo, session, and wrong-window check on a thread', () => {
      const result = formatCommentThreadPrompt(
        { ...threads[0]!, isQuestion: true },
        { reviewTabName: 'task-a', repo: '/src/one', session: 'session-1' },
      );
      expect(result)
        .toBe(`<review-thread tab="task-a" repo="/src/one" session="session-1" location="docs/SUMMARY.md:L85 (old)">
<ask-if>Not your diff? Ask before continuing</ask-if>
[QUESTION — answer, don't change code]
<comment>
Explain why this was removed.
</comment>
</review-thread>`);
    });

    it('should give the repo, session, and check once when copying all threads', () => {
      const result = formatAllCommentThreadsPrompt(threads, {
        repo: '/src/one',
        session: 'session-1',
      });
      expect(
        result.startsWith(`<review-threads repo="/src/one" session="session-1">
<ask-if>Not your diff? Ask before continuing</ask-if>
<review-thread location=`),
      ).toBe(true);
      expect(result.split('repo=')).toHaveLength(2);
      expect(result.split('<ask-if>')).toHaveLength(2);
    });

    it('should escape attribute values but leave comment bodies readable', () => {
      const body = 'Use Array<string> & keep "quotes"';
      const message = { id: 'root', body, createdAt: timestamp, updatedAt: timestamp };
      const result = formatCommentThreadPrompt({
        id: 'escaped-thread',
        file: 'src/a&b.ts',
        line: 85,
        side: 'old',
        createdAt: timestamp,
        updatedAt: timestamp,
        messages: [message, { ...message, id: 'reply', author: 'A "B" <c>' }],
      });
      expect(result).toBe(`<review-thread location="src/a&amp;b.ts:L85 (old)">
<comment>
${body}
</comment>
<reply number="1" author="A &quot;B&quot; &lt;c&gt;">
${body}
</reply>
</review-thread>`);
    });

    it('should mark question threads so the agent answers instead of editing', () => {
      const result = formatCommentThreadPrompt({ ...threads[0]!, isQuestion: true });
      expect(result).toBe(`<review-thread location="docs/SUMMARY.md:L85 (old)">
[QUESTION — answer, don't change code]
<comment>
Explain why this was removed.
</comment>
</review-thread>`);
    });

    describe('suggestion blocks', () => {
      const suggestionThread = {
        id: 'suggestion-thread',
        file: 'src/file.ts',
        line: 10,
        createdAt: timestamp,
        updatedAt: timestamp,
        messages: [
          {
            id: 'suggestion-message',
            body: 'Please refactor this:\n```suggestion\nconst better = true;\n```',
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ],
      };

      it('should keep the surrounding text and show the original code', () => {
        const result = formatCommentThreadPrompt({
          ...suggestionThread,
          codeContent: 'const old = false;',
        });
        expect(result).toBe(`<review-thread location="src/file.ts:L10">
<comment>
Please refactor this:
ORIGINAL:
\`\`\`
const old = false;
\`\`\`
SUGGESTED:
\`\`\`
const better = true;
\`\`\`
</comment>
</review-thread>`);
      });

      it('should leave out ORIGINAL without a code snapshot', () => {
        const result = formatCommentThreadPrompt(suggestionThread);
        expect(result).toBe(`<review-thread location="src/file.ts:L10">
<comment>
Please refactor this:
SUGGESTED:
\`\`\`
const better = true;
\`\`\`
</comment>
</review-thread>`);
      });
    });
  });

  describe('formatCommentsOutput', () => {
    it('should format empty comments with header and footer', () => {
      const result = formatCommentsOutput([]);
      const lines = result.split('\n');
      expect(lines[0]).toBe('');
      expect(lines[1]).toBe('📝 Comments from review session:');
      expect(lines[2]).toBe('='.repeat(50));
      expect(lines[3]).toBe('');
      expect(lines[4]).toBe('='.repeat(50));
      expect(lines[5]).toBe('Total comments: 0');
    });

    it('should format single comment with header and footer', () => {
      const comments: Comment[] = [
        {
          id: '1',
          file: 'src/App.tsx',
          line: 10,
          body: 'Fix this issue',
          timestamp: '2024-01-01T00:00:00Z',
        },
      ];
      const result = formatCommentsOutput(comments);
      expect(result).toContain('📝 Comments from review session:');
      expect(result).toContain(
        '<review-thread location="src/App.tsx:L10">\n<comment>\nFix this issue\n</comment>',
      );
      expect(result).toContain('Total comments: 1');
      expect(result).toContain('='.repeat(50));
    });

    it('should format multiple comments with separators', () => {
      const comments: Comment[] = [
        {
          id: '1',
          file: 'src/App.tsx',
          line: 10,
          body: 'First issue',
          timestamp: '2024-01-01T00:00:00Z',
        },
        {
          id: '2',
          file: 'src/utils/helper.ts',
          line: [20, 30],
          body: 'Second issue',
          timestamp: '2024-01-01T00:01:00Z',
        },
        {
          id: '3',
          file: 'src/components/Button.tsx',
          line: 42,
          body: 'Third issue',
          timestamp: '2024-01-01T00:02:00Z',
        },
      ];
      const result = formatCommentsOutput(comments);

      expect(result).toContain('📝 Comments from review session:');
      expect(result).toContain('location="src/App.tsx:L10">\n<comment>\nFirst issue');
      expect(result).toContain('</review-thread>\n<review-thread location="src/utils/helper.ts');
      expect(result).toContain('location="src/utils/helper.ts:L20-L30">\n<comment>\nSecond issue');
      expect(result).toContain('location="src/components/Button.tsx:L42">\n<comment>\nThird issue');
      expect(result).toContain('Total comments: 3');
    });

    it('should handle comments with multi-line bodies', () => {
      const comments: Comment[] = [
        {
          id: '1',
          file: 'src/complex.ts',
          line: [100, 200],
          body: 'This is a complex issue that\nspans multiple lines\nand needs attention',
          timestamp: '2024-01-01T00:00:00Z',
        },
      ];
      const result = formatCommentsOutput(comments);

      expect(result).toContain('src/complex.ts:L100-L200');
      expect(result).toContain(
        'This is a complex issue that\nspans multiple lines\nand needs attention',
      );
      expect(result).toContain('Total comments: 1');
    });
  });
});

it('puts each reply intent on its tag in a resolved general conversation', () => {
  const time = '2026-10-24T00:00:00Z';
  expect(
    formatCommentThreadPrompt({
      id: 'review-thread',
      scope: 'review',
      createdAt: time,
      updatedAt: time,
      resolution: { resolved: true, updatedAt: time },
      messages: [
        { id: 'root', body: 'Root comment', createdAt: time, updatedAt: time },
        {
          id: 'question',
          author: 'User',
          intent: 'question',
          body: 'Why?',
          createdAt: time,
          updatedAt: time,
        },
        {
          id: 'change',
          author: 'User',
          intent: 'change',
          body: 'Please change this.',
          createdAt: time,
          updatedAt: time,
        },
      ],
    }),
  ).toBe(`<review-thread location="Review conversation" status="resolved">
<comment>
Root comment
</comment>
<reply number="1" author="User" intent="question">
Why?
</reply>
<reply number="2" author="User" intent="change-request">
Please change this.
</reply>
</review-thread>`);
});

it.each(['comment', 'change', 'question'] as const)(
  'uses explicit %s intent over a conflicting legacy question flag',
  (intent) => {
    const time = '2026-10-27T00:00:00Z';
    const prompt = formatCommentThreadPrompt({
      id: 'legacy-choice',
      scope: 'review',
      createdAt: time,
      updatedAt: time,
      isQuestion: intent !== 'question',
      messages: [{ id: 'root', body: 'Review feedback', intent, createdAt: time, updatedAt: time }],
    });
    expect(prompt.includes("[QUESTION — answer, don't change code]")).toBe(intent === 'question');
  },
);
