import { Argument, Command } from 'commander';

type Schema = Record<string, unknown>;

const string: Schema = { type: 'string' };
const boolean: Schema = { type: 'boolean' };
const nonblank: Schema = { type: 'string', pattern: '\\S' };
const timestamp: Schema = { type: 'string', description: 'Timestamp, normally ISO 8601.' };
const version: Schema = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const captureVersion: Schema = { ...version, minimum: 1 };
const cursor: Schema = {
  type: 'string',
  description:
    'Opaque cursor valid only for this server process. Recover current IDs and revisions with comment snapshot after a restart.',
};
const revisionCursor: Schema = {
  ...cursor,
  description:
    'Exact comment revision: use the comment.created/updated cursor or snapshot message.progress.cursor. A comment.progress event has a different top-level stream cursor. Stale revisions return HTTP 409.',
};
const ref = (name: string): Schema => ({ $ref: `#/$defs/${name}` });
const array = (items: Schema): Schema => ({ type: 'array', items });
const object = (
  properties: Record<string, Schema>,
  required = Object.keys(properties),
): Schema => ({
  type: 'object',
  properties,
  required,
});
const enumeration = (...values: string[]): Schema => ({ type: 'string', enum: values });
const summaryFields = {
  commitMessage: {
    type: 'string',
    maxLength: 16000,
    description:
      'Proposed commit message; the server limits this to 16000 JavaScript UTF-16 code units.',
  },
  rationale: {
    type: 'string',
    maxLength: 4000,
    description:
      "The user's TLDR explaining the proposed change; the server limits this to 4000 JavaScript UTF-16 code units.",
  },
};
const messageFields = {
  id: string,
  origin: enumeration('user', 'agent'),
  progress: ref('CommentProgress'),
  intent: ref('CommentIntent'),
  body: string,
  author: string,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const threadFields = {
  capture: ref('CaptureAnchor'),
  id: string,
  scope: enumeration('line', 'review'),
  createdAt: timestamp,
  updatedAt: timestamp,
  resolution: ref('ThreadResolution'),
  isQuestion: boolean,
  messages: array(ref('CommentMessage')),
};
const streamFields = {
  cursor,
  origin: enumeration('user', 'agent'),
  reviewId: string,
  selection: ref('DiffSelection'),
  timestamp,
};
const importFields = {
  type: enumeration('thread', 'reply'),
  id: string,
  filePath: nonblank,
  position: ref('CommentPosition'),
  body: nonblank,
  author: string,
  createdAt: timestamp,
  updatedAt: timestamp,
  codeSnapshot: ref('CodeSnapshot'),
};

const metadataFields = {
  name: ref('ReviewName'),
  version: captureVersion,
  patchDigest: ref('PatchDigest'),
  baseCommit: ref('CaptureBaseCommit'),
  repositoryId: string,
};

const definitions: Record<string, Schema> = {
  ReviewName: {
    type: 'string',
    minLength: 1,
    maxLength: 80,
    pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$',
    not: { pattern: '[^A-Za-z0-9._-]' },
    description: 'Stable name for one task in this server process and repository.',
  },
  DiffDigest: {
    type: 'string',
    pattern: '^[a-f0-9]{64}$',
    minLength: 64,
    maxLength: 64,
    description:
      'SHA-256 of the full-index patch of a staged, working, or . diff, whitespace included, from GET /api/diff.',
  },
  PatchDigest: {
    type: 'string',
    pattern: '^[a-f0-9]{64}$',
    minLength: 64,
    maxLength: 64,
    description: 'SHA-256 of the exact UTF-8 patch. File and hunk IDs belong to this digest.',
  },
  CaptureBaseCommit: {
    type: 'string',
    pattern: '^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64}|unborn)$',
  },
  CapturedHunk: object({
    id: string,
    oldStart: { type: 'integer', minimum: 0 },
    oldLines: { type: 'integer', minimum: 0 },
    newStart: { type: 'integer', minimum: 0 },
    newLines: { type: 'integer', minimum: 0 },
  }),
  CapturedFile: object(
    { id: string, path: string, oldPath: string, hunks: array(ref('CapturedHunk')) },
    ['id', 'path', 'hunks'],
  ),
  ReviewCapture: {
    ...object({
      schemaVersion: { const: 1 },
      repositoryId: string,
      repositoryRoot: nonblank,
      baseCommit: ref('CaptureBaseCommit'),
      patch: string,
      patchDigest: ref('PatchDigest'),
      files: array(ref('CapturedFile')),
    }),
    description:
      'Immutable repository-bound artifact from review capture. The server derives digest, file/hunk IDs and ranges from patch, and rejects artifacts from a different repository root. JSON Schema cannot verify those relationships.',
  },
  NamedReviewMetadata: object(metadataFields),
  CaptureAnchor: {
    ...object({ version: captureVersion, patchDigest: ref('PatchDigest') }),
    description:
      'Capture in which the thread was first saved; retained when the named review advances. Only inline threads become outdated when this anchor differs from the current capture.',
  },
  NamedReviewStart: {
    ...object(
      {
        name: ref('ReviewName'),
        capture: ref('ReviewCapture'),
        inbox: {
          oneOf: [
            { type: 'null' },
            object(
              {
                sessionId: { type: 'string', pattern: '^[\\w-]{1,100}$' },
                socket: { type: 'string', description: 'Absolute path of the Unix socket.' },
                token: { type: 'string' },
              },
              ['sessionId', 'socket'],
            ),
          ],
          description:
            "The creating Claude Code session's inbox, which receives this review's human activity; null when the creator has none. Accepted only from this machine. Omitted, the launching session receives it.",
        },
      },
      ['name', 'capture'],
    ),
    description: 'POST /api/reviews creates a named review at capture version 1.',
  },
  ReviewCaptureUpdate: {
    ...object({ expectedVersion: captureVersion, capture: ref('ReviewCapture') }),
    description:
      'POST /api/reviews/:name/capture. expectedVersion must match the current capture version, including for unchanged patches. A changed patch advances the version, revokes Approve as-is, moves Approve after comments to the new capture, and leaves Reject in place; an identical patch preserves the version and verdict.',
  },
  NamedReviewCatalogueResponse: {
    ...object({ reviewId: string, ...metadataFields, files: array(ref('CapturedFile')) }),
    description:
      'GET /api/reviews/:name returns the current capture catalogue; optional ?version=<n> reads a retained capture version from this server process.',
  },
  NamedReviewStartResponse: ref('ReviewCaptureUpdateResponse'),
  ReviewCaptureUpdateResponse: object({
    reviewId: string,
    ...metadataFields,
    updated: boolean,
  }),
  ReviewCaptureConflictResponse: object({
    error: string,
    current: ref('NamedReviewMetadata'),
  }),
  DiffSelection: object(
    {
      baseCommitish: string,
      targetCommitish: string,
      baseMode: enumeration('direct', 'merge-base'),
      reviewName: ref('ReviewName'),
    },
    ['baseCommitish', 'targetCommitish'],
  ),
  ReviewContext: object(
    {
      source: enumeration('git', 'stdin'),
      repositoryName: string,
      repositoryPath: string,
      workingDirectory: string,
      hostname: string,
      agent: string,
      agentSessionName: string,
      agentSessionId: string,
    },
    ['source', 'workingDirectory', 'hostname'],
  ),
  LineRange: {
    description:
      'A positive line number or inclusive multiline range; start must be <= end. Comment imports (--comment, comment add, POST /api/comment-imports) validate this rule. POST /api/comments trusts thread-form positions and normalizes invalid display ranges to line 1; clients must send valid positions. Standard JSON Schema cannot express the relational constraint.',
    oneOf: [
      { type: 'integer', minimum: 1 },
      object({ start: { type: 'integer', minimum: 1 }, end: { type: 'integer', minimum: 1 } }),
    ],
  },
  DisplayLineRange: {
    description:
      'A positive line number or [start, end] inclusive multiline range; start must be <= end.',
    oneOf: [
      { type: 'integer', minimum: 1 },
      {
        type: 'array',
        prefixItems: [
          { type: 'integer', minimum: 1 },
          { type: 'integer', minimum: 1 },
        ],
        items: false,
        minItems: 2,
        maxItems: 2,
      },
    ],
  },
  CommentPosition: object({ side: enumeration('old', 'new'), line: ref('LineRange') }),
  CodeSnapshot: object({ content: string, language: string }, ['content']),
  CommentIntent: enumeration('comment', 'question', 'change'),
  CommentProgress: object({
    status: enumeration('queued', 'delivered', 'read', 'thinking', 'replying', 'noted', 'replied'),
    cursor: revisionCursor,
    updatedAt: timestamp,
  }),
  CommentMessage: object(messageFields, ['id', 'body', 'createdAt', 'updatedAt']),
  ThreadResolution: object({ resolved: boolean, updatedAt: timestamp }),
  CommentThread: {
    oneOf: [
      object(
        {
          ...threadFields,
          scope: { const: 'line' },
          codeSnapshot: ref('CodeSnapshot'),
          filePath: string,
          position: ref('CommentPosition'),
        },
        ['id', 'createdAt', 'updatedAt', 'messages', 'filePath', 'position'],
      ),
      {
        ...object({ ...threadFields, scope: { const: 'review' } }, [
          'id',
          'scope',
          'createdAt',
          'updatedAt',
          'messages',
        ]),
        not: { anyOf: [{ required: ['filePath'] }, { required: ['position'] }] },
      },
    ],
  },
  DisplayCommentThread: {
    description:
      'Browser comment representation for POST /api/comments; line ranges use [start, end]. Inline excerpts use codeContent; review-scope threads do not preserve excerpts.',
    oneOf: [
      object(
        {
          ...threadFields,
          scope: { const: 'line' },
          file: string,
          line: ref('DisplayLineRange'),
          side: enumeration('old', 'new'),
          codeContent: string,
          isOutdated: boolean,
        },
        ['id', 'createdAt', 'updatedAt', 'messages', 'file', 'line'],
      ),
      {
        ...object({ ...threadFields, scope: { const: 'review' }, isOutdated: boolean }, [
          'id',
          'scope',
          'createdAt',
          'updatedAt',
          'messages',
        ]),
        not: { anyOf: [{ required: ['file'] }, { required: ['line'] }, { required: ['side'] }] },
      },
    ],
  },
  ReviewSummary: object(
    {
      ...summaryFields,
      version,
      updatedAt: timestamp,
      fromCommit: {
        const: true,
        description:
          'Present when the server copied commitMessage from the browsed commit instead of anyone proposing it. Any summary save removes it, even one that keeps the text.',
      },
    },
    ['commitMessage', 'rationale', 'version'],
  ),
  ReviewVerdict: {
    ...enumeration('as-is', 'after-comments', 'reject'),
    description:
      "The reviewer's decision. as-is and after-comments approve the review; reject is final for those diffs: do not revise or commit, ask the user what to do instead.",
  },
  ReviewApproval: object(
    {
      verdict: ref('ReviewVerdict'),
      conditionalSupported: boolean,
      updatedAt: timestamp,
      cursor,
      captureVersion,
      patchDigest: ref('PatchDigest'),
      diffDigest: ref('DiffDigest'),
      summaryVersion: version,
    },
    [],
  ),
  ServerReadyEvent: object(
    {
      capture: ref('NamedReviewMetadata'),
      type: { const: 'server.ready' },
      port: { type: 'integer', minimum: 1, maximum: 65535 },
      url: string,
      launchUrl: string,
      pid: { type: 'integer', minimum: 1 },
      reviewContext: ref('ReviewContext'),
      selection: ref('DiffSelection'),
      reviewId: string,
      timestamp,
    },
    [
      'type',
      'port',
      'url',
      'launchUrl',
      'pid',
      'reviewContext',
      'selection',
      'reviewId',
      'timestamp',
    ],
  ),
  ServerBackgroundEvent: object({
    type: { const: 'server.background' },
    port: { type: 'integer', minimum: 1, maximum: 65535 },
    url: string,
    pid: { type: 'integer', minimum: 1 },
    timestamp,
  }),
  ServerShutdownEvent: object({
    type: { const: 'server.shutdown' },
    reason: enumeration('closed', 'client-disconnected', 'approved', 'SIGINT', 'SIGTERM', 'SIGHUP'),
    pid: { type: 'integer', minimum: 1 },
    timestamp,
  }),
  CommentEvent: object(
    {
      ...streamFields,
      capture: ref('NamedReviewMetadata'),
      anchorCapture: ref('CaptureAnchor'),
      type: enumeration('comment.created', 'comment.updated'),
      threadId: string,
      messageId: string,
      scope: enumeration('line', 'review'),
      file: string,
      side: enumeration('old', 'new'),
      line: ref('LineRange'),
      intent: ref('CommentIntent'),
      body: string,
      author: string,
      codeSnapshot: ref('CodeSnapshot'),
    },
    [
      'type',
      'cursor',
      'origin',
      'reviewId',
      'selection',
      'threadId',
      'messageId',
      'body',
      'timestamp',
    ],
  ),
  CommentDeletedEvent: object({
    ...streamFields,
    type: { const: 'comment.deleted' },
    threadId: string,
    messageId: string,
  }),
  CommentProgressEvent: object({
    ...streamFields,
    type: { const: 'comment.progress' },
    origin: { const: 'agent' },
    threadId: string,
    messageId: string,
    progress: ref('CommentProgress'),
  }),
  ThreadEvent: object({
    ...streamFields,
    type: enumeration('thread.resolved', 'thread.reopened', 'thread.deleted'),
    threadId: string,
  }),
  ReviewSummaryEvent: object(
    {
      ...streamFields,
      capture: ref('NamedReviewMetadata'),
      type: { const: 'review.summary' },
      // Only agents write the proposal; the browser shows it read-only.
      origin: { const: 'agent' },
      summary: ref('ReviewSummary'),
    },
    ['cursor', 'origin', 'reviewId', 'selection', 'timestamp', 'type', 'summary'],
  ),
  ReviewApprovalEvent: object(
    {
      ...streamFields,
      type: { const: 'review.approval' },
      approval: ref('ReviewApproval'),
      capture: ref('NamedReviewMetadata'),
      summaryVersion: version,
    },
    ['cursor', 'origin', 'reviewId', 'selection', 'timestamp', 'type'],
  ),
  ReviewCaptureEvent: object({
    ...streamFields,
    type: { const: 'review.capture' },
    origin: { const: 'agent' },
    capture: ref('NamedReviewMetadata'),
  }),
  ConversationEvent: {
    oneOf: [
      'CommentEvent',
      'CommentDeletedEvent',
      'CommentProgressEvent',
      'ThreadEvent',
      'ReviewSummaryEvent',
      'ReviewApprovalEvent',
      'ReviewCaptureEvent',
    ].map(ref),
  },
  ReviewPresence: object({
    reviewers: object({ connected: version, visible: version }),
    listeners: version,
  }),
  ConversationBatch: object(
    { events: array(ref('ConversationEvent')), cursor, presence: ref('ReviewPresence') },
    ['events', 'cursor'],
  ),
  WaitResult: {
    ...object({
      type: { const: 'wait.events' },
      port: { type: 'integer', minimum: 1, maximum: 65535 },
      events: {
        type: 'array',
        minItems: 1,
        items: {
          allOf: [
            { oneOf: ['CommentEvent', 'ReviewApprovalEvent'].map(ref) },
            { properties: { origin: { const: 'user' } } },
          ],
        },
      },
      cursor,
    }),
    description:
      'One nonempty batch from gavel wait. Save port/cursor for the next --after; events retain their exact revision cursors. No delivery receipt is implied.',
  },
  ServerEvent: {
    description:
      'One complete JSON object per stdout line. Newlines within strings are JSON escaped. Stdout delivery does not acknowledge comment progress; send an explicit StatusRequest.',
    oneOf: [
      'ServerReadyEvent',
      'ServerBackgroundEvent',
      'ServerShutdownEvent',
      'ConversationEvent',
    ].map(ref),
  },
  SummaryRequest: {
    ...object({
      reviewId: { type: 'string', minLength: 1 },
      ...summaryFields,
      baseVersion: version,
    }),
    description:
      'JSON input to comment summary (POST /api/conversation/summary). baseVersion must equal the current summary.version. Empty text clears a field. A changed summary revokes Approve as-is, moves Approve after comments to the new version, and leaves Reject in place.',
  },
  SummaryResponse: ref('ReviewSummary'),
  ReplyRequest: {
    ...object(
      {
        reviewId: string,
        threadId: string,
        inReplyTo: string,
        body: nonblank,
        cursor: revisionCursor,
        author: nonblank,
      },
      ['reviewId', 'threadId', 'inReplyTo', 'body'],
    ),
    description:
      'JSON input to comment reply. inReplyTo is an event messageId. Optional cursor pins the exact comment revision and is required to mark it replied; retries are idempotent. Author defaults to Agent.',
  },
  ReplyResponse: object({
    success: { const: true },
    reviewId: string,
    threadId: string,
    messageId: string,
  }),
  StatusRequest: {
    ...object({
      reviewId: string,
      threadId: string,
      messageId: string,
      cursor: revisionCursor,
      status: enumeration('delivered', 'read', 'thinking', 'replying', 'noted'),
    }),
    description:
      'JSON input to comment status. Must identify an existing user message and its exact revision. Progress only advances; queued and replied are server-managed.',
  },
  StatusResponse: ref('SuccessResponse'),
  SuccessResponse: object({ success: { const: true } }),
  ErrorResponse: object({ error: string, summary: ref('ReviewSummary') }, ['error']),
  SnapshotResponse: object(
    {
      presence: ref('ReviewPresence'),
      store: {
        ...object({ directory: string, error: string }, ['directory']),
        description:
          'Where this server saves its reviews (<git-common-dir>/gavel). error, when present, lists what it is not saving and why: a failed or lock-waiting save, a failed heartbeat, or reviews another running server saves, which this one keeps in memory only; until those clear, their changes are lost when the server stops. It also lists files startup cleanup could not handle, which stay without affecting saving.',
      },
      cursor: {
        ...cursor,
        description:
          'Opaque stream checkpoint captured with this snapshot. Use it as --after only after reconciling current state; it does not acknowledge queued messages. Do not decode, sort, or use it as a message revision guard. Replay is bounded and process-local.',
      },
      reviews: array(
        object(
          {
            id: string,
            selection: ref('DiffSelection'),
            threads: array(ref('CommentThread')),
            approval: ref('ReviewApproval'),
            summary: ref('ReviewSummary'),
            capture: ref('NamedReviewMetadata'),
          },
          ['id', 'selection', 'threads', 'approval', 'summary'],
        ),
      ),
    },
    ['cursor', 'reviews'],
  ),
  CommentImport: object(importFields, ['type', 'filePath', 'position', 'body']),
  CommentImportRequest: {
    description:
      'JSON input to --comment / comment add (POST /api/comment-imports). A single object or array. Import timestamps must be parseable dates; body is trimmed. Reply imports target the newest matching file/position thread.',
    oneOf: [ref('CommentImport'), array(ref('CommentImport'))],
  },
  CommentImportResponse: object({
    success: { const: true },
    changed: boolean,
    count: { type: 'integer', minimum: 0 },
    importId: string,
    warnings: array(string),
  }),
  CommentAddResponse: object(
    {
      success: boolean,
      importId: string,
      count: { type: 'integer', minimum: 0 },
      warnings: array(string),
    },
    ['success', 'count', 'warnings'],
  ),
  LegacyComment: object(
    {
      id: string,
      file: string,
      line: ref('DisplayLineRange'),
      body: string,
      timestamp,
      author: string,
      codeContent: string,
      side: enumeration('old', 'new'),
    },
    ['id', 'file', 'line', 'body', 'timestamp'],
  ),
  CommentsRequest: {
    type: 'object',
    description:
      'POST /api/comments edits/replaces comments, including message body and intent edits. A stale baseVersion merges instead of replacing; server-owned progress is ignored. For named reviews, a new thread uses its own retained capture anchor when present, otherwise the optional captureVersion and patchDigest pair (both or neither), otherwise the current capture. A partial or unknown body pair, or an invalid new-thread anchor, returns HTTP 400 without applying comments. Saved threads keep their server anchor and ignore supplied replacements. Ordinary reviews discard capture stamps.',
    dependentRequired: { captureVersion: ['patchDigest'], patchDigest: ['captureVersion'] },
    anyOf: [
      object(
        {
          threads: array({ anyOf: [ref('CommentThread'), ref('DisplayCommentThread')] }),
          captureVersion,
          patchDigest: ref('PatchDigest'),
          baseVersion: { type: 'integer', minimum: 0 },
        },
        ['threads'],
      ),
      object(
        {
          comments: array(ref('LegacyComment')),
          baseVersion: { type: 'integer', minimum: 0 },
          captureVersion,
          patchDigest: ref('PatchDigest'),
        },
        ['comments'],
      ),
    ],
  },
  CommentsResponse: object({
    version: { type: 'integer', minimum: 0 },
    threads: array(ref('CommentThread')),
  }),
  CommentsEditResponse: object({
    success: { const: true },
    merged: boolean,
    version: { type: 'integer', minimum: 0 },
    threads: array(ref('CommentThread')),
  }),
  ResolutionRequest: object({ resolved: boolean, reviewId: string }, ['resolved']),
  ResolutionResponse: ref('SuccessResponse'),
  DeleteResponse: object({
    success: { const: true },
    threadId: string,
    version: { type: 'integer', minimum: 0 },
  }),
  CommentActionResponse: {
    description:
      'JSON output from comment resolve/reopen/delete; the corresponding resolved, reopened, or deleted array is present.',
    anyOf: ['resolved', 'reopened', 'deleted'].map((action) =>
      object({
        success: boolean,
        [action]: array(string),
        notFound: array(string),
        errors: array(object({ threadId: string, error: string })),
      }),
    ),
  },
  ApprovalRequest: {
    ...object(
      {
        verdict: ref('ReviewVerdict'),
        summaryVersion: version,
        captureVersion,
        patchDigest: ref('PatchDigest'),
        diffDigest: ref('DiffDigest'),
      },
      ['verdict'],
    ),
    description:
      'PUT /api/approval sets the verdict; DELETE /api/approval clears it and requires no matching versions. Every verdict requires captureVersion and patchDigest (named) or diffDigest (staged, working, or .) matching the displayed capture or diff; as-is and after-comments also require the current summaryVersion (omission means 0 for an unnamed review). Named review approval requires captureVersion, patchDigest and summaryVersion matching the displayed capture and proposal. Stale requests return HTTP 409. as-is is ended by new human feedback, an agent summary edit, a recapture, or a later change to the staged or worktree diff when comment snapshot or GET /api/approval reads it. after-comments tells the agent to act on all the current comments and commit; reject tells it to stop, ask the user what to do instead, and ask whether to revert. Only the reviewer ends after-comments or reject.',
  },
  ApprovalResponse: ref('ReviewApproval'),
};

const roots = {
  events: 'ServerEvent',
  summary: 'SummaryRequest',
  reply: 'ReplyRequest',
  status: 'StatusRequest',
  snapshot: 'SnapshotResponse',
  wait: 'WaitResult',
  batch: 'ConversationBatch',
  presence: 'ReviewPresence',
  comments: 'CommentsRequest',
  import: 'CommentImportRequest',
  approval: 'ApprovalRequest',
  capture: 'ReviewCapture',
  'capture-update': 'ReviewCaptureUpdate',
};

export function createSchemaCommand(): Command {
  return new Command('schema')
    .description('Print JSON Schema for events, captures and review/comment API JSON')
    .addArgument(
      new Argument('[name]', 'schema root; all request/response definitions remain in $defs')
        .choices(Object.keys(roots))
        .default('events'),
    )
    .addHelpText(
      'after',
      `
The default/events root validates one JSONL record. Request roots validate JSON
input; snapshot validates the response and capture validates a saved artifact.
All roots include every $defs definition.

Examples:
  gavel schema > gavel.schema.json
  gavel schema summary > summary-request.schema.json
  gavel schema snapshot > snapshot-response.schema.json
  gavel schema capture > capture.schema.json
  gavel schema capture-update > capture-update.schema.json
`,
    )
    .action((name: keyof typeof roots) => {
      console.log(
        JSON.stringify(
          {
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            title: 'gavel events, captures and review API',
            description:
              'Machine-readable event and JSON request/response contracts for expected-valid payloads. Additional properties are tolerated. The server checks existence, revision matching, version conflicts, and import dates/ranges. POST /api/comments is not a validation boundary: it may preserve invalid thread positions or normalize invalid display ranges.',
            $ref: `#/$defs/${roots[name]}`,
            $defs: definitions,
          },
          null,
          2,
        ),
      );
    });
}
