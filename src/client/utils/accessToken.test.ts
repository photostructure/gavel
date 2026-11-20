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

// Any link can put a token in the fragment: Markdown, a comment, a Mermaid diagram, or another
// website navigating the tab. Only a page without a working token takes one from there.
describe('a fragment token while the page holds a working one', () => {
  it('is ignored and taken out of the address, keeping the rest', () => {
    localStorage.setItem('gavel-access-token', 'mine');
    window.history.replaceState(null, '', '/?review=a#gavel-token=other&thread=t2');

    expect(getAccessToken()).toBe('mine');
    expect(localStorage.getItem('gavel-access-token')).toBe('mine');
    expect(window.location.hash).toBe('#thread=t2');
  });

  it('is taken once the server refuses the stored token', async () => {
    localStorage.setItem('gavel-access-token', 'old');
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 401 }));
    await apiFetch('/api/diff');
    expect(getAccessToken()).toBeNull();

    window.history.replaceState(null, '', '/#gavel-token=new');

    expect(getAccessToken()).toBe('new');
    expect(window.location.hash).toBe('');
  });

  it('is ignored while a request with the stored token is in flight, and taken after its 401', async () => {
    localStorage.setItem('gavel-access-token', 'stale');
    let refuse!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise((resolve) => (refuse = resolve)));
    const request = apiFetch('/api/diff');
    window.history.replaceState(null, '', '/#gavel-token=new');
    expect(getAccessToken()).toBe('stale');

    refuse(new Response('{}', { status: 401 }));
    await request;
    // The access screen shows; reopening the launch link brings the review back.
    expect(getAccessToken()).toBeNull();
    window.history.replaceState(null, '', '/#gavel-token=new');
    expect(getAccessToken()).toBe('new');
  });

  it('is taken when another tab stored the token the server refused', async () => {
    localStorage.setItem('gavel-access-token', 'refused-elsewhere');
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 401 }));
    await apiFetch('/api/diff');
    // Another tab, which still holds the refused token, writes it back.
    localStorage.setItem('gavel-access-token', 'refused-elsewhere');

    window.history.replaceState(null, '', '/#gavel-token=fresh');

    expect(getAccessToken()).toBe('fresh');
  });
});
