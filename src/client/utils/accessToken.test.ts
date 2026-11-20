import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiFetch, getAccessToken } from './accessToken';

afterEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('getAccessToken', () => {
  it('keeps the launch link token and takes it out of the address, keeping the rest', () => {
    window.history.replaceState({ kept: true }, '', '/?review=a#gavel-token=k&thread=t2');

    expect(getAccessToken()).toBe('k');
    expect(window.location.search).toBe('?review=a');
    expect(window.location.hash).toBe('#thread=t2');
    expect(window.history.state).toEqual({ kept: true });
    // A reload, or a copy of the address, now carries no token.
    expect(getAccessToken()).toBe('k');
  });

  it('leaves no fragment when the token was all of it', () => {
    window.history.replaceState(null, '', '/?review=a#gavel-token=k');

    expect(getAccessToken()).toBe('k');
    expect(window.location.href).toBe(`${window.location.origin}/?review=a`);
  });

  it('keeps a path in the rest of the fragment the way links write it', () => {
    window.history.replaceState(null, '', '/#gavel-token=k&file=src/a.ts&line=3');

    getAccessToken();
    expect(window.location.hash).toBe('#file=src/a.ts&line=3');
  });
});

describe('apiFetch', () => {
  it('keeps a launch link token that arrived while a request with the old one was refused', async () => {
    localStorage.setItem('gavel-access-token', 'old');
    let refuse!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise((resolve) => (refuse = resolve)));
    const request = apiFetch('/api/diff');
    // The reviewer opens a fresh launch link in this tab while that request is in flight.
    window.history.replaceState(null, '', '/#gavel-token=new');
    expect(getAccessToken()).toBe('new');

    refuse(new Response('{}', { status: 401 }));
    await request;

    expect(getAccessToken()).toBe('new');
  });
});
