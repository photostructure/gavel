import { Command, InvalidArgumentError } from 'commander';
import { randomUUID } from 'node:crypto';

import { serverUrl } from './server-url.js';

import type {
  ConversationBatch,
  ConversationSnapshot,
  ConversationStreamEvent,
  WaitResult,
} from '../types/conversation.js';

class WaitError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
  ) {
    super(message);
  }
}

function collectPort(value: string, ports: number[] = []): number[] {
  const port = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new InvalidArgumentError('Expected an integer from 1 to 65535');
  return [...ports, port];
}

function isActionable(event: ConversationStreamEvent): boolean {
  return (
    event.origin === 'user' &&
    (event.type === 'comment.created' ||
      event.type === 'comment.updated' ||
      event.type === 'review.approval')
  );
}

async function request<T>(
  port: number,
  path: string,
  signal: AbortSignal,
  host: string,
): Promise<T> {
  const url = serverUrl(host, port, `/api/conversation/${path}`);
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
    });
    // Read the body under the same deadline as the headers.
    const body = (await response.json().catch((error: unknown) => {
      if (error instanceof SyntaxError) return null;
      throw error;
    })) as (T & { error?: string }) | null;
    if (response.status === 409)
      throw new WaitError(
        `Port ${port}: ${body?.error ?? 'Cursor no longer valid'}; run comment snapshot before waiting again`,
        3,
      );
    if (response.status === 404)
      throw new WaitError(
        `Port ${port}: this server does not support conversation waiting; it needs a build with /api/conversation/events and conversation mode enabled`,
        1,
      );
    if (!response.ok)
      throw new WaitError(
        `Port ${port}: ${body?.error ?? `Conversation request failed (${response.status})`}`,
        1,
      );
    if (!body) throw new WaitError(`Port ${port}: invalid conversation response`, 1);
    return body;
  } catch (error) {
    if (error instanceof WaitError) throw error;
    throw new WaitError(
      `Port ${port}: conversation connection failed (server exited or request failed); inspect the server before waiting again`,
      2,
    );
  }
}

/** Recover work that predates the subscription without acknowledging its delivery. */
function queuedMessages(snapshot: ConversationSnapshot): ConversationStreamEvent[] {
  return snapshot.reviews.flatMap((review) =>
    review.threads.flatMap((thread) =>
      thread.messages.flatMap((message): ConversationStreamEvent[] => {
        if (message.progress?.status !== 'queued') return [];
        return [
          {
            type: 'comment.updated',
            origin: 'user',
            cursor: message.progress.cursor,
            reviewId: review.id,
            selection: review.selection,
            threadId: thread.id,
            messageId: message.id,
            body: message.body,
            intent: message.intent,
            author: message.author,
            scope: thread.scope,
            file: thread.filePath,
            side: thread.position?.side,
            line: thread.position?.line,
            codeSnapshot: thread.codeSnapshot,
            capture: review.capture,
            anchorCapture: thread.capture,
            timestamp: message.updatedAt,
          },
        ];
      }),
    ),
  );
}

async function waitForPort(
  port: number,
  after: string | undefined,
  signal: AbortSignal,
  onPresence: (connected: boolean, cursor: string) => void | Promise<void>,
  host: string,
): Promise<WaitResult> {
  const snapshot = await request<ConversationSnapshot>(port, 'snapshot', signal, host);
  if (typeof snapshot.cursor !== 'string' || !Array.isArray(snapshot.reviews))
    throw new WaitError(`Port ${port}: invalid conversation snapshot`, 1);
  const queued = queuedMessages(snapshot);
  if (!snapshot.presence)
    throw new WaitError(
      `Port ${port}: reviewer presence is unavailable; use a server build that reports presence instead of waiting blindly`,
      1,
    );
  let connected = snapshot.presence.reviewers.connected;
  if (connected) await onPresence(true, snapshot.cursor);
  let initial = true;
  const listener = randomUUID();
  let cursor = after ?? snapshot.cursor;
  while (!signal.aborted) {
    const query = new URLSearchParams({
      after: cursor,
      wait: queued.length || (initial && !connected) ? '0' : '25000',
      listener,
    });
    initial = false;
    const batch = await request<ConversationBatch>(port, `events?${query}`, signal, host);
    if (typeof batch.cursor !== 'string' || !Array.isArray(batch.events))
      throw new WaitError(`Port ${port}: invalid conversation event batch`, 1);
    // Keep stream cursors separate from the exact revision cursors used for receipts.
    cursor = batch.cursor;
    const events = [
      ...new Map(
        [...queued, ...batch.events.filter(isActionable)].map((event) => [event.cursor, event]),
      ).values(),
    ];
    if (events.length) return { type: 'wait.events', port, events, cursor };
    if (!batch.presence)
      throw new WaitError(`Port ${port}: event response does not report reviewer presence`, 1);
    connected = batch.presence.reviewers.connected;
    await onPresence(connected > 0, cursor);
    // Empty HTTP rounds and agent-only batches stay inside this process, silently.
  }
  throw new Error('Wait cancelled');
}

export function createWaitCommand(): Command {
  return new Command('wait')
    .description(
      'Wait silently for human review activity on one or more servers, then print one JSON batch',
    )
    .option('--host <host>', 'server hostname or IP address', 'localhost')
    .requiredOption('--port <port>', 'API port to wait on; repeat for several servers', collectPort)
    .option(
      '--after <cursor>',
      'resume after a cursor; use port=cursor for several servers (repeatable)',
      (value: string, previous: string[]) => [...previous, value],
      [],
    )
    .addHelpText(
      'after',
      `
There is no overall timeout. Empty HTTP responses, agent replies/progress, thread
changes and deletions do not finish the wait or produce output. Queued messages
are recovered from a snapshot on every invocation; no delivery receipt is sent.
Without --after, approval changes are watched from attachment onward.
Save the result's port and cursor and pass them to --after on the next invocation
to include changes made between waits. Keep each server's last returned cursor.
Expired/restarted cursors require explicit snapshot reconciliation.

Exit codes: 0 = nonempty human-event batch; 1 = usage/protocol error;
2 = connection failure/server exit; 3 = cursor reconciliation required.
4 = no reviewer connected on any selected server; end the turn, do not retry.
Queued comments and replayed human events are returned before the presence guard.
Presence changes never count as human work. Hidden connected tabs remain connected.
Run one background command in the owning main session, without a shell timeout.
`,
    )
    .action(async (options: { port: number[]; after: string[]; host: string }) => {
      const abort = new AbortController();
      try {
        const ports = [...new Set(options.port)];
        const cursors = new Map<number, string>();
        for (const value of options.after) {
          const separator = value.indexOf('=');
          const port =
            separator < 0
              ? ports.length === 1
                ? ports[0]
                : undefined
              : Number(value.slice(0, separator));
          const cursor = separator < 0 ? value : value.slice(separator + 1);
          if (port === undefined || !ports.includes(port) || !cursor || cursors.has(port))
            throw new WaitError(
              'Use one --after cursor for a single port, or --after port=cursor once per selected port',
              1,
            );
          cursors.set(port, cursor);
        }
        const result = await new Promise<WaitResult>((resolve, reject) => {
          const attendance = new Map<number, { connected: boolean; cursor: string }>();
          let confirmingAbsence = false;
          let absenceCheck: Promise<void> | undefined;
          for (const port of ports) {
            void waitForPort(
              port,
              cursors.get(port),
              abort.signal,
              (connected, cursor) => {
                attendance.set(port, { connected, cursor });
                if (confirmingAbsence) return absenceCheck;
                if (
                  attendance.size !== ports.length ||
                  [...attendance.values()].some((state) => state.connected)
                )
                  return;
                confirmingAbsence = true;
                // Another port may have received feedback since its last empty round.
                // Drain fresh state before ending the whole multi-server subscription.
                absenceCheck = Promise.all(
                  ports.map(async (candidate) => {
                    const state = await request<ConversationSnapshot>(
                      candidate,
                      'snapshot',
                      abort.signal,
                      options.host,
                    );
                    const query = new URLSearchParams({
                      after: attendance.get(candidate)?.cursor ?? state.cursor,
                      wait: '0',
                    });
                    const batch = await request<ConversationBatch>(
                      candidate,
                      `events?${query}`,
                      abort.signal,
                      options.host,
                    );
                    if (!state.presence || !batch.presence)
                      throw new WaitError(
                        `Port ${candidate}: reviewer presence became unavailable`,
                        1,
                      );
                    const events = [
                      ...new Map(
                        [...queuedMessages(state), ...batch.events.filter(isActionable)].map(
                          (event) => [event.cursor, event],
                        ),
                      ).values(),
                    ];
                    return { candidate, batch, events };
                  }),
                )
                  .then((checks) => {
                    const pending = checks.find((check) => check.events.length > 0);
                    if (pending) {
                      resolve({
                        type: 'wait.events',
                        port: pending.candidate,
                        events: pending.events,
                        cursor: pending.batch.cursor,
                      });
                      abort.abort();
                      return;
                    }
                    if (
                      checks.some((check) => check.batch.presence?.reviewers.connected) ||
                      [...attendance.values()].some((state) => state.connected)
                    ) {
                      confirmingAbsence = false;
                      return;
                    }
                    reject(
                      new WaitError(
                        'No reviewer connected on any selected server. End the agent turn; resume on human feedback. Do not retry in a polling loop.',
                        4,
                      ),
                    );
                    abort.abort();
                  })
                  .catch(reject);
                return absenceCheck;
              },
              options.host,
            ).then(resolve, reject);
          }
        });
        console.log(JSON.stringify(result));
      } catch (error) {
        console.error(
          `Error: ${error instanceof Error ? error.message : 'Conversation wait failed'}`,
        );
        process.exitCode = error instanceof WaitError ? error.exitCode : 1;
      } finally {
        abort.abort();
      }
    });
}
