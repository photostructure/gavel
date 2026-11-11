import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { copyTextToClipboard } from '../utils/clipboard';

import { AgentDeliveryAlert, AgentDeliveryStatus } from './AgentDeliveryStatus';

vi.mock('../utils/clipboard', () => ({
  copyTextToClipboard: vi.fn().mockResolvedValue(undefined),
}));

describe('agent delivery status', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('renders nothing when the server reports no delivery state', () => {
    const { container } = render(<AgentDeliveryStatus delivery={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    [{ status: 'ready' } as const, 'Your verdicts and comments go to the agent session'],
    [{ status: 'pending' } as const, 'Sending to the agent session'],
    [
      { status: 'sent', at: '2026-11-10T17:00:00.000Z', via: 'inbox' } as const,
      'Sent to the agent session',
    ],
  ])('reports %j as a status with no action', (delivery, text) => {
    render(<AgentDeliveryStatus delivery={delivery} />);
    expect(screen.getByRole('status')).toHaveAccessibleName(expect.stringContaining(text));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('is a status, not a control', () => {
    render(<AgentDeliveryStatus delivery={{ status: 'ready' }} />);
    expect(screen.getByRole('status')).not.toHaveAttribute('tabindex');
  });

  it('says a sent message reached the session, not that the agent read it', () => {
    render(
      <AgentDeliveryStatus
        delivery={{ status: 'sent', at: '2026-11-10T17:00:00.000Z', via: 'inbox' }}
      />,
    );
    expect(screen.getByRole('status')).toHaveAttribute(
      'title',
      expect.stringContaining('not that the agent has read it'),
    );
  });

  it('offers the resume prompt when delivery failed, with the error', async () => {
    vi.stubEnv('VITE_GAVEL_API_URL', 'http://10.1.1.24:4966');
    render(
      <AgentDeliveryStatus
        delivery={{ status: 'failed', at: '2026-11-10T17:00:00.000Z', error: 'connect ENOENT' }}
      />,
    );
    expect(screen.getByRole('status')).toHaveAttribute(
      'title',
      expect.stringContaining('connect ENOENT'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy resume prompt' }));
    await waitFor(() => expect(copyTextToClipboard).toHaveBeenCalled());
    expect(vi.mocked(copyTextToClipboard).mock.lastCall?.[0]).toContain(
      'comment snapshot --host 10.1.1.24 --port 4966',
    );
  });

  it('offers the resume prompt when no agent session owns the review', () => {
    render(<AgentDeliveryStatus delivery={{ status: 'unavailable' }} />);
    expect(screen.getByRole('status')).toHaveAccessibleName(
      expect.stringContaining('No agent session receives this review'),
    );
    expect(screen.getByRole('button', { name: 'Copy resume prompt' })).toBeInTheDocument();
  });
});

describe('agent delivery alert', () => {
  afterEach(() => vi.clearAllMocks());

  it('alerts with the error and the resume prompt when delivery failed', async () => {
    render(
      <AgentDeliveryAlert
        delivery={{ status: 'failed', at: '2026-11-10T17:00:00.000Z', error: 'connect ENOENT' }}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Your latest verdict or comment didn't reach the agent session: connect ENOENT",
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy resume prompt' }));
    await waitFor(() => expect(copyTextToClipboard).toHaveBeenCalled());
  });

  it.each([
    undefined,
    { status: 'ready' } as const,
    { status: 'pending' } as const,
    { status: 'sent', at: '2026-11-10T17:00:00.000Z', via: 'inbox' } as const,
    { status: 'unavailable' } as const,
  ])('stays silent for %j', (delivery) => {
    const { container } = render(<AgentDeliveryAlert delivery={delivery} />);
    expect(container).toBeEmptyDOMElement();
  });
});
