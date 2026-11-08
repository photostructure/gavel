import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createWaitCommand } from './wait.js';

const presence = { reviewers: { connected: 1, visible: 1 }, listeners: 0 };
const snapshot = { cursor: 'stream:0', reviews: [], presence };
const activity = (type = 'review.approval', origin = 'user', cursor = 'stream:1') => ({
  type,
  origin,
  cursor,
  reviewId: 'review',
  selection: { baseCommitish: 'HEAD', targetCommitish: '.' },
  approved: true,
  timestamp: '2026-11-03T00:00:00Z',
});
const response = (body: unknown, status = 200) =>
  new Response(
    JSON.stringify(
      body && typeof body === 'object' && 'cursor' in body ? { presence, ...body } : body,
    ),
    { status },
  );

describe('gavel wait', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const log = vi.fn();
  const error = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(log);
    vi.spyOn(console, 'error').mockImplementation(error);
  });
  afterEach(() => {
    process.exitCode = 0;
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it('requires a port instead of succeeding without a batch', async () => {
    await expect(
      createWaitCommand()
        .exitOverride()
        .configureOutput({ writeErr: vi.fn() })
        .parseAsync(['node', 'gavel']),
    ).rejects.toThrow("required option '--port <port>' not specified");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('stays silent and unfinished beyond ten minutes of empty HTTP rounds', async () => {
    vi.useFakeTimers();
    let respond: (value: Response) => void = () => {
      throw new Error('No pending request');
    };
    let timer: ReturnType<typeof setTimeout>;
    fetchMock.mockImplementation((url) => {
      if (String(url).endsWith('snapshot')) return Promise.resolve(response(snapshot));
      return new Promise<Response>((resolve) => {
        respond = resolve;
        timer = setTimeout(() => resolve(response({ events: [], cursor: 'stream:0' })), 25000);
      });
    });
    let finished = false;
    const waiting = createWaitCommand()
      .parseAsync(['node', 'gavel', '--port', '4966'])
      .then(() => {
        finished = true;
      });
    await vi.advanceTimersByTimeAsync(750000);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(25);
    expect(finished).toBe(false);
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    clearTimeout(timer!);
    respond(response({ events: [activity()], cursor: 'stream:1' }));
    await waiting;
    expect(log).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({ type: 'wait.events', port: 4966, events: [activity()], cursor: 'stream:1' }),
    );
  });

  it.each(['comment.created', 'comment.updated', 'review.approval', 'review.summary'])(
    'finishes on a human %s event',
    async (type) => {
      const event = activity(type);
      fetchMock
        .mockResolvedValueOnce(response(snapshot))
        .mockResolvedValueOnce(response({ events: [event], cursor: event.cursor }));
      await createWaitCommand().parseAsync(['node', 'gavel', '--port', '4966']);
      expect(JSON.parse(String(log.mock.calls[0]?.[0])).events).toEqual([event]);
      expect(fetchMock.mock.calls.every(([, init]) => init?.method === undefined)).toBe(true);
    },
  );

  it('skips agent activity, thread changes and deletions while advancing its internal cursor', async () => {
    const ignored = [
      activity('comment.created', 'agent'),
      activity('comment.progress', 'agent'),
      activity('review.summary', 'agent'),
      activity('review.approval', 'agent'),
      activity('thread.resolved'),
      activity('thread.reopened'),
      activity('thread.deleted'),
      activity('comment.deleted'),
      activity('review.capture', 'agent'),
    ];
    const revoked = { ...activity('review.approval', 'user', 'stream:11'), approved: false };
    fetchMock
      .mockResolvedValueOnce(response(snapshot))
      .mockResolvedValueOnce(response({ events: ignored, cursor: 'stream:10' }))
      .mockResolvedValueOnce(response({ events: [revoked], cursor: 'stream:11' }));
    await createWaitCommand().parseAsync(['node', 'gavel', '--port', '4966']);
    expect(fetchMock.mock.calls[2]?.[0]).toContain('after=stream%3A10');
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0]?.[0])).events).toEqual([revoked]);
  });

  it('recovers a queued comment even before the supplied checkpoint without acknowledging it', async () => {
    const queued = {
      presence: { reviewers: { connected: 0, visible: 0 }, listeners: 0 },
      cursor: 'stream:20',
      reviews: [
        {
          id: 'review',
          selection: { baseCommitish: 'HEAD', targetCommitish: '.' },
          threads: [
            {
              id: 'thread',
              scope: 'review',
              messages: [
                {
                  id: 'message',
                  body: 'Please answer this',
                  updatedAt: '2026-11-03T00:00:00Z',
                  progress: { status: 'queued', cursor: 'stream:2' },
                },
              ],
            },
          ],
        },
      ],
    };
    fetchMock
      .mockResolvedValueOnce(response(queued))
      .mockResolvedValueOnce(response({ events: [], cursor: 'stream:20' }));
    await createWaitCommand().parseAsync([
      'node',
      'gavel',
      '--port',
      '4966',
      '--after',
      'stream:20',
    ]);
    expect(fetchMock.mock.calls[1]?.[0]).toContain('wait=0');
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      cursor: 'stream:20',
      events: [{ messageId: 'message', cursor: 'stream:2', body: 'Please answer this' }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('includes activity between waits by resuming from the returned cursor', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ ...snapshot, cursor: 'stream:9' }))
      .mockResolvedValueOnce(response({ events: [activity()], cursor: 'stream:9' }));
    await createWaitCommand().parseAsync([
      'node',
      'gavel',
      '--port',
      '4966',
      '--after',
      'stream:0',
    ]);
    expect(fetchMock.mock.calls[1]?.[0]).toContain('after=stream%3A0');
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('waits on several ports and aborts the other subscription after one produces activity', async () => {
    const signals: AbortSignal[] = [];
    fetchMock.mockImplementation((url, init) => {
      if (String(url).endsWith('snapshot')) return Promise.resolve(response(snapshot));
      if (String(url).includes(':4967/'))
        return Promise.resolve(response({ events: [activity()], cursor: 'stream:1' }));
      signals.push(init!.signal!);
      return new Promise<Response>((_resolve, reject) =>
        init!.signal!.addEventListener('abort', () => reject(new Error('Aborted')), { once: true }),
      );
    });
    await createWaitCommand().parseAsync([
      'node',
      'gavel',
      '--port',
      '4966',
      '--port',
      '4967',
      '--after',
      '4966=stream:0',
      '--after',
      '4967=stream:0',
    ]);
    expect(JSON.parse(String(log.mock.calls[0]?.[0])).port).toBe(4967);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
    expect(error).not.toHaveBeenCalled();
  });

  it.each([
    [409, 3],
    [404, 1],
    [500, 1],
  ])('exits once with code %i on HTTP status %i', async (status, exitCode) => {
    fetchMock
      .mockResolvedValueOnce(response(snapshot))
      .mockResolvedValueOnce(response({ error: 'Cannot resume' }, status));
    await createWaitCommand().parseAsync(['node', 'gavel', '--port', '4966']);
    expect(process.exitCode).toBe(exitCode);
    expect(log).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports a lost connection distinctly and never retries it', async () => {
    fetchMock
      .mockResolvedValueOnce(response(snapshot))
      .mockRejectedValueOnce(new TypeError('fetch failed'));
    await createWaitCommand().parseAsync(['node', 'gavel', '--port', '4966']);
    expect(process.exitCode).toBe(2);
    expect(log).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops once with exit 4 when there is no browser and no human work', async () => {
    const absent = { reviewers: { connected: 0, visible: 0 }, listeners: 0 };
    fetchMock
      .mockResolvedValueOnce(response({ ...snapshot, presence: absent }))
      .mockResolvedValueOnce(response({ events: [], cursor: snapshot.cursor, presence: absent }))
      .mockResolvedValueOnce(response({ ...snapshot, presence: absent }))
      .mockResolvedValueOnce(response({ events: [], cursor: snapshot.cursor, presence: absent }));
    await createWaitCommand().parseAsync(['node', 'gavel', '--port', '4966']);
    expect(process.exitCode).toBe(4);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[1]?.[0]).toContain('wait=0');
    expect(log).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('Do not retry'));
  });

  it('returns human work before stopping for absence', async () => {
    const absent = { reviewers: { connected: 0, visible: 0 }, listeners: 0 };
    fetchMock
      .mockResolvedValueOnce(response({ ...snapshot, presence: absent }))
      .mockResolvedValueOnce(
        response({ events: [activity()], cursor: 'stream:1', presence: absent }),
      );
    await createWaitCommand().parseAsync(['node', 'gavel', '--port', '4966']);
    expect(log).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it('drains feedback that arrives during the final absence check', async () => {
    const absent = { reviewers: { connected: 0, visible: 0 }, listeners: 0 };
    fetchMock
      .mockResolvedValueOnce(response({ ...snapshot, presence: absent }))
      .mockResolvedValueOnce(response({ events: [], cursor: 'stream:0', presence: absent }))
      .mockResolvedValueOnce(response({ ...snapshot, presence: absent }))
      .mockResolvedValueOnce(
        response({ events: [activity()], cursor: 'stream:1', presence: absent }),
      );
    await createWaitCommand().parseAsync(['node', 'gavel', '--port', '4966']);
    expect(log).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it('subscribes to an explicit server host', async () => {
    fetchMock
      .mockResolvedValueOnce(response(snapshot))
      .mockResolvedValueOnce(response({ events: [activity()], cursor: 'stream:1' }));
    await createWaitCommand().parseAsync([
      'node',
      'gavel',
      '--host',
      '10.1.1.24',
      '--port',
      '4966',
    ]);
    expect(
      fetchMock.mock.calls.every(([url]) => String(url).startsWith('http://10.1.1.24:4966/')),
    ).toBe(true);
  });

  it('stops after a reviewer disconnects instead of polling indefinitely', async () => {
    const absent = { reviewers: { connected: 0, visible: 0 }, listeners: 0 };
    fetchMock
      .mockResolvedValueOnce(response(snapshot))
      .mockResolvedValueOnce(response({ events: [], cursor: snapshot.cursor, presence: absent }))
      .mockResolvedValueOnce(response({ ...snapshot, presence: absent }))
      .mockResolvedValueOnce(response({ events: [], cursor: snapshot.cursor, presence: absent }));
    await createWaitCommand().parseAsync(['node', 'gavel', '--port', '4966']);
    expect(process.exitCode).toBe(4);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('rejects an older server that cannot report presence', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ cursor: 'old:0', reviews: [] })));
    await createWaitCommand().parseAsync(['node', 'gavel', '--port', '4966']);
    expect(process.exitCode).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('presence is unavailable'));
  });

  it('keeps a previously unattended port subscribed while another review is open', async () => {
    const absent = { reviewers: { connected: 0, visible: 0 }, listeners: 0 };
    let rounds = 0;
    fetchMock.mockImplementation((url, init) => {
      if (String(url).endsWith('snapshot'))
        return Promise.resolve(
          response({ ...snapshot, presence: String(url).includes(':4966/') ? absent : presence }),
        );
      if (String(url).includes(':4966/')) {
        rounds += 1;
        return Promise.resolve(
          response(
            rounds === 1
              ? { events: [], cursor: 'stream:0', presence: absent }
              : { events: [activity()], cursor: 'stream:1' },
          ),
        );
      }
      return new Promise<Response>((_resolve, reject) =>
        init!.signal!.addEventListener('abort', () => reject(new Error('Aborted')), { once: true }),
      );
    });
    await createWaitCommand().parseAsync(['node', 'gavel', '--port', '4966', '--port', '4967']);
    expect(rounds).toBe(2);
    expect(JSON.parse(String(log.mock.calls[0]?.[0])).port).toBe(4966);
    expect(
      fetchMock.mock.calls.find(
        ([url]) => String(url).includes('wait=25000') && String(url).includes(':4966/'),
      ),
    ).toBeDefined();
  });

  it('treats a dropped response body as a connection failure', async () => {
    const dropped = response({});
    vi.spyOn(dropped, 'json').mockRejectedValue(new TypeError('terminated'));
    fetchMock.mockResolvedValueOnce(response(snapshot)).mockResolvedValueOnce(dropped);
    await createWaitCommand().parseAsync(['node', 'gavel', '--port', '4966']);
    expect(process.exitCode).toBe(2);
    expect(log).not.toHaveBeenCalled();
  });

  it('reports malformed JSON as a protocol error without printing a batch', async () => {
    fetchMock
      .mockResolvedValueOnce(response(snapshot))
      .mockResolvedValueOnce(new Response('<html>'));
    await createWaitCommand().parseAsync(['node', 'gavel', '--port', '4966']);
    expect(process.exitCode).toBe(1);
    expect(log).not.toHaveBeenCalled();
  });

  it.each(['--timeout', '--wait', '--once'])(
    'rejects %s instead of enabling timed empty completion',
    async (option) => {
      await expect(
        createWaitCommand()
          .exitOverride()
          .configureOutput({ writeErr: vi.fn() })
          .parseAsync(['node', 'gavel', '--port', '4966', option, '25']),
      ).rejects.toThrow('unknown option');
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(['0', '65536', '1.2', '4966suffix'])('rejects invalid port %s', async (port) => {
    await expect(
      createWaitCommand()
        .exitOverride()
        .configureOutput({ writeErr: vi.fn() })
        .parseAsync(['node', 'gavel', '--port', port]),
    ).rejects.toThrow('Expected an integer from 1 to 65535');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects ambiguous multi-port cursors before making a request', async () => {
    await createWaitCommand().parseAsync([
      'node',
      'gavel',
      '--port',
      '4966',
      '--port',
      '4967',
      '--after',
      'stream:0',
    ]);
    expect(process.exitCode).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
