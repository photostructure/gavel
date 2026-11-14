import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from '../utils/accessToken';
import { copyTextToClipboard } from '../utils/clipboard';

import { AccessTokenGate } from './AccessTokenGate';

vi.mock('../utils/clipboard', () => ({
  copyTextToClipboard: vi.fn().mockResolvedValue(undefined),
}));

const renderGate = () =>
  render(
    <AccessTokenGate>
      <p>review</p>
    </AccessTokenGate>,
  );

describe('AccessTokenGate', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('shows only the access screen to a page without a token', () => {
    renderGate();
    expect(screen.queryByText('review')).toBeNull();
    expect(screen.getByText("This page needs gavel's access token")).toBeTruthy();
  });

  it('copies a prompt asking the agent for this address with the token, never the token itself', async () => {
    // A refused token's fragment must not reach the prompt; the comment-link place must.
    window.history.replaceState(
      null,
      '',
      '/?review=a#gavel-token=refused&file=src/parse.ts&line=40-52',
    );
    localStorage.setItem('gavel-access-token', 'refused');
    renderGate();
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 401 }));
    await act(() => apiFetch('/api/diff'));

    fireEvent.click(screen.getByRole('button', { name: 'Copy prompt for your agent' }));
    await waitFor(() => expect(copyTextToClipboard).toHaveBeenCalledTimes(1));
    const prompt = vi.mocked(copyTextToClipboard).mock.lastCall?.[0];
    expect(prompt).toContain(`${window.location.origin}/?review=a#gavel-token=`);
    expect(prompt).toContain(
      '/access-token on the machine running gavel>&file=src/parse.ts&line=40-52',
    );
    expect(prompt).toContain('${GAVEL_CONFIG_DIR:-$HOME/.gavel}/access-token');
    expect(prompt).not.toContain('refused');
    expect(await screen.findByRole('button', { name: 'Prompt copied' })).toBeTruthy();
  });

  it('keeps the launch link token, so a later visit without it still shows the review', () => {
    window.history.replaceState(null, '', '/?review=a#gavel-token=t1');
    renderGate().unmount();

    window.history.replaceState(null, '', '/?review=a');
    renderGate();
    expect(screen.getByText('review')).toBeTruthy();
  });

  it('sends the token with each API request', async () => {
    window.history.replaceState(null, '', '/#gavel-token=t2');
    vi.mocked(fetch).mockResolvedValue(new Response('{}'));
    await apiFetch('/api/diff', { headers: { Accept: 'application/json' } });
    expect(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.headers).toEqual({
      Accept: 'application/json',
      'X-Gavel-Token': 't2',
    });
  });

  it('does not store a refused launch link token again', async () => {
    window.history.replaceState(null, '', '/#gavel-token=rotated');
    renderGate();
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 401 }));
    await act(() => apiFetch('/api/diff'));
    expect(screen.queryByText('review')).toBeNull();
    expect(localStorage.getItem('gavel-access-token')).toBeNull();
  });

  it('replaces the review with the access screen once the server refuses the token', async () => {
    localStorage.setItem('gavel-access-token', 'stale');
    renderGate();
    expect(screen.getByText('review')).toBeTruthy();

    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 401 }));
    await act(() => apiFetch('/api/diff'));
    expect(screen.queryByText('review')).toBeNull();
    expect(localStorage.getItem('gavel-access-token')).toBeNull();
  });
});
