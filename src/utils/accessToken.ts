/**
 * The per-user access token guards every `/api` route and the live WebSocket, so only someone
 * holding a launch link, or a CLI run by the same user, can read the reviewed code.
 */

/** Names the token in a launch link's fragment, and in the query of requests that cannot set
 * a header: `<img>` and `<video>` sources, and the live WebSocket. */
export const ACCESS_TOKEN_PARAM = 'gavel-token';

/** Carries the token on every `fetch` from the browser and the CLI. */
export const ACCESS_TOKEN_HEADER = 'X-Gavel-Token';
