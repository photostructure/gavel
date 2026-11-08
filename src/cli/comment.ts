import { Command, Option } from 'commander';

import { parseCommentImportValue } from '../utils/commentImports.js';

import { detectStdinSource, readStdin } from './utils.js';
import { addConversationCommands } from './conversation.js';
import { parseServerPort, serverUrl } from './server-url.js';

interface CommentAddOptions {
  host: string;
  port: number;
  review?: string;
}

interface CommentImportResponse {
  success?: boolean;
  importId?: string;
  count?: number;
  warnings?: string[];
}

function handleCommandError(error: unknown, port: number, host: string): never {
  if (error instanceof TypeError && error.message.includes('fetch failed')) {
    console.error(
      `Error: Cannot connect to gavel server at ${serverUrl(host, port, '/')}. Check --host and --port.`,
    );
  } else {
    console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
  process.exit(1);
}

async function parseCommentAddInput(json?: string): Promise<string> {
  if (typeof json === 'string') {
    return json;
  }

  if (detectStdinSource() === 'tty') {
    throw new Error('Provide comment JSON as an argument or via stdin');
  }

  const stdin = await readStdin();
  if (!stdin.trim()) {
    throw new Error('No comment JSON received from stdin');
  }

  return stdin;
}

export function createCommentCommand(): Command {
  const comment = new Command('comment').description(
    'Add, retrieve, or resolve comments on a running gavel server',
  );
  addConversationCommands(comment);

  comment
    .command('add')
    .description('Add comments to a running gavel server')
    .argument('[json]', 'comment import JSON (object or array)')
    .requiredOption('--port <port>', 'port of the running gavel server', parseServerPort)
    .option(
      '--review <name>',
      'named review to add the comments to (default: the review the viewer last loaded)',
    )
    .action(async (json: string | undefined, opts: CommentAddOptions) => {
      try {
        const input = await parseCommentAddInput(json);
        const imports = parseCommentImportValue(input);
        const path =
          opts.review === undefined
            ? '/api/comment-imports'
            : `/api/comment-imports?review=${encodeURIComponent(opts.review)}`;

        const response = await fetch(serverUrl(opts.host, opts.port, path), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(imports),
        });

        if (!response.ok) {
          const errorBody = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          console.error(`Error: ${errorBody.error ?? 'Failed to add comments'}`);
          process.exit(1);
        }

        const result = (await response.json()) as CommentImportResponse;
        console.log(
          JSON.stringify({
            success: result.success ?? true,
            importId: result.importId,
            count: result.count ?? imports.length,
            warnings: result.warnings ?? [],
          }),
        );
      } catch (error) {
        handleCommandError(error, opts.port, opts.host);
      }
    });

  comment
    .command('get')
    .description('Retrieve comments from a running gavel server')
    .requiredOption('--port <port>', 'port of the running gavel server', parseServerPort)
    .addOption(
      new Option('--format <format>', 'output format').choices(['text', 'json']).default('text'),
    )
    .action(async (opts: { host: string; port: number; format: string }) => {
      try {
        const endpoint = opts.format === 'json' ? '/api/comments-json' : '/api/comments-output';
        const response = await fetch(serverUrl(opts.host, opts.port, endpoint));

        if (!response.ok) {
          console.error('Error: Failed to retrieve comments');
          process.exit(1);
        }

        if (opts.format === 'json') {
          const data: unknown = await response.json();
          console.log(JSON.stringify(data));
        } else {
          const text = await response.text();
          if (text.trim()) {
            console.log(text);
          }
        }
      } catch (error) {
        handleCommandError(error, opts.port, opts.host);
      }
    });

  for (const action of ['resolve', 'reopen', 'delete'] as const) {
    const command = comment.command(action);
    if (action === 'delete') command.alias('remove');
    else command.option('--review <reviewId>', 'review ID from a conversation event');
    command
      .description(
        {
          resolve: 'Mark comment threads resolved while preserving their messages',
          reopen: 'Reopen resolved comment threads while preserving their messages',
          delete: 'Delete comment threads from the current review selection',
        }[action],
      )
      .argument('<threadIds...>', 'thread IDs')
      .requiredOption('--port <port>', 'port of the running gavel server', parseServerPort)
      .action(
        async (threadIds: string[], opts: { host: string; port: number; review?: string }) => {
          try {
            const results = await Promise.all(
              threadIds.map(
                async (
                  threadId,
                ): Promise<{
                  threadId: string;
                  status: 'ok' | 'notFound' | 'error';
                  error?: string;
                }> => {
                  const response = await fetch(
                    serverUrl(
                      opts.host,
                      opts.port,
                      `/api/comments/${encodeURIComponent(threadId)}${action === 'delete' ? '' : '/resolution'}`,
                    ),
                    action === 'delete'
                      ? { method: 'DELETE' }
                      : {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            resolved: action === 'resolve',
                            reviewId: opts.review,
                          }),
                        },
                  );

                  if (response.ok) {
                    return { threadId, status: 'ok' };
                  }

                  const errorBody = (await response.json().catch(() => ({}))) as {
                    error?: string;
                  };
                  if (
                    response.status === 404 &&
                    (action === 'delete' || errorBody.error?.startsWith('Thread not found'))
                  ) {
                    return { threadId, status: 'notFound' };
                  }
                  return {
                    threadId,
                    status: 'error',
                    error: errorBody.error ?? `Failed to ${action} thread ${threadId}`,
                  };
                },
              ),
            );

            const completed = results.filter((r) => r.status === 'ok').map((r) => r.threadId);
            const notFound = results.filter((r) => r.status === 'notFound').map((r) => r.threadId);
            const errors = results
              .filter((r) => r.status === 'error')
              .map((r) => ({
                threadId: r.threadId,
                error: r.error ?? `Failed to ${action} thread ${r.threadId}`,
              }));

            console.log(
              JSON.stringify({
                success: notFound.length === 0 && errors.length === 0,
                [action === 'resolve' ? 'resolved' : action === 'reopen' ? 'reopened' : 'deleted']:
                  completed,
                notFound,
                errors,
              }),
            );
            if (notFound.length > 0 || errors.length > 0) {
              process.exit(1);
            }
          } catch (error) {
            handleCommandError(error, opts.port, opts.host);
          }
        },
      );
  }

  for (const command of comment.commands)
    command.option('--host <host>', 'server hostname or IP address', 'localhost');
  return comment;
}
