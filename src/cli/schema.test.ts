import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSchemaCommand } from './schema.js';

interface SchemaDocument {
  $schema: string;
  $ref: string;
  $defs: Record<string, unknown>;
}

function readOutput(log: ReturnType<typeof vi.spyOn>): SchemaDocument {
  expect(log).toHaveBeenCalledTimes(1);
  return JSON.parse(String(log.mock.calls[0]?.[0])) as SchemaDocument;
}

describe('schema command', () => {
  afterEach(() => vi.restoreAllMocks());

  it('prints a standalone event schema bundle by default', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const command = createSchemaCommand();
    expect(command.name()).toBe('schema');
    await command.parseAsync(['node', 'gavel']);
    const document = readOutput(log);
    expect(document.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(document.$ref).toBe('#/$defs/ServerEvent');
    // The bundle must work offline: every reference resolves within this document.
    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      if ('$ref' in value) {
        const reference = String(value.$ref);
        expect(reference).toMatch(/^#\/\$defs\//);
        expect(document.$defs[reference.slice('#/$defs/'.length)]).toBeDefined();
      }
      for (const child of Object.values(value)) visit(child);
    };
    visit(document);
  });

  it('describes message deletion identities and readiness without a revision cursor', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await createSchemaCommand().parseAsync(['node', 'gavel']);
    const document = readOutput(log);
    const ready = document.$defs.ServerReadyEvent as {
      properties: Record<string, unknown>;
      required: string[];
    };
    const deleted = document.$defs.CommentDeletedEvent as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(ready.properties).not.toHaveProperty('cursor');
    expect(ready.required).not.toContain('cursor');
    expect(deleted.properties).not.toHaveProperty('body');
    expect(deleted.required).toContain('threadId');
    expect(deleted.required).toContain('messageId');
    expect(deleted.required).toContain('cursor');
    expect(document.$defs.ConversationEvent).toMatchObject({
      oneOf: expect.arrayContaining([{ $ref: '#/$defs/CommentDeletedEvent' }]),
    });
  });

  it.each([
    ['events', 'ServerEvent'],
    ['summary', 'SummaryRequest'],
    ['reply', 'ReplyRequest'],
    ['status', 'StatusRequest'],
    ['snapshot', 'SnapshotResponse'],
    ['wait', 'WaitResult'],
    ['batch', 'ConversationBatch'],
    ['presence', 'ReviewPresence'],
    ['comments', 'CommentsRequest'],
    ['review-ops', 'ReviewOpsRequest'],
    ['import', 'CommentImportRequest'],
    ['approval', 'ApprovalRequest'],
    ['capture', 'ReviewCapture'],
    ['capture-update', 'ReviewCaptureUpdate'],
  ])('selects the %s root while retaining response definitions', async (name, definition) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await createSchemaCommand().parseAsync(['node', 'gavel', name]);
    const document = readOutput(log);
    expect(document.$ref).toBe(`#/$defs/${definition}`);
    expect(document.$defs[definition]).toBeDefined();
    for (const response of [
      'SummaryResponse',
      'ReplyResponse',
      'StatusResponse',
      'SnapshotResponse',
      'ErrorResponse',
      'NamedReviewCatalogueResponse',
      'NamedReviewStartResponse',
      'ReviewCaptureUpdateResponse',
      'ReviewCaptureConflictResponse',
    ]) {
      expect(document.$defs[response]).toBeDefined();
    }
  });

  it('describes immutable capture artifacts and guarded updates', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await createSchemaCommand().parseAsync(['node', 'gavel', 'capture']);
    const { $defs } = readOutput(log);
    expect($defs.ReviewCapture).toMatchObject({
      required: [
        'schemaVersion',
        'repositoryId',
        'repositoryRoot',
        'baseCommit',
        'patch',
        'patchDigest',
        'files',
      ],
      properties: {
        schemaVersion: { const: 1 },
        patchDigest: { $ref: '#/$defs/PatchDigest' },
        files: { type: 'array', items: { $ref: '#/$defs/CapturedFile' } },
      },
    });
    expect($defs.CapturedFile).toMatchObject({
      required: ['id', 'path', 'hunks'],
      properties: { hunks: { items: { $ref: '#/$defs/CapturedHunk' } } },
    });
    expect($defs.CapturedHunk).toMatchObject({
      required: ['id', 'oldStart', 'oldLines', 'newStart', 'newLines'],
      properties: {
        oldStart: { type: 'integer', minimum: 0 },
        newLines: { type: 'integer', minimum: 0 },
      },
    });
    expect($defs.ReviewCaptureUpdate).toMatchObject({
      required: ['expectedVersion', 'capture'],
      properties: {
        expectedVersion: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
        capture: { $ref: '#/$defs/ReviewCapture' },
      },
    });
    expect($defs.NamedReviewCatalogueResponse).toMatchObject({
      required: [
        'reviewId',
        'name',
        'version',
        'patchDigest',
        'baseCommit',
        'repositoryId',
        'files',
      ],
      properties: { files: { type: 'array', items: { $ref: '#/$defs/CapturedFile' } } },
    });
    expect($defs.NamedReviewStartResponse).toEqual({ $ref: '#/$defs/ReviewCaptureUpdateResponse' });
    expect($defs.ReviewCaptureUpdateResponse).toMatchObject({
      required: [
        'reviewId',
        'name',
        'version',
        'patchDigest',
        'baseCommit',
        'repositoryId',
        'updated',
      ],
    });
    expect($defs.ReviewCaptureConflictResponse).toMatchObject({
      required: ['error', 'current'],
      properties: { current: { $ref: '#/$defs/NamedReviewMetadata' } },
    });
  });

  it('describes the paired displayed-capture binding for both comment request forms', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await createSchemaCommand().parseAsync(['node', 'gavel', 'comments']);
    const document = readOutput(log);
    expect(document.$ref).toBe('#/$defs/CommentsRequest');
    const request = document.$defs.CommentsRequest as { anyOf: unknown[] };
    expect(request).toMatchObject({
      type: 'object',
      dependentRequired: { captureVersion: ['patchDigest'], patchDigest: ['captureVersion'] },
    });
    expect(request.anyOf).toHaveLength(2);
    for (const form of request.anyOf) {
      expect(form).toMatchObject({
        properties: {
          captureVersion: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
          patchDigest: { $ref: '#/$defs/PatchDigest' },
        },
      });
    }
  });

  it('describes summary events as agent-only, so a wait never returns one', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await createSchemaCommand().parseAsync(['node', 'gavel', 'wait']);
    const { $defs } = readOutput(log);
    const summary = $defs.ReviewSummaryEvent as { properties: Record<string, unknown> };
    expect(summary.properties.origin).toEqual({ const: 'agent' });
    const wait = $defs.WaitResult as {
      properties: { events: { items: { allOf: [{ oneOf: { $ref: string }[] }] } } };
    };
    expect(wait.properties.events.items.allOf[0].oneOf).toEqual([
      { $ref: '#/$defs/CommentEvent' },
      { $ref: '#/$defs/ReviewApprovalEvent' },
    ]);
  });

  it('keeps capture metadata optional on existing events and required on review.capture', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await createSchemaCommand().parseAsync(['node', 'gavel']);
    const { $defs } = readOutput(log);
    for (const name of [
      'ServerReadyEvent',
      'CommentEvent',
      'ReviewSummaryEvent',
      'ReviewApprovalEvent',
    ]) {
      const definition = $defs[name] as { properties: Record<string, unknown>; required: string[] };
      expect(definition.properties.capture).toEqual({ $ref: '#/$defs/NamedReviewMetadata' });
      expect(definition.required).not.toContain('capture');
    }
    expect($defs.CommentEvent).toMatchObject({
      properties: { anchorCapture: { $ref: '#/$defs/CaptureAnchor' } },
    });
    expect($defs.ReviewCaptureEvent).toMatchObject({
      required: ['cursor', 'origin', 'reviewId', 'selection', 'timestamp', 'type', 'capture'],
      properties: {
        type: { const: 'review.capture' },
        origin: { const: 'agent' },
        capture: { $ref: '#/$defs/NamedReviewMetadata' },
      },
    });
    expect($defs.ConversationEvent).toMatchObject({
      oneOf: expect.arrayContaining([{ $ref: '#/$defs/ReviewCaptureEvent' }]),
    });
    expect($defs.DiffSelection).toMatchObject({
      required: ['baseCommitish', 'targetCommitish'],
      properties: { reviewName: { $ref: '#/$defs/ReviewName' } },
    });
    expect($defs.SnapshotResponse).toMatchObject({
      properties: {
        reviews: {
          items: {
            required: ['id', 'selection', 'threads', 'approval', 'summary'],
            properties: { capture: { $ref: '#/$defs/NamedReviewMetadata' } },
          },
        },
      },
    });
    expect($defs.CommentThread).toMatchObject({
      oneOf: expect.arrayContaining([
        expect.objectContaining({
          properties: expect.objectContaining({ capture: { $ref: '#/$defs/CaptureAnchor' } }),
        }),
      ]),
    });
  });

  it('documents the capture and proposal guards on approval requests and saved approval', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await createSchemaCommand().parseAsync(['node', 'gavel', 'approval']);
    const { $defs } = readOutput(log);
    const approvalFields = {
      captureVersion: { type: 'integer', minimum: 1 },
      patchDigest: { $ref: '#/$defs/PatchDigest' },
      summaryVersion: { type: 'integer', minimum: 0 },
    };
    expect($defs.ApprovalRequest).toMatchObject({
      required: ['verdict'],
      properties: approvalFields,
      description: expect.stringContaining('captureVersion, patchDigest and summaryVersion'),
    });
    expect($defs.ReviewApproval).toMatchObject({
      required: [],
      properties: { ...approvalFields, verdict: { $ref: '#/$defs/ReviewVerdict' } },
    });
    expect($defs.ReviewApproval).not.toHaveProperty('properties.approved');
    expect($defs.ReviewVerdict).toMatchObject({ enum: ['as-is', 'after-comments', 'reject'] });
  });

  it('declares excerpt fields only on thread forms that preserve them', async () => {
    // Ground truth: node node_modules/vitest/vitest.mjs run src/server/server.test.ts -t 'preserves supported excerpts and position behavior'.
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await createSchemaCommand().parseAsync(['node', 'gavel', 'comments']);
    const document = readOutput(log);
    type ThreadForms = { oneOf: { properties: Record<string, unknown> }[] };
    const canonical = document.$defs.CommentThread as ThreadForms;
    const display = document.$defs.DisplayCommentThread as ThreadForms;
    expect(canonical.oneOf[0]?.properties.codeSnapshot).toEqual({ $ref: '#/$defs/CodeSnapshot' });
    expect(canonical.oneOf[1]?.properties).not.toHaveProperty('codeSnapshot');
    for (const variant of display.oneOf)
      expect(variant.properties).not.toHaveProperty('codeSnapshot');
    expect(display.oneOf[0]?.properties.codeContent).toEqual({ type: 'string' });
    expect(display.oneOf[1]?.properties).not.toHaveProperty('codeContent');
  });

  it('rejects an unknown name without writing a misleading schema', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const stderr = vi.fn();
    const command = createSchemaCommand().exitOverride().configureOutput({ writeErr: stderr });
    await expect(command.parseAsync(['node', 'gavel', 'unknown'])).rejects.toThrow(
      "value 'unknown' is invalid for argument 'name'",
    );
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('Allowed choices'));
    expect(log).not.toHaveBeenCalled();
  });

  it('rejects extra arguments instead of ignoring them', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const command = createSchemaCommand().exitOverride().configureOutput({ writeErr: vi.fn() });
    await expect(command.parseAsync(['node', 'gavel', 'reply', 'status'])).rejects.toThrow(
      'too many arguments',
    );
    expect(log).not.toHaveBeenCalled();
  });

  it('explains the default root and request/response discovery in help', async () => {
    const output = vi.fn();
    const command = createSchemaCommand().exitOverride().configureOutput({ writeOut: output });
    await expect(command.parseAsync(['node', 'gavel', '--help'])).rejects.toMatchObject({
      code: 'commander.helpDisplayed',
    });
    const help = output.mock.calls.map((call) => String(call[0])).join('');
    expect(help).toContain('default/events root validates one JSONL record');
    expect(help).toContain('gavel schema summary');
    expect(help).toContain('gavel schema snapshot');
    expect(help).toContain('gavel schema capture-update');
    expect(help).toContain('capture validates a saved artifact');
    expect(help).toContain('$defs');
  });
});
