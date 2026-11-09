import type { BaseMode, Comment, CommentIntent, CommentThread, DiffSide } from '../types/diff';

import { hasSuggestionBlock, parseSuggestionBlocks } from './suggestionUtils.js';

function getLineInfo(line: number | number[]): string {
  return typeof line === 'number' ? `L${line}` : `L${line[0]}-L${line[1]}`;
}

interface CommentPromptOrigin {
  repo?: string;
  session?: string;
}

export interface CommentThreadPromptContext extends CommentPromptOrigin {
  reviewTabName?: string;
}

export interface CommentPromptDiffContext extends CommentPromptOrigin {
  requestedBaseCommitish?: string;
  requestedTargetCommitish?: string;
  baseMode?: BaseMode;
  resolvedBaseCommitish?: string;
  resolvedTargetCommitish?: string;
}

function formatCommentLocation(file: string, line: number | number[], side?: DiffSide): string {
  const filePath = file || '<unknown file>';
  return `${filePath}:${getLineInfo(line)}${side === 'old' ? ' (old)' : ''}`;
}

function isNonRangeCommitish(commitish: string): boolean {
  return (
    commitish === 'working' || commitish === 'staged' || commitish === '.' || commitish === 'stdin'
  );
}

function formatDiffContextRange(context: CommentPromptDiffContext): string | undefined {
  const { requestedBaseCommitish, requestedTargetCommitish } = context;
  if (
    !requestedBaseCommitish ||
    !requestedTargetCommitish ||
    isNonRangeCommitish(requestedBaseCommitish) ||
    isNonRangeCommitish(requestedTargetCommitish)
  ) {
    return undefined;
  }

  const separator = context.baseMode === 'merge-base' ? '...' : '..';
  const requestedRange = `${requestedBaseCommitish}${separator}${requestedTargetCommitish}`;
  const { resolvedBaseCommitish, resolvedTargetCommitish } = context;
  const resolvedRange =
    resolvedBaseCommitish &&
    resolvedTargetCommitish &&
    (resolvedBaseCommitish !== requestedBaseCommitish ||
      resolvedTargetCommitish !== requestedTargetCommitish)
      ? ` (${resolvedBaseCommitish}${separator}${resolvedTargetCommitish})`
      : '';

  return `${requestedRange}${resolvedRange}`;
}

function formatCommentContent(body: string, codeContent?: string): string {
  if (hasSuggestionBlock(body)) {
    const suggestions = parseSuggestionBlocks(body);
    if (suggestions.length > 0) {
      let result = '';
      let lastIndex = 0;

      for (const suggestion of suggestions) {
        const textBefore = body.slice(lastIndex, suggestion.startIndex).trim();
        if (textBefore) {
          result += `${result ? '\n' : ''}${textBefore}`;
        }

        if (codeContent) {
          result += `${result ? '\n' : ''}ORIGINAL:\n\`\`\`\n${codeContent}\n\`\`\``;
        }
        result += `${result ? '\n' : ''}SUGGESTED:\n\`\`\`\n${suggestion.suggestedCode}\n\`\`\``;
        lastIndex = suggestion.endIndex;
      }

      const textAfter = body.slice(lastIndex).trim();
      if (textAfter) {
        result += `${result ? '\n' : ''}${textAfter}`;
      }

      return result;
    }
  }

  return body;
}

function normalizeLegacyComment(comment: Comment): CommentThread {
  return {
    id: comment.id,
    file: comment.file,
    line: comment.line,
    side: comment.side,
    createdAt: comment.timestamp,
    updatedAt: comment.timestamp,
    codeContent: comment.codeContent,
    messages: [
      {
        id: comment.id,
        body: comment.body,
        author: comment.author,
        createdAt: comment.timestamp,
        updatedAt: comment.timestamp,
      },
    ],
  };
}

const QUESTION_PROMPT_MARKER = "[QUESTION — answer, don't change code]";

const WRONG_WINDOW_PROMPT_MARKER = '<ask-if>Not your diff? Ask before continuing</ask-if>';

function formatWrongWindowCheck({ repo, session }: CommentPromptOrigin): string[] {
  return repo === undefined && session === undefined ? [] : [WRONG_WINDOW_PROMPT_MARKER];
}

const INTENT_ATTRIBUTES: Record<CommentIntent, string | undefined> = {
  comment: undefined,
  question: 'question',
  change: 'change-request',
};

function escapeXmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function formatOpenTag(name: string, attributes: Record<string, string | undefined>): string {
  const rendered = Object.entries(attributes).flatMap(([key, value]) =>
    value === undefined ? [] : [` ${key}="${escapeXmlAttribute(value)}"`],
  );
  return `<${name}${rendered.join('')}>`;
}

// Tags mark the structure for the agent reading the prompt. Bodies stay unescaped because
// `&lt;T&gt;` in pasted code is harder to read, so the result is XML-style text, not valid XML.
export function formatCommentThreadPrompt(
  thread: CommentThread,
  context: CommentThreadPromptContext = {},
): string {
  const rootIntent = thread.messages[0]?.intent;
  const isQuestion = rootIntent === 'question' || (rootIntent === undefined && thread.isQuestion);
  const messages = thread.messages.map((message, index) => {
    const name = index === 0 ? 'comment' : 'reply';
    const open = formatOpenTag(name, {
      number: index === 0 ? undefined : String(index),
      author: index === 0 ? undefined : message.author?.trim() || 'Unknown',
      intent: message.intent && INTENT_ATTRIBUTES[message.intent],
    });
    return `${open}\n${formatCommentContent(message.body, thread.codeContent)}\n</${name}>`;
  });

  return [
    formatOpenTag('review-thread', {
      tab: context.reviewTabName,
      repo: context.repo,
      session: context.session,
      location:
        thread.scope === 'review'
          ? 'Review conversation'
          : formatCommentLocation(thread.file, thread.line, thread.side),
      status: thread.resolution?.resolved ? 'resolved' : undefined,
    }),
    ...formatWrongWindowCheck(context),
    ...(isQuestion ? [QUESTION_PROMPT_MARKER] : []),
    ...messages,
    '</review-thread>',
  ].join('\n');
}

export function formatAllCommentThreadsPrompt(
  threads: CommentThread[],
  context: CommentPromptDiffContext = {},
): string {
  if (threads.length === 0) return '';

  return [
    formatOpenTag('review-threads', {
      repo: context.repo,
      session: context.session,
      diff: formatDiffContextRange(context),
    }),
    ...formatWrongWindowCheck(context),
    ...threads.map((thread) => formatCommentThreadPrompt(thread)),
    '</review-threads>',
  ].join('\n');
}

export function formatCommentsOutput(input: Comment[] | CommentThread[]): string {
  const threads = input.map((item) => ('messages' in item ? item : normalizeLegacyComment(item)));
  const allPrompts = formatAllCommentThreadsPrompt(threads);

  return [
    '\n📝 Comments from review session:',
    '='.repeat(50),
    allPrompts,
    '='.repeat(50),
    `Total comments: ${threads.length}\n`,
  ].join('\n');
}
