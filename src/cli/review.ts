import { readFile, writeFile } from 'node:fs/promises';

import { Command, InvalidArgumentError } from 'commander';

import {
  capturePatch,
  captureWorkingTree,
  getCaptureRepository,
  selectCapture,
  validateCapture,
} from '../server/review-capture.js';
import { inboxTargetFromEnv, type InboxTarget } from '../server/session-inbox.js';
import type { NamedReviewStart, ReviewCapture, ReviewCaptureUpdate } from '../types/review.js';
import { validateReviewName } from '../utils/review-name.js';

import { serverUrl } from './server-url.js';
import { findSavedCapture, revertCapture, type RevertResult } from './unapply.js';

import { detectStdinSource, readStdin } from './utils.js';

interface NamedReviewOptions {
  name: string;
  patch?: string;
  captureFile?: string;
  pathspecs?: string[];
  selectedIds?: string[];
  includeUntracked?: boolean;
  cwd?: string;
}

interface CaptureOptions {
  pathspec?: string[];
  includeUntracked?: boolean;
  output?: string;
}

interface ServerOptions {
  host: string;
  port: number;
}

interface SourceOptions extends CaptureOptions, ServerOptions {
  capture?: string;
  select?: string[];
}

interface UpdateOptions extends SourceOptions {
  expectedVersion: number;
}

export { validateReviewName };

function validateCaptureSource(options: {
  suppliedPatch: boolean;
  captureFile?: string;
  pathspecs?: string[];
  includeUntracked?: boolean;
}): void {
  if (options.suppliedPatch && options.captureFile !== undefined) {
    throw new Error('Choose one patch source: stdin or --capture');
  }
  if (
    (options.suppliedPatch || options.captureFile !== undefined) &&
    (options.pathspecs?.length || options.includeUntracked)
  ) {
    throw new Error(
      '--pathspec and --include-untracked only apply to a native working-tree capture',
    );
  }
}

async function readCapture(file: string): Promise<ReviewCapture> {
  const text = await readFile(file, 'utf8');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`Invalid capture JSON in ${file}`);
  }
  return validateCapture(value);
}

export async function resolveNamedReview(options: NamedReviewOptions): Promise<NamedReviewStart> {
  const name = validateReviewName(options.name);
  validateCaptureSource({
    suppliedPatch: options.patch !== undefined,
    captureFile: options.captureFile,
    pathspecs: options.pathspecs,
    includeUntracked: options.includeUntracked,
  });

  let capture: ReviewCapture;
  if (options.captureFile !== undefined) {
    capture = await readCapture(options.captureFile);
  } else if (options.patch !== undefined) {
    const repository = await getCaptureRepository(options.cwd);
    capture = capturePatch(options.patch, repository);
  } else {
    capture = await captureWorkingTree({
      cwd: options.cwd,
      pathspecs: options.pathspecs,
      includeUntracked: options.includeUntracked,
    });
  }

  return {
    name,
    capture: options.selectedIds?.length ? selectCapture(capture, options.selectedIds) : capture,
  };
}

function integerInRange(value: string, min: number, max: number): number {
  const number = Number(value);
  if (
    value.length === 0 ||
    /\D/.test(value) ||
    !Number.isSafeInteger(number) ||
    number < min ||
    number > max
  ) {
    throw new InvalidArgumentError(`Expected an integer from ${min} to ${max}`);
  }
  return number;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function addCaptureOptions(command: Command): Command {
  return command
    .option(
      '--pathspec <git-pathspec>',
      'capture files matching a native Git pathspec; repeatable',
      collect,
      [],
    )
    .option('--include-untracked', 'include untracked files without changing the Git index');
}

function addServerOptions(command: Command): Command {
  return command
    .option('--host <host>', 'server hostname or IP address', 'localhost')
    .requiredOption('--port <port>', 'port of the running gavel server', (value: string) =>
      integerInRange(value, 1, 65535),
    );
}

function addSourceOptions(command: Command): Command {
  return addServerOptions(
    addCaptureOptions(command)
      .argument('[patch-source]', 'use - to read a unified diff from stdin')
      .option('--capture <file>', 'load a saved capture artifact')
      .option(
        '--select <file-or-hunk-id>',
        'select IDs from the capture catalogue; repeatable',
        collect,
        [],
      ),
  );
}

async function resolveCommandReview(
  name: string,
  patchSource: string | undefined,
  options: SourceOptions,
): Promise<NamedReviewStart> {
  validateReviewName(name);
  if (patchSource !== undefined && patchSource !== '-') {
    throw new Error('Patch source must be - for stdin; use --capture <file> for a saved capture');
  }
  validateCaptureSource({
    suppliedPatch: patchSource !== undefined,
    captureFile: options.capture,
    pathspecs: options.pathspec,
    includeUntracked: options.includeUntracked,
  });
  if (patchSource === '-' && detectStdinSource() === 'tty') {
    throw new Error('Provide a unified diff via stdin for patch source -');
  }
  // Decide from fstat alone: reading could block on a host's open pipe, and a pipe that looks
  // empty may just be a git diff that has not written yet. detectStdinSource reports /dev/null
  // as 'tty', so hosts that give commands no stdin keep capturing the uncommitted tree.
  if (
    patchSource === undefined &&
    options.capture === undefined &&
    !options.pathspec?.length &&
    !options.includeUntracked &&
    detectStdinSource() !== 'tty'
  ) {
    throw new Error(
      'Stdin is a pipe or file, but no patch source was given. To review a diff from stdin, add -. To capture the uncommitted tree, redirect stdin from /dev/null or scope the capture with --pathspec or --include-untracked.',
    );
  }
  const patch = patchSource === '-' ? await readStdin({ strictUtf8: true }) : undefined;
  if (patch !== undefined && !patch.trim()) {
    throw new Error('No diff content received from stdin');
  }
  return resolveNamedReview({
    name,
    patch,
    captureFile: options.capture,
    pathspecs: options.pathspec,
    selectedIds: options.select,
    includeUntracked: options.includeUntracked,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function serializeReviewRequest(
  body: (NamedReviewStart & { inbox: InboxTarget | null }) | ReviewCaptureUpdate,
): string {
  const serialized = JSON.stringify(body);
  if (Buffer.byteLength(serialized, 'utf8') > 16 * 1024 * 1024) {
    throw new Error(
      'Named review request exceeds the 16 MiB serialized JSON limit. Narrow the selected patch, or launch a new local review with --review and --capture.',
    );
  }
  return serialized;
}

async function readResponse(
  response: Response,
  name: string,
  conflictHint = `Read /api/reviews/${encodeURIComponent(name)} before retrying`,
): Promise<unknown> {
  if (response.ok) {
    const body: unknown = await response.json();
    return body;
  }
  const body: unknown = await response.json().catch(() => null);
  const message = isRecord(body) && typeof body.error === 'string' ? body.error : undefined;
  if (response.status === 409) {
    const current = isRecord(body) && isRecord(body.current) ? body.current : undefined;
    const identity =
      current && typeof current.version === 'number' && typeof current.patchDigest === 'string'
        ? `; current version ${current.version}, digest ${current.patchDigest}`
        : '';
    throw new Error(
      `${message ?? `Named review ${name} already exists or changed`}${identity}. ${conflictHint}`,
    );
  }
  throw new Error(message ?? `Named review request failed (${response.status})`);
}

function reportError(error: unknown, port?: number, host?: string): void {
  const message =
    port !== undefined &&
    host !== undefined &&
    error instanceof TypeError &&
    error.message.includes('fetch failed')
      ? `Cannot connect to gavel server at ${serverUrl(host, port, '/')}. Check --host and --port.`
      : error instanceof Error
        ? error.message
        : 'Named review request failed';
  console.error(`Error: ${message}`);
  // Preserve buffered JSON output and let the process exit naturally.
  process.exitCode = 1;
}

export function createReviewCommand(): Command {
  const review = new Command('review').description(
    'Capture uncommitted changes and manage named reviews',
  );

  addCaptureOptions(review.command('capture').description('Capture uncommitted changes read-only'))
    .option('--output <file>', 'write the full capture artifact here and print its catalogue')
    .action(async (options: CaptureOptions) => {
      try {
        const capture = await captureWorkingTree({
          pathspecs: options.pathspec,
          includeUntracked: options.includeUntracked,
        });
        if (options.output !== undefined) {
          await writeFile(options.output, `${JSON.stringify(capture, null, 2)}\n`, 'utf8');
          const { schemaVersion, repositoryId, repositoryRoot, baseCommit, patchDigest, files } =
            capture;
          console.log(
            JSON.stringify({
              schemaVersion,
              repositoryId,
              repositoryRoot,
              baseCommit,
              patchDigest,
              files,
            }),
          );
        } else {
          console.log(JSON.stringify(capture));
        }
      } catch (error) {
        reportError(error);
      }
    });

  addSourceOptions(
    review
      .command('create')
      .description('Create a named review on a running server; the page shows it as a tab')
      .argument('<name>'),
  ).action(async (name: string, patchSource: string | undefined, options: SourceOptions) => {
    try {
      const namedReview = await resolveCommandReview(name, patchSource, options);
      const response = await fetch(serverUrl(options.host, options.port, '/api/reviews'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The review's feedback goes to this session's inbox, or, with null, to no session.
        body: serializeReviewRequest({
          ...namedReview,
          inbox: inboxTargetFromEnv(process.env) ?? null,
        }),
        signal: AbortSignal.timeout(30000),
      });
      console.log(JSON.stringify(await readResponse(response, namedReview.name)));
    } catch (error) {
      reportError(error, options.port, options.host);
    }
  });

  addSourceOptions(
    review
      .command('update')
      .description('Replace a named review capture at an expected version')
      .argument('<name>'),
  )
    .requiredOption(
      '--expected-version <integer>',
      'current capture version, required to reject stale updates',
      (value: string) => integerInRange(value, 1, Number.MAX_SAFE_INTEGER),
    )
    .action(async (name: string, patchSource: string | undefined, options: UpdateOptions) => {
      try {
        const namedReview = await resolveCommandReview(name, patchSource, options);
        const response = await fetch(
          serverUrl(
            options.host,
            options.port,
            `/api/reviews/${encodeURIComponent(namedReview.name)}/capture`,
          ),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: serializeReviewRequest({
              expectedVersion: options.expectedVersion,
              capture: namedReview.capture,
            } satisfies ReviewCaptureUpdate),
            signal: AbortSignal.timeout(30000),
          },
        );
        console.log(JSON.stringify(await readResponse(response, namedReview.name)));
      } catch (error) {
        reportError(error, options.port, options.host);
      }
    });

  for (const direction of ['unapply', 'reapply'] as const)
    review
      .command(direction)
      .description(
        direction === 'unapply'
          ? "Reverse a named review's change in the working tree, keeping other edits"
          : 'Restore a change that unapply reversed, keeping edits made since',
      )
      .argument('<name>', 'saved named review whose current capture to use')
      .argument('[patch-source]', 'use - to read the patch from stdin instead')
      .option('--dry-run', 'print what would change and write nothing')
      .option(
        '--patch-digest <digest>',
        'use the saved capture with this digest, as printed by --dry-run',
      )
      .addHelpText(
        'after',
        `
Reads the review's current capture from <git-common-dir>/gavel; no server needs to run.
When several saved reviews share the name, pass --patch-digest to pick one.
First it stores a stash of the tracked files ("gavel review ${direction} <name> <digest>")
as an emergency snapshot. Then it runs git apply${direction === 'unapply' ? ' -R' : ''} on the capture's patch. If any hunk
does not apply, that writes nothing, and it runs ${
          direction === 'unapply'
            ? `git apply -R -C0 --reject, which matches only
each hunk's own lines, so edits next to a hunk do not stop it (files with a hunk that adds
no lines get git apply -R --reject)`
            : 'git apply --reject'
        }. That writes the hunks
that apply; "rejected" holds git apply's message for the rest, and the command exits 1.${
          direction === 'unapply'
            ? `
Unapply refuses while any of the capture's paths are staged ("refused", exit 1), and does
not change what is staged.`
            : ''
        }
Prints JSON: {direction, label, patchDigest, baseCommit, dryRun, written, refused,
fallback, rejected, stash, stat}.
`,
      )
      .action(
        async (
          name: string,
          patchSource: string | undefined,
          options: { dryRun?: boolean; patchDigest?: string },
        ) => {
          try {
            validateReviewName(name);
            if (patchSource !== undefined && patchSource !== '-')
              throw new Error('Patch source must be - for stdin');
            let capture: ReviewCapture;
            if (patchSource === '-') {
              if (detectStdinSource() === 'tty')
                throw new Error('Provide a unified diff via stdin for patch source -');
              const patch = await readStdin({ strictUtf8: true });
              if (!patch.trim()) throw new Error('No diff content received from stdin');
              capture = capturePatch(patch, await getCaptureRepository());
              if (options.patchDigest !== undefined && capture.patchDigest !== options.patchDigest)
                throw new Error(
                  `The piped patch has digest ${capture.patchDigest}, which does not match --patch-digest ${options.patchDigest}`,
                );
            } else {
              // As for review create: a piped patch without - must not be silently ignored.
              if (detectStdinSource() !== 'tty')
                throw new Error(
                  'Stdin is a pipe or file, but no patch source was given. To use a patch from stdin, add -. To use the saved capture, redirect stdin from /dev/null.',
                );
              capture = await findSavedCapture(process.cwd(), name, options.patchDigest);
            }
            const result: RevertResult = await revertCapture(capture, {
              cwd: process.cwd(),
              direction,
              label: name,
              ...(options.dryRun ? { dryRun: true } : {}),
            });
            console.log(JSON.stringify(result, null, 2));
            if (result.refused !== undefined || result.rejected !== undefined) process.exitCode = 1;
          } catch (error) {
            reportError(error);
          }
        },
      );

  addServerOptions(
    review
      .command('rename')
      .description(
        'Rename a named review on a running server; its comments, proposal and verdict stay',
      )
      .argument('<name>')
      .argument('<new-name>'),
  ).action(async (name: string, newName: string, options: ServerOptions) => {
    try {
      const response = await fetch(
        serverUrl(
          options.host,
          options.port,
          `/api/reviews/${encodeURIComponent(validateReviewName(name))}/rename`,
        ),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: validateReviewName(newName) }),
          signal: AbortSignal.timeout(30000),
        },
      );
      // A review an earlier server saved also takes the name, and GET /api/reviews shows only
      // the reviews open on this server.
      console.log(JSON.stringify(await readResponse(response, newName, 'Choose another name')));
    } catch (error) {
      reportError(error, options.port, options.host);
    }
  });

  addServerOptions(
    review
      .command('delete')
      .description(
        'Delete a named review on a running server; its comments stay readable in Conversation until the server stops',
      )
      .argument('<name>'),
  ).action(async (name: string, options: ServerOptions) => {
    try {
      const response = await fetch(
        serverUrl(
          options.host,
          options.port,
          `/api/reviews/${encodeURIComponent(validateReviewName(name))}`,
        ),
        { method: 'DELETE', signal: AbortSignal.timeout(30000) },
      );
      console.log(JSON.stringify(await readResponse(response, name)));
    } catch (error) {
      reportError(error, options.port, options.host);
    }
  });

  return review;
}
