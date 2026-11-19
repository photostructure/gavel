import { chmodSync, mkdirSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { join } from 'node:path';

import type { Express } from 'express';

import { ACCESS_TOKEN_HEADER } from '../utils/accessToken.js';

/** The identifier is public; access comes from the host OS's socket or pipe permissions. */
export function localControlPath(id: string): string {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id))
    throw new Error('Invalid local control server identifier');
  if (process.platform === 'win32') return `\\\\.\\pipe\\gavel-${id}`;
  // Keep below the UNIX socket path limit, including on macOS with its long TMPDIR.
  const uid = (process.getuid as () => number)();
  return join('/tmp', `gavel-${uid}-control`, `${id}.sock`);
}

export async function startLocalControl(
  app: Express,
  id: string,
  connections: WeakSet<Socket>,
): Promise<Server> {
  const path = localControlPath(id);
  if (process.platform !== 'win32') mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 });
  const server = createServer(app);
  server.on('connection', (socket) => connections.add(socket));
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(path, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    if (process.platform !== 'win32') chmodSync(path, 0o600);
  } catch (error) {
    server.close();
    server.closeAllConnections();
    throw error;
  }
  return server;
}

/** JSON request over the local control socket, never over TCP or a reverse proxy. */
export function localControlFetch(
  id: string,
  path: string,
  body: string,
  accessToken: string,
  signal: AbortSignal,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      {
        socketPath: localControlPath(id),
        path,
        method: 'POST',
        agent: false,
        signal,
        headers: {
          'Content-Type': 'application/json',
          [ACCESS_TOKEN_HEADER]: accessToken,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.once('error', reject);
        response.once('end', () =>
          resolve(
            new Response(Buffer.concat(chunks).toString('utf8'), {
              status: response.statusCode as number,
            }),
          ),
        );
      },
    );
    outgoing.once('error', reject);
    outgoing.end(body);
  });
}
