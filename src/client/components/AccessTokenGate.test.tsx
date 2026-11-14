import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from '../utils/accessToken';

import { AccessTokenGate } from './AccessTokenGate';

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
