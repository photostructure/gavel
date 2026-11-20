import { ACCESS_TOKEN_HEADER, ACCESS_TOKEN_PARAM } from '../../utils/accessToken';

// Per origin, so each server port keeps its own copy.
const STORAGE_KEY = 'gavel-access-token';

const listeners = new Set<() => void>();
// A token the server refused; the page shows the access screen instead of retrying it.
let rejected: string | null = null;

function notify() {
  for (const listener of [...listeners]) listener();
}

/** This page's fragment without its access token, as comment links write it, without the `#`. */
export function fragmentWithoutToken(): string {
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  fragment.delete(ACCESS_TOKEN_PARAM);
  // As comment links write them, with a literal slash in paths.
  return fragment.toString().replaceAll('%2F', '/');
}

/**
 * The token this origin's storage holds, taken from a launch link's fragment. Null when there is
 * none, or when the server refused it. Any link can put a token in the fragment (Markdown, a
 * comment, a diagram, another website), so a fragment token is stored only while the page has no
 * working token; a stored token the server has not refused stays. A fragment token the server
 * has not refused is taken out of the address either way, so a copied address does not carry it.
 */
export function getAccessToken(): string | null {
  const fromLink = new URLSearchParams(window.location.hash.replace(/^#/, '')).get(
    ACCESS_TOKEN_PARAM,
  );
  if (fromLink && fromLink !== rejected) {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null || stored === rejected) localStorage.setItem(STORAGE_KEY, fromLink);
    const rest = fragmentWithoutToken();
    const { pathname, search } = window.location;
    window.history.replaceState(
      window.history.state,
      '',
      `${pathname}${search}${rest ? `#${rest}` : ''}`,
    );
  }
  const token = localStorage.getItem(STORAGE_KEY);
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
    // Another request's 401, or another tab, may have let a newer token in since this one started.
    if (localStorage.getItem(STORAGE_KEY) === token) localStorage.removeItem(STORAGE_KEY);
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
