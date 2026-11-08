import { type Command, InvalidArgumentError } from 'commander';

import { serverUrl } from './server-url.js';

import { detectStdinSource, readStdin } from './utils.js';

function integerInRange(value: string, min: number, max: number): number {
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < min || number > max) {
    throw new InvalidArgumentError(`Expected an integer from ${min} to ${max}`);
  }
  return number;
}

async function checkResponse(response: Response): Promise<void> {
  if (response.ok) return;
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  if (body?.error) throw new Error(body.error);
  if (response.status === 404) {
    throw new Error(
      'Conversation endpoint or thread not found; start gavel with --conversation and use IDs from its events',
    );
  }
  throw new Error(`Conversation request failed (${response.status})`);
}

function reportError(error: unknown, port: number, host: string): void {
  const message =
    error instanceof TypeError && error.message.includes('fetch failed')
      ? `Cannot connect to gavel server at ${serverUrl(host, port, '/')}. Check --host and --port.`
      : error instanceof Error
        ? error.message
        : 'Conversation request failed';
  console.error(`Error: ${message}`);
  // Let buffered JSON Lines drain before exiting.
  process.exitCode = 1;
}

export function addConversationCommands(comment: Command): void {
  comment
    .command('snapshot')
    .description('Recover current conversation reviews, messages, and revision state')
    .requiredOption('--port <port>', 'port of a gavel --conversation server', (value: string) =>
      integerInRange(value, 1, 65535),
    )
    .action(async (options: { port: number; host: string }) => {
      try {
        const response = await fetch(
          serverUrl(options.host, options.port, '/api/conversation/snapshot'),
          {
            signal: AbortSignal.timeout(30000),
          },
        );
        await checkResponse(response);
        console.log(JSON.stringify(await response.json()));
      } catch (error) {
        reportError(error, options.port, options.host);
      }
    });

  comment
    .command('summary')
    .description('Update a review proposal by review ID; accepts JSON via stdin')
    .argument('[json]', 'JSON with reviewId, commitMessage, rationale, and baseVersion')
    .requiredOption('--port <port>', 'port of a gavel --conversation server', (value: string) =>
      integerInRange(value, 1, 65535),
    )
    .action(async (json: string | undefined, options: { port: number; host: string }) => {
      try {
        if (json === undefined && detectStdinSource() === 'tty') {
          throw new Error('Provide review summary JSON as an argument or via stdin');
        }
        const body: unknown = JSON.parse(json ?? (await readStdin()));
        const response = await fetch(
          serverUrl(options.host, options.port, '/api/conversation/summary'),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(30000),
          },
        );
        await checkResponse(response);
        console.log(JSON.stringify(await response.json()));
      } catch (error) {
        reportError(error, options.port, options.host);
      }
    });

  comment
    .command('status')
    .description(
      'Report delivered, read, thinking, replying, or noted for an exact comment revision; accepts JSON via stdin',
    )
    .argument('[json]', 'JSON with reviewId, threadId, messageId, cursor, and status')
    .requiredOption('--port <port>', 'port of a gavel --conversation server', (value: string) =>
      integerInRange(value, 1, 65535),
    )
    .action(async (json: string | undefined, options: { port: number; host: string }) => {
      try {
        if (json === undefined && detectStdinSource() === 'tty') {
          throw new Error('Provide status JSON as an argument or via stdin');
        }
        const body: unknown = JSON.parse(json ?? (await readStdin()));
        const response = await fetch(
          serverUrl(options.host, options.port, '/api/conversation/status'),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(30000),
          },
        );
        await checkResponse(response);
        console.log(JSON.stringify(await response.json()));
      } catch (error) {
        reportError(error, options.port, options.host);
      }
    });

  comment
    .command('address')
    .description(
      'Certify one conditional approval comment as fixed, answered, or acknowledged with evidence; accepts JSON via stdin',
    )
    .argument(
      '[json]',
      'JSON with reviewId, approvalCursor, threadId, messageId, cursor, outcome, and evidence',
    )
    .requiredOption('--port <port>', 'port of a conversation server', (value: string) =>
      integerInRange(value, 1, 65535),
    )
    .action(async (json: string | undefined, options: { port: number; host: string }) => {
      try {
        if (json === undefined && detectStdinSource() === 'tty')
          throw new Error('Provide address JSON as an argument or via stdin');
        const body: unknown = JSON.parse(json ?? (await readStdin()));
        const response = await fetch(
          serverUrl(options.host, options.port, '/api/conversation/address'),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(30000),
          },
        );
        await checkResponse(response);
        console.log(JSON.stringify(await response.json()));
      } catch (error) {
        reportError(error, options.port, options.host);
      }
    });

  comment
    .command('reply')
    .description('Reply to an exact review/thread/message using event IDs; accepts JSON via stdin')
    .argument('[json]', 'JSON with reviewId, threadId, inReplyTo, body, and optional cursor/author')
    .requiredOption('--port <port>', 'port of a gavel --conversation server', (value: string) =>
      integerInRange(value, 1, 65535),
    )
    .action(async (json: string | undefined, options: { port: number; host: string }) => {
      try {
        if (json === undefined && detectStdinSource() === 'tty') {
          throw new Error('Provide reply JSON as an argument or via stdin');
        }
        const body: unknown = JSON.parse(json ?? (await readStdin()));
        const response = await fetch(
          serverUrl(options.host, options.port, '/api/conversation/reply'),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(30000),
          },
        );
        await checkResponse(response);
        console.log(JSON.stringify(await response.json()));
      } catch (error) {
        reportError(error, options.port, options.host);
      }
    });
}
