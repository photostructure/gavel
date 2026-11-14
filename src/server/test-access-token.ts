// Test-only: servers under test take a fixed access token, and requests to them carry it.
import { fetch as undiciFetch, Headers } from 'undici';

import { ACCESS_TOKEN_HEADER } from '../utils/accessToken.js';
import {
  startServer as startGavelServer,
  type ServerOptions as GavelServerOptions,
} from './server.js';

export const TEST_ACCESS_TOKEN = 'gavel_test_token_00000';

export type ServerOptions = Omit<GavelServerOptions, 'accessToken'>;

/** `startServer` with the test access token. */
export const startServer = (options: ServerOptions) =>
  startGavelServer({ accessToken: TEST_ACCESS_TOKEN, ...options });

/** undici's `fetch` with the test access token on every request. */
export const fetch: typeof undiciFetch = (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set(ACCESS_TOKEN_HEADER, TEST_ACCESS_TOKEN);
  return undiciFetch(input, { ...init, headers });
};
