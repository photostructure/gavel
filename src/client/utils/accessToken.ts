import { ACCESS_TOKEN_HEADER, ACCESS_TOKEN_PARAM } from '../../utils/accessToken';

// Per origin, so each server port keeps its own copy.
const STORAGE_KEY = 'gavel-access-token';

const listeners = new Set<() => void>();
// A token the server refused; the page shows the access screen instead of retrying it.
let rejected: string | null = null;

function notify() {
  for (const listener of [...listeners]) listener();
}

/**
 * The token from the launch link's fragment, or the one an earlier launch link left in this
 * origin's storage. Null when there is none, or when the server refused it.
 */
export function getAccessToken(): string | null {
  const fromLink = new URLSearchParams(window.location.hash.replace(/^#/, '')).get(
    ACCESS_TOKEN_PARAM,
  );
  if (fromLink && fromLink !== rejected) localStorage.setItem(STORAGE_KEY, fromLink);
  const token = fromLink ?? localStorage.getItem(STORAGE_KEY);
  return token === rejected ? null : token;
}

/** For `useSyncExternalStore`: a new link, another tab's storage, or a refused token. */
export function subscribeAccessToken(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('hashchange', listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('hashchange', listener);
    window.removeEventListener('storage', listener);
  };
}

/** `fetch` for `/api` routes, carrying the access token. */
export async function apiFetch(
  input: string,
  init?: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> },
): Promise<Response> {
  const token = getAccessToken();
  const response = await (token
    ? fetch(input, { ...init, headers: { ...init?.headers, [ACCESS_TOKEN_HEADER]: token } })
    : fetch(input, init));
  if (response.status === 401 && token) {
    rejected = token;
    localStorage.removeItem(STORAGE_KEY);
    notify();
  }
  return response;
}

/** An `/api` URL for an `<img>`, `<video>`, or WebSocket, which cannot set the header. */
export function withAccessTokenQuery(url: string): string {
  const token = getAccessToken();
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}${ACCESS_TOKEN_PARAM}=${encodeURIComponent(token)}`;
}
