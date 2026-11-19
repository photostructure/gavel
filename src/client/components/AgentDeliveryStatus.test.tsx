import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ClientInboxDelivery as InboxDelivery } from '../hooks/useInboxDelivery';
import { copyTextToClipboard } from '../utils/clipboard';

import { AgentDeliveryAlert, AgentDeliveryStatus, deliveryDown } from './AgentDeliveryStatus';

vi.mock('../utils/clipboard', () => ({
  copyTextToClipboard: vi.fn().mockResolvedValue(undefined),
}));

const onReconnect = vi.fn();

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
      const { container } = render(
        <Component
          server="reachable"
          onReconnect={onReconnect}

          delivery={undefined}
        />,
      );
      expect(container).toBeEmptyDOMElement();
    });

    // One question per glance: will verdicts and comments reach the agent? A green awake robot
    // says yes, a red dead one says the reviewer must act, and a gray awake one says no agent
    // session takes them, which needs nothing from the reviewer.
    it.each([
      [{ status: 'ready' }, 'Agent available', 'available', 'awake', 'text-github-accent-text'],
      [
        { status: 'ready', transport: 'queue' },
        'Agent available',
        'available',
        'awake',
        'text-github-accent-text',
      ],
      [
        { status: 'unavailable' },
        'No agent session',
        'unattended',
        'awake',
        'text-github-text-muted',
      ],
      [
        { status: 'failed', at: '', error: 'connect ENOENT' },
        'Agent disconnected',
        'disconnected',
        'dead',
        'text-github-danger',
      ],
      [
        { status: 'uncertain', at: '', error: 'missing receipt' },
        'Delivery unconfirmed',
        'uncertain',
        'dead',
        'text-github-danger',
      ],
      [
        { status: 'pending' },
        'Delivering to agent',
        'delivering',
        'awake',
        'text-github-accent-text',
      ],
      [
        { status: 'pending', transport: 'queue' },
        'Delivering to agent',
        'delivering',
        'awake',
        'text-github-accent-text',
      ],
    ] satisfies [InboxDelivery, string, string, string, string][])(
      'shows %j in one icon button',
      (delivery, label, state, robot, color) => {
        const { container } = render(
          <Component
            server="reachable"
            onReconnect={onReconnect}

            delivery={delivery}
          />,
        );
        expect(screen.getAllByRole('button')).toHaveLength(1);
        expect(screen.getByRole('button', { name: label })).toHaveClass(
          'agent-delivery-button',
          color,
        );
        expect(container.querySelector('[data-delivery-state]')).toHaveAttribute(
          'data-delivery-state',
          state,
        );
        expect(container.querySelector('[data-robot]')).toHaveAttribute('data-robot', robot);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.queryByText('Copy resume prompt')).not.toBeInTheDocument();
        expect(container.querySelector('.animate-pulse')).not.toBeInTheDocument();
      },
    );

    // The delivery state is the server's last report; with the server gone, nothing reaches the
    // agent, whatever that report said.
    it.each([
      { status: 'ready' },
      { status: 'pending' },
      { status: 'sent', at: '', via: 'inbox', receivedAt: 0 },
    ] satisfies InboxDelivery[])('shows the server as unreachable over %j', (delivery) => {
      const { container } = render(
        <Component delivery={delivery} server="unreachable" onReconnect={onReconnect} />,
      );
      expect(screen.getByRole('button', { name: 'Server unreachable' })).toHaveClass(
        'text-github-danger',
      );
      expect(container.querySelector('[data-delivery-state]')).toHaveAttribute(
        'data-delivery-state',
        'unreachable',
      );
      expect(container.querySelector('[data-robot]')).toHaveAttribute('data-robot', 'dead');
    });

    it('says in its menu that the server is unreachable', () => {
      render(
        <Component delivery={{ status: 'ready' }} server="unreachable" onReconnect={onReconnect} />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Server unreachable' }));
      expect(
        screen.getByText(
          'The gavel server is unreachable. If it stopped, ask the agent to reopen this review, then click the robot. Verdicts and comments wait in this browser until then.',
        ),
      ).toBeInTheDocument();
    });

    // A click on the robot is the reviewer asking to reconnect, and still opens its details.
    it.each(['unreachable', 'reconnecting'] as const)(
      'reconnects and opens its menu when clicked while the server is %s',
      (server) => {
        render(
          <Component delivery={{ status: 'ready' }} server={server} onReconnect={onReconnect} />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Server unreachable' }));
        expect(onReconnect).toHaveBeenCalledOnce();
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      },
    );

    it('opens its menu without reconnecting while the server is reachable', () => {
      render(
        <Component delivery={{ status: 'ready' }} server="reachable" onReconnect={onReconnect} />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Agent available' }));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(onReconnect).not.toHaveBeenCalled();
    });

    // The server may still run elsewhere, so the robot's antenna asks where, in warning orange.
    it('shows a robot whose antenna is a question mark when another review holds its address', () => {
      const { container } = render(
        <Component delivery={{ status: 'ready' }} server="replaced" onReconnect={onReconnect} />,
      );
      expect(screen.getByRole('button', { name: 'Another review at this address' })).toHaveClass(
        'text-github-warning',
      );
      expect(container.querySelector('[data-delivery-state]')).toHaveAttribute(
        'data-delivery-state',
        'replaced',
      );
      expect(container.querySelector('[data-robot]')).toHaveAttribute('data-robot', 'asking');
    });

    it('says in its menu where verdicts and comments wait when another review holds its address', () => {
      render(
        <Component delivery={{ status: 'ready' }} server="replaced" onReconnect={onReconnect} />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Another review at this address' }));
      expect(onReconnect).toHaveBeenCalledOnce();
      expect(
        screen.getByText(
          "Verdicts and comments wait in this browser until this review's server is back at this address.",
        ),
      ).toBeInTheDocument();
    });

    it('copies a prompt asking its session to reopen the review when another review holds its address', async () => {
      render(
        <Component
          delivery={{ status: 'ready' }}
          server="replaced"
          onReconnect={onReconnect}
          review={{
            source: 'git',
            workingDirectory: '/src/repo',
            hostname: 'host',
            agentSessionId: 's-1',
          }}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Another review at this address' }));
      fireEvent.click(screen.getByRole('button', { name: 'Copy resume prompt' }));
      await waitFor(() => expect(copyTextToClipboard).toHaveBeenCalled());
      const prompt = vi.mocked(copyTextToClipboard).mock.lastCall?.[0];
      expect(prompt).toContain('- **Session ID:** `s-1`');
      expect(prompt).toContain('Reopen this review with gavel and send me its new link.');
      expect(prompt).not.toContain('comment snapshot');
    });

    it('names its agent session in the resume prompt while the server is reachable', async () => {
      render(
        <Component
          delivery={{ status: 'ready' }}
          server="reachable"
          onReconnect={onReconnect}
          review={{
            source: 'git',
            workingDirectory: '/src/repo',
            hostname: 'host',
            agentSessionId: 's-1',
          }}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Agent available' }));
      fireEvent.click(screen.getByRole('button', { name: 'Copy resume prompt' }));
      await waitFor(() => expect(copyTextToClipboard).toHaveBeenCalled());
      const prompt = vi.mocked(copyTextToClipboard).mock.lastCall?.[0];
      expect(prompt).toContain('- **Session ID:** `s-1`');
      expect(prompt).toContain('comment snapshot');
    });

    it('names the agent session its resume prompt is for in its menu, each value copyable', () => {
      render(
        <Component
          delivery={{ status: 'ready' }}
          server="reachable"
          onReconnect={onReconnect}
          review={{
            source: 'git',
            workingDirectory: '/src/repo',
            hostname: 'host',
            agentSessionName: 'TPP todo prioritization',
            agentSessionId: 's-1',
          }}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Agent available' }));
      expect(screen.getByText('Session name')).toBeInTheDocument();
      expect(screen.getByText('TPP todo prioritization')).toBeInTheDocument();
      expect(screen.getByText('Session ID')).toBeInTheDocument();
      expect(screen.getByText('s-1')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Copy session name' }));
      expect(copyTextToClipboard).toHaveBeenLastCalledWith('TPP todo prioritization');
      fireEvent.click(screen.getByRole('button', { name: 'Copy session ID' }));
      expect(copyTextToClipboard).toHaveBeenLastCalledWith('s-1');
    });

    it('says in its menu that it is reconnecting', () => {
      render(
        <Component
          delivery={{ status: 'ready' }}
          server="reconnecting"
          onReconnect={onReconnect}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Server unreachable' }));
      expect(
        screen.getByText(
          'Reconnecting to the gavel server… Verdicts and comments wait in this browser until it answers.',
        ),
      ).toBeInTheDocument();
    });

    it.each(['sent', 'queued'] as const)(
      'briefly confirms %s, expires, and confirms the next receipt',
      (status) => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-13T00:00:00Z'));
        const delivery = (at: string): InboxDelivery =>
          status === 'sent'
            ? { status, at, via: 'inbox', receivedAt: Date.now() }
            : { status, at, transport: 'queue', receivedAt: Date.now() };
        const { rerender } = render(
          <Component
            server="reachable"
            onReconnect={onReconnect}

            delivery={delivery(new Date().toISOString())}
          />,
        );
        expect(screen.getByRole('button', { name: 'Delivered to agent' })).toBeInTheDocument();
        act(() => vi.advanceTimersByTime(5_000));
        expect(screen.getByRole('button', { name: 'Agent available' })).toBeInTheDocument();
        rerender(
          <Component
            server="reachable"
            onReconnect={onReconnect}

            delivery={delivery(new Date().toISOString())}
          />,
        );
        expect(screen.getByRole('button', { name: 'Delivered to agent' })).toBeInTheDocument();
        rerender(
          <Component
            server="reachable"
            onReconnect={onReconnect}

            delivery={{ status: 'pending' }}
          />,
        );
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
          server="reachable"
          onReconnect={onReconnect}

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
          server="reachable"
          onReconnect={onReconnect}

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
      // A failed send usually means the chat restarted; the reviewer may still have it open.
      [
        { status: 'failed', at: '', error: 'connect ENOENT' },
        "Gavel could not reach the agent's chat (connect ENOENT). Copy the resume prompt and paste it into that chat, or into a new chat if it was closed or archived, and confirm when a new chat asks.",
      ],
      [{ status: 'uncertain', at: '', error: 'missing receipt' }, 'missing receipt'],
    ] satisfies [InboxDelivery, string][])(
      'opens details and recovery for %j',
      async (delivery, detail) => {
        vi.stubEnv('VITE_GAVEL_API_URL', 'http://10.1.1.24:4966');
        render(
          <Component
            server="reachable"
            onReconnect={onReconnect}

            delivery={delivery}
          />,
        );
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

// The comment cards draw an unsent comment unplugged exactly when the header robot is dead.
describe('deliveryDown', () => {
  it.each([
    ['ready', 'reachable', false],
    ['pending', 'reachable', false],
    ['unavailable', 'reachable', false],
    ['failed', 'reachable', true],
    ['uncertain', 'reachable', true],
    ['ready', 'reconnecting', true],
    ['ready', 'unreachable', true],
    ['failed', 'replaced', false],
    [undefined, 'unreachable', false],
  ] as const)('is %s with the server %s: %s', (status, server, down) => {
    expect(deliveryDown(status, server)).toBe(down);
  });
});
