import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { copyTextToClipboard } from '../utils/clipboard';

import { ReviewPresenceIndicator } from './ReviewPresenceIndicator';

vi.mock('../utils/clipboard', () => ({
  copyTextToClipboard: vi.fn().mockResolvedValue(undefined),
}));

describe('review listener indicator', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });
  it('offers a human-initiated resume prompt when no agent listener is attached', async () => {
    vi.stubEnv('VITE_GAVEL_API_URL', 'http://10.1.1.24:4966');
    render(
      <ReviewPresenceIndicator
        presence={{ reviewers: { connected: 1, visible: 1 }, listeners: 0 }}
      />,
    );
    expect(screen.getByText('No agent listener')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy resume prompt' }));
    await waitFor(() => expect(copyTextToClipboard).toHaveBeenCalled());
    expect(vi.mocked(copyTextToClipboard).mock.lastCall?.[0]).toContain(
      'comment snapshot --host 10.1.1.24 --port 4966',
    );
    expect(vi.mocked(copyTextToClipboard).mock.lastCall?.[0]).toContain(
      'End the turn when caught up',
    );
    expect(vi.mocked(copyTextToClipboard).mock.lastCall?.[0]).not.toContain('/home/mrm/');
  });

  it('distinguishes an attached listener from message consumption', () => {
    render(
      <ReviewPresenceIndicator
        presence={{ reviewers: { connected: 2, visible: 1 }, listeners: 1 }}
      />,
    );
    expect(screen.getByText('Agent listener attached')).toHaveAttribute(
      'title',
      expect.stringContaining('does not mean a comment has been read'),
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('preserves HTTPS instead of suggesting an HTTP request to the TLS port', async () => {
    vi.stubEnv('VITE_GAVEL_API_URL', 'https://review.local');
    render(<ReviewPresenceIndicator presence={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy resume prompt' }));
    await waitFor(() => expect(copyTextToClipboard).toHaveBeenCalled());
    expect(vi.mocked(copyTextToClipboard).mock.lastCall?.[0]).toContain(
      'https://review.local/api/conversation/snapshot over HTTPS',
    );
    expect(vi.mocked(copyTextToClipboard).mock.lastCall?.[0]).not.toContain('--port 443');
  });
});
