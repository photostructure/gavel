#!/usr/bin/env node

import { Command } from 'commander';
import { type SimpleGit } from 'simple-git';

import pkg from '../../package.json' with { type: 'json' };
import { createGitClient } from '../server/git-client.js';
import { startServer } from '../server/server.js';
import { type CommentImport, type DiffSelection } from '../types/diff.js';
import { createDiffSelection } from '../utils/diffSelection.js';
import { DiffMode } from '../types/watch.js';

import {
  shouldReadStdin,
  findUntrackedFiles,
  markFilesIntentToAdd,
  promptUser,
  parseCommentOptions,
  validateDiffArguments,
  getGitRoot,
  readStdin,
} from './utils.js';
import { detectAgentSession } from './agent-session.js';
import { createCommentCommand } from './comment.js';
import { createApprovalCommand } from './approval.js';
import { createIdleCommand } from './idle.js';
import { createSchemaCommand } from './schema.js';
import { serverUrl } from './server-url.js';
import { createWaitCommand } from './wait.js';
import { createReviewCommand, resolveNamedReview } from './review.js';
import { getPrPatch, getPrCommentImports } from './github.js';
import {
  BACKGROUND_CHILD_ENV,
  emitBackgroundHandshake,
  ignoreStdioErrorsForBackgroundDaemon,
  startBackgroundProcess,
} from './background.js';

type SpecialArg = 'working' | 'staged' | '.';

function isSpecialArg(arg: string): arg is SpecialArg {
  return arg === 'working' || arg === 'staged' || arg === '.';
}

function resolveDiffSelection(
  commitish: string,
  compareWith?: string,
  mergeBase?: boolean,
): DiffSelection {
  let baseCommitish: string;

  if (compareWith) {
    baseCommitish = compareWith;
  } else if (commitish === 'working') {
    baseCommitish = 'staged';
  } else if (isSpecialArg(commitish)) {
    baseCommitish = 'HEAD';
  } else {
    baseCommitish = commitish + '^';
  }

  return createDiffSelection(baseCommitish, commitish, mergeBase ? 'merge-base' : undefined);
}

function determineDiffMode(selection: DiffSelection, compareWith?: string): DiffMode {
  const { targetCommitish } = selection;

  // If comparing specific commits/branches (not involving HEAD), no watching needed
  // Exception: allow watching when targetCommitish is '.' even with compareWith
  if (compareWith && targetCommitish !== 'HEAD' && targetCommitish !== '.') {
    return DiffMode.SPECIFIC;
  }

  if (targetCommitish === 'working') {
    return DiffMode.WORKING;
  }

  if (targetCommitish === 'staged') {
    return DiffMode.STAGED;
  }

  if (targetCommitish === '.') {
    return DiffMode.DOT;
  }
  // Default mode: HEAD^ vs HEAD or HEAD vs other commits (watch for HEAD changes)
  return DiffMode.DEFAULT;
}

interface CliOptions {
  review?: string;
  capture?: string;
  pathspec: string[];
  select: string[];
  port?: number;
  host?: string;
  open: boolean;
  comment: string[];
  pr?: string;
  clean?: boolean;
  shipIt?: boolean;
  conversation?: boolean;
  jsonl: boolean;
  commitMessage?: string;
  why?: string;
  includeUntracked?: boolean;
  keepAlive?: boolean;
  background?: boolean;
  context?: number;
  mergeBase?: boolean;
  title?: string;
  agent?: string;
  agentSessionName?: string;
  agentSessionId?: string;
}

const program = new Command();

program
  .name('gavel')
  .description('A lightweight Git diff viewer with GitHub-like interface')
  .version(pkg.version, '-v, --version', 'output the version number')
  .enablePositionalOptions()
  .addCommand(createCommentCommand())
  .addCommand(createReviewCommand())
  .addCommand(createWaitCommand())
  .addCommand(createIdleCommand())
  .addCommand(createApprovalCommand())
  .argument(
    '[commit-ish]',
    'Git commit, tag, branch, HEAD~n reference, or "working"/"staged"/"."',
    'HEAD',
  )
  .argument(
    '[compare-with]',
    'Optional: Compare with this commit/branch (shows diff between commit-ish and compare-with)',
  )
  .option('--port <port>', 'preferred port (auto-assigned if occupied)', parseInt)
  .option('--host <host>', 'host address to bind', '')
  .option('--no-open', 'do not automatically open browser')
  .option(
    '--comment <json>',
    'inject initial review comments (repeatable, accepts a JSON object or array)',
    (value: string, previous: string[]) => [...previous, value],
    [],
  )
  .option('--pr <url>', 'GitHub PR URL to review (e.g., https://github.com/owner/repo/pull/123)')
  .option('--clean', 'start with a clean slate by clearing all existing comments')
  .option('--lgtm, --ship-it', 'show approval actions: as-is or after comments are addressed', true)
  .option('--no-lgtm, --no-ship-it', 'hide approval actions')
  .option(
    '--conversation',
    'enable conversation APIs (replies, progress, snapshots); required by --jsonl',
    true,
  )
  .option('--no-conversation', 'disable agent conversations (requires --no-jsonl)')
  .option('--jsonl', 'emit review events as JSON Lines on stdout (default)', true)
  .option('--no-jsonl', 'use human-readable output instead of JSON Lines')
  .option('--commit-message <text>', 'seed the proposed commit message for the initial review')
  .option('--why <text>', 'seed a short rationale for the initial review')
  .option('--review <name>', 'start a named review of a frozen uncommitted patch')
  .option('--capture <file>', 'load a saved capture for --review')
  .option(
    '--pathspec <git-pathspec>',
    'filter a named capture with a Git pathspec; repeatable',
    (value: string, previous: string[]) => [...previous, value],
    [],
  )
  .option(
    '--select <file-or-hunk-id>',
    'select IDs from a named capture; repeatable',
    (value: string, previous: string[]) => [...previous, value],
    [],
  )
  .option('--include-untracked', 'automatically include untracked files in diff')
  .option('--keep-alive', 'keep server running even after browser disconnects')
  .option('--background', 'keep the server running in the background and output JSON info')
  .option('--context <lines>', 'number of context lines shown around each change', parseInt)
  .option(
    '--merge-base',
    'resolve the base revision with git merge-base before diffing (Git revision mode only)',
  )
  .option('--title <title>', 'custom browser tab title for this review session')
  .option(
    '--agent <name>',
    'agent host that launched this review (default: from $CLAUDE_CODE_ENTRYPOINT, the originator in the Codex thread rollout, or $AI_AGENT)',
  )
  .option('--agent-session-name <name>', 'name of the agent session that launched this review')
  .option(
    '--agent-session-id <id>',
    'ID of the agent session that launched this review (default: $CLAUDE_CODE_SESSION_ID or $CODEX_THREAD_ID)',
  )
  .addHelpText(
    'after',
    `
Review tabs:
  A review with a named capture (--review, review create) or a proposed commit
  message (--commit-message) asks for approval. While one exists, approved or
  not, the page header shows the open review's name instead of the revision
  picker, and tabs under the header switch between the reviews that ask.

Editor configuration (set before starting gavel):
  GAVEL_EDITOR          Editor preset: vscode (default), cursor, zed, textmate,
                        bbedit, emacs, macvim, sublime, nova, custom, or none.
                        Falls back to EDITOR when unset.
  GAVEL_EDITOR_COMMAND  Executable for GAVEL_EDITOR=custom.
  GAVEL_EDITOR_ARGS     Custom arguments; pass %file or %file:%line separately.
`,
  )
  .action(async (commitish: string, compareWith: string | undefined, options: CliOptions) => {
    try {
      const isBackgroundChild = process.env[BACKGROUND_CHILD_ENV] === '1';
      const backgroundMode = options.background || isBackgroundChild;
      if (options.review !== undefined && !options.conversation) {
        throw new Error('Named reviews require conversation mode; remove --no-conversation');
      }
      if (options.jsonl && !options.conversation) {
        console.error(
          'Error: --no-conversation requires --no-jsonl; JSONL events use the conversation protocol',
        );
        process.exit(1);
      }
      if (
        options.review === undefined &&
        (options.capture !== undefined || options.pathspec.length || options.select.length)
      ) {
        throw new Error('--capture, --pathspec and --select require --review');
      }
      if (
        options.review !== undefined &&
        (options.pr ||
          options.mergeBase ||
          options.context !== undefined ||
          compareWith ||
          (program.args.length > 0 && commitish !== '-'))
      ) {
        throw new Error(
          '--review accepts an uncommitted capture or positional -; --pr, --merge-base, --context and Git revision arguments are not supported',
        );
      }
      if (options.background && options.review !== undefined && commitish === '-') {
        throw new Error(
          'A background review cannot read stdin; save a capture and use --capture instead',
        );
      }
      let stdinDiff: string | undefined;
      let stdinReviewLabel = 'diff from stdin';
      let manualCommentImports: CommentImport[] = [];
      let commentImports: CommentImport[] = [];

      if (
        options.context !== undefined &&
        (!Number.isInteger(options.context) || options.context < 0)
      ) {
        console.error('Error: --context must be a non-negative integer');
        process.exit(1);
      }

      const hasPositionalArgs = program.args.length > 0;
      // Check if we should read from stdin
      const readFromStdin =
        !options.pr &&
        (options.review !== undefined
          ? commitish === '-'
          : shouldReadStdin({
              commitish,
              hasPositionalArgs,
              hasPrOption: Boolean(options.pr),
            }));

      if (readFromStdin) {
        if (options.context !== undefined) {
          console.error('Error: --context option cannot be used with stdin diff');
          process.exit(1);
        }
        if (options.mergeBase) {
          console.error('Error: --merge-base option cannot be used with stdin diff');
          process.exit(1);
        }
        // Read unified diff from stdin
        stdinDiff =
          options.review !== undefined ? await readStdin({ strictUtf8: true }) : await readStdin();
        if (!stdinDiff.trim()) {
          console.error('Error: No diff content received from stdin');
          process.exit(1);
        }
      }

      if (options.background && !isBackgroundChild) {
        await startBackgroundProcess(undefined, stdinDiff);
        return;
      }

      try {
        manualCommentImports = parseCommentOptions(options.comment);
        commentImports = manualCommentImports;
      } catch (error) {
        console.error(
          `Error: ${error instanceof Error ? error.message : 'Invalid --comment value'}`,
        );
        process.exit(1);
      }

      if (backgroundMode) {
        options.keepAlive = true;
        options.open = false;
      }

      const detectedAgent = await detectAgentSession(process.env);
      options.agent ??= detectedAgent.agent;
      options.agentSessionId ??= detectedAgent.agentSessionId;

      if (options.pr) {
        if (commitish !== 'HEAD' || compareWith) {
          console.error('Error: --pr option cannot be used with positional arguments');
          process.exit(1);
        }

        if (options.mergeBase) {
          console.error('Error: --merge-base option cannot be used with --pr');
          process.exit(1);
        }

        if (options.context !== undefined) {
          console.error('Error: --context option cannot be used with --pr');
          process.exit(1);
        }

        try {
          stdinDiff = getPrPatch(options.pr);
          stdinReviewLabel = options.pr;
        } catch (error) {
          console.error(
            `Error resolving PR: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
          process.exit(1);
        }

        try {
          const prCommentImports = await getPrCommentImports(options.pr);
          commentImports = [...prCommentImports, ...manualCommentImports];
        } catch (error) {
          console.warn(
            `Warning: Failed to load PR review comments: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
        }
      }

      if (options.review !== undefined) {
        const namedReview = await resolveNamedReview({
          name: options.review,
          patch: stdinDiff,
          captureFile: options.capture,
          pathspecs: options.pathspec,
          selectedIds: options.select,
          includeUntracked: options.includeUntracked,
        });

        const { launchUrl, port, isEmpty } = await startServer({
          namedReview,
          title: options.title,
          agent: options.agent,
          agentSessionName: options.agentSessionName,
          agentSessionId: options.agentSessionId,
          repoPath: namedReview.capture.repositoryRoot,
          preferredPort: options.port,
          host: options.host,
          openBrowser: options.open,
          clearComments: options.clean,
          shipIt: options.shipIt,
          conversation: options.conversation,
          jsonl: options.jsonl && !backgroundMode,
          onReady: backgroundMode
            ? undefined
            : ({ shutdown, port }) =>
                registerShutdownHandlers(
                  shutdown,
                  port,
                  options.jsonl,
                  options.host || 'localhost',
                ),
          commitMessage: options.commitMessage,
          why: options.why,
          keepAlive: options.keepAlive,
          diffMode: DiffMode.SPECIFIC,
          ...(commentImports.length > 0 ? { commentImports } : {}),
        });

        if (backgroundMode) {
          emitBackgroundHandshake({ port, url: launchUrl, pid: process.pid });
          if (isBackgroundChild) ignoreStdioErrorsForBackgroundDaemon();
          return;
        }
        console.error(`\n🚀 gavel server started on ${launchUrl}`);
        console.error(`📋 Reviewing: ${namedReview.name}`);
        if (isEmpty) {
          console.error(
            '\n! \x1b[33mNo differences found. Browser will not open automatically.\x1b[0m',
          );
          console.error(`   Server is running at ${launchUrl} if you want to check manually.\n`);
        }
        return;
      }

      if (stdinDiff) {
        // Start server with stdin diff (including --pr patch)

        const { launchUrl, port } = await startServer({
          stdinDiff,
          preferredPort: options.port,
          host: options.host,
          openBrowser: options.open,
          clearComments: options.clean,
          shipIt: options.shipIt,
          conversation: options.conversation,
          jsonl: options.jsonl && !backgroundMode,
          onReady: backgroundMode
            ? undefined
            : ({ shutdown, port }) =>
                registerShutdownHandlers(
                  shutdown,
                  port,
                  options.jsonl,
                  options.host || 'localhost',
                ),
          commitMessage: options.commitMessage,
          why: options.why,
          keepAlive: options.keepAlive,
          title: options.title,
          agent: options.agent,
          agentSessionName: options.agentSessionName,
          agentSessionId: options.agentSessionId,
          ...(commentImports.length > 0 ? { commentImports } : {}),
        });

        if (backgroundMode) {
          emitBackgroundHandshake({ port, url: launchUrl, pid: process.pid });
          if (isBackgroundChild) {
            ignoreStdioErrorsForBackgroundDaemon();
          }
          return;
        }
        console.error(`\n🚀 gavel server started on ${launchUrl}`);
        console.error(`📋 Reviewing: ${stdinReviewLabel}`);
        if (options.keepAlive) {
          console.error('🔒 Keep-alive mode: server will stay running after browser disconnects');
        }
        console.error('\nPress Ctrl+C to stop the server');
        return;
      }

      // Detect git root
      let repoPath: string | undefined;
      try {
        repoPath = getGitRoot();
      } catch {
        // If not in a git repository, fall back to process.cwd()
        repoPath = undefined;
      }

      const selection = resolveDiffSelection(commitish, compareWith, options.mergeBase);

      if (options.mergeBase && isSpecialArg(selection.baseCommitish)) {
        console.error(
          `Error: --merge-base requires a commit-ish base, but resolved base was "${selection.baseCommitish}"`,
        );
        process.exit(1);
      }

      if (selection.targetCommitish === 'working' || selection.targetCommitish === '.') {
        const git = createGitClient(repoPath);
        if (isBackgroundChild && !options.includeUntracked) {
          // Skip interactive prompts in detached background mode.
        } else {
          await handleUntrackedFiles(git, options.includeUntracked);
        }
      }

      const validation = validateDiffArguments(selection.targetCommitish, compareWith);
      if (!validation.valid) {
        console.error(`Error: ${validation.error}`);
        process.exit(1);
      }

      const { launchUrl, port, isEmpty } = await startServer({
        selection,
        explicitTarget: hasPositionalArgs,
        preferredPort: options.port,
        host: options.host,
        openBrowser: options.open,
        clearComments: options.clean,
        shipIt: options.shipIt,
        conversation: options.conversation,
        jsonl: options.jsonl && !backgroundMode,
        onReady: backgroundMode
          ? undefined
          : ({ shutdown, port }) =>
              registerShutdownHandlers(shutdown, port, options.jsonl, options.host || 'localhost'),
        commitMessage: options.commitMessage,
        why: options.why,
        keepAlive: options.keepAlive,
        contextLines: options.context,
        diffMode: determineDiffMode(selection, compareWith),
        repoPath,
        title: options.title,
        agent: options.agent,
        agentSessionName: options.agentSessionName,
        agentSessionId: options.agentSessionId,
        ...(commentImports.length > 0 ? { commentImports } : {}),
      });

      if (backgroundMode) {
        emitBackgroundHandshake({ port, url: launchUrl, pid: process.pid });
        if (isBackgroundChild) {
          ignoreStdioErrorsForBackgroundDaemon();
        }
        return;
      }

      console.error(`\n🚀 gavel server started on ${launchUrl}`);
      console.error(`📋 Reviewing: ${selection.targetCommitish}`);

      if (options.keepAlive) {
        console.error('🔒 Keep-alive mode: server will stay running after browser disconnects');
      }

      if (options.clean) {
        console.error('🧹 Starting with a clean slate - all existing comments will be cleared');
      }

      if (isEmpty) {
        console.error(
          '\n! \x1b[33mNo differences found. Browser will not open automatically.\x1b[0m',
        );
        console.error(`   Server is running at ${launchUrl} if you want to check manually.\n`);
      } else if (options.open) {
        console.error('🌐 Opening browser...\n');
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

program.addCommand(createSchemaCommand());
program.addHelpText(
  'after',
  `
Agent protocol:
  A foreground server emits JSONL on stdout; diagnostics and prompts use stderr.
  Use the host and API port from server.ready.url for companion commands.
  gavel schema                  JSON Schema for events and all protocol definitions
  gavel schema summary          Commit-message/TLDR edit request schema
  gavel comment reply --help    Exact-thread reply payload
  gavel comment status --help   Explicit delivery and progress receipts
  gavel comment snapshot --host <host> --port <port>  Recover current review state
  Address examples: docs/server-addresses.md
  Approval modes and completion: docs/approval-modes.md (schema approval, schema address)

Summary JSON: {"reviewId":"...","commitMessage":"fix: ...","rationale":"Short TLDR","baseVersion":0}
Comment JSON events include type, reviewId, threadId, messageId, cursor, and body.
`,
);

void program.parseAsync();

function registerShutdownHandlers(
  shutdown: (reason: 'SIGINT' | 'SIGTERM' | 'SIGHUP') => Promise<void>,
  port: number,
  jsonl: boolean,
  host: string,
): void {
  let closing = false;
  const stop = async (signal: 'SIGINT' | 'SIGTERM' | 'SIGHUP') => {
    if (closing) return;
    closing = true;
    console.error('\n👋 Shutting down gavel server...');
    let exitCode = 0;
    if (!jsonl) {
      try {
        const response = await fetch(serverUrl(host, port, '/api/comments-output'), {
          signal: AbortSignal.timeout(3000),
        });
        if (response.ok) {
          const comments = await response.text();
          if (comments.trim()) console.log(comments);
        }
      } catch {
        // Review state may already be unavailable during shutdown.
      }
    }
    try {
      await shutdown(signal);
    } catch (error) {
      console.error('Error shutting down gavel:', error instanceof Error ? error.message : error);
      exitCode = 1;
    }
    process.stdout.write('', () => process.exit(exitCode));
  };
  process.on('SIGINT', () => {
    void stop('SIGINT');
  });
  process.on('SIGTERM', () => {
    void stop('SIGTERM');
  });
  process.on('SIGHUP', () => {
    void stop('SIGHUP');
  });
}

async function handleUntrackedFiles(git: SimpleGit, addAutomatically?: boolean): Promise<void> {
  const files = await findUntrackedFiles(git);
  if (files.length === 0) {
    return;
  }

  const shouldAdd = addAutomatically || (await promptUserToIncludeUntracked(files));

  if (shouldAdd) {
    await markFilesIntentToAdd(git, files);
    console.error('✅ Files added with --intent-to-add');
    const filesAsArgs = files.join(' ');
    console.error(`   💡 To undo this, run \`git reset -- ${filesAsArgs}\``);
  } else {
    console.error('i Untracked files will not be shown in diff');
  }
}

async function promptUserToIncludeUntracked(files: string[]): Promise<boolean> {
  console.error(`\n📝 Found ${files.length} untracked file(s):`);
  for (const file of files) {
    console.error(`    - ${file}`);
  }

  return await promptUser(
    '\n❓ Would you like to include these untracked files in the diff review? (Y/n): ',
  );
}
