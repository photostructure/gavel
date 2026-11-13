import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ClientInboxDelivery as InboxDelivery } from '../hooks/useInboxDelivery';
import { copyTextToClipboard } from '../utils/clipboard';

import { AgentDeliveryAlert, AgentDeliveryStatus } from './AgentDeliveryStatus';

vi.mock('../utils/clipboard', () => ({
  copyTextToClipboard: vi.fn().mockResolvedValue(undefined),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

for (const [name, Component] of [
  ['desktop', AgentDeliveryStatus],
  ['phone', AgentDeliveryAlert],
] as const) {
  describe(`${name} agent delivery`, () => {
    it('renders nothing for servers without delivery state', () => {
      const { container } = render(<Component delivery={undefined} />);
      expect(container).toBeEmptyDOMElement();
    });

    it.each([
      [{ status: 'ready' }, 'Agent available', 'available'],
      [{ status: 'ready', transport: 'queue' }, 'Agent available', 'available'],
      [{ status: 'unavailable' }, 'Agent disconnected', 'disconnected'],
      [{ status: 'failed', at: '', error: 'connect ENOENT' }, 'Agent disconnected', 'disconnected'],
      [
        { status: 'uncertain', at: '', error: 'missing receipt' },
        'Delivery unconfirmed',
        'uncertain',
      ],
      [{ status: 'pending' }, 'Delivering to agent', 'delivering'],
      [{ status: 'pending', transport: 'queue' }, 'Delivering to agent', 'delivering'],
    ] satisfies [InboxDelivery, string, string][])(
      'shows %j in one icon button',
      (delivery, label, state) => {
        const { container } = render(<Component delivery={delivery} />);
        expect(screen.getAllByRole('button')).toHaveLength(1);
        expect(screen.getByRole('button', { name: label })).toHaveClass('agent-delivery-button');
        expect(container.querySelector('[data-delivery-state]')).toHaveAttribute(
          'data-delivery-state',
          state,
        );
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.queryByText('Copy resume prompt')).not.toBeInTheDocument();
        expect(container.querySelector('.animate-pulse')).not.toBeInTheDocument();
      },
    );

    it.each(['sent', 'queued'] as const)(
      'briefly confirms %s, expires, and confirms the next receipt',
      (status) => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-13T00:00:00Z'));
        const delivery = (at: string): InboxDelivery =>
          status === 'sent'
            ? { status, at, via: 'inbox', receivedAt: Date.now() }
            : { status, at, transport: 'queue', receivedAt: Date.now() };
        const { rerender } = render(<Component delivery={delivery(new Date().toISOString())} />);
        expect(screen.getByRole('button', { name: 'Delivered to agent' })).toBeInTheDocument();
        act(() => vi.advanceTimersByTime(5_000));
        expect(screen.getByRole('button', { name: 'Agent available' })).toBeInTheDocument();
        rerender(<Component delivery={delivery(new Date().toISOString())} />);
        expect(screen.getByRole('button', { name: 'Delivered to agent' })).toBeInTheDocument();
        rerender(<Component delivery={{ status: 'pending' }} />);
        expect(screen.getByRole('button', { name: 'Delivering to agent' })).toBeInTheDocument();
        act(() => vi.advanceTimersByTime(5_000));
        expect(screen.getByRole('button', { name: 'Delivering to agent' })).toBeInTheDocument();
      },
    );

    // The UI contract is a five-second confirmation, including a phone whose clock
    // is behind the server: simulate that offset with vi.setSystemTime.
    it('bounds confirmation when the server clock is ahead', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-13T00:00:00Z'));
      render(
        <Component
          delivery={{
            status: 'queued',
            at: '2026-11-13T00:01:00Z',
            transport: 'queue',
            receivedAt: Date.now(),
          }}
        />,
      );
      expect(screen.getByRole('button', { name: 'Delivered to agent' })).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(5_000));
      expect(screen.getByRole('button', { name: 'Agent available' })).toBeInTheDocument();
    });

    it.each(['sent', 'queued'] as const)('does not replay an old %s receipt on mount', (status) => {
      render(
        <Component
          delivery={
            status === 'sent'
              ? { status, at: '2020-01-01', via: 'inbox' }
              : { status, at: '2020-01-01', transport: 'queue' }
          }
        />,
      );
      expect(screen.getByRole('button', { name: 'Agent available' })).toBeInTheDocument();
    });

    it.each([
      [
        { status: 'queued', at: '2020-01-01', transport: 'queue' },
        'does not confirm a running turn',
      ],
      [{ status: 'sent', at: '2020-01-01', via: 'inbox' }, 'not that the agent has read it'],
      [{ status: 'failed', at: '', error: 'connect ENOENT' }, 'connect ENOENT'],
      [{ status: 'uncertain', at: '', error: 'missing receipt' }, 'missing receipt'],
    ] satisfies [InboxDelivery, string][])(
      'opens details and recovery for %j',
      async (delivery, detail) => {
        vi.stubEnv('VITE_GAVEL_API_URL', 'http://10.1.1.24:4966');
        render(<Component delivery={delivery} />);
        const trigger = screen.getByRole('button');
        fireEvent.click(trigger);
        expect(await screen.findByRole('dialog')).toHaveTextContent(detail);
        fireEvent.click(screen.getByRole('button', { name: 'Copy resume prompt' }));
        await waitFor(() => expect(copyTextToClipboard).toHaveBeenCalled());
        expect(vi.mocked(copyTextToClipboard).mock.lastCall?.[0]).toContain(
          'comment snapshot --host 10.1.1.24 --port 4966',
        );
        expect(screen.getByRole('button', { name: 'Resume prompt copied' })).toBeInTheDocument();
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        await waitFor(() => expect(trigger).toHaveFocus());
      },
    );
  });
}
