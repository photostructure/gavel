import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ReviewContext } from '../../types/diff';

import { buildResumePrompt } from './resumePrompt';

const review: ReviewContext = {
  source: 'git',
  repositoryName: 'gavel',
  repositoryPath: '/home/user/src/gavel',
  workingDirectory: '/home/user/src/gavel',
  hostname: 'devbox',
  agent: 'Claude Code',
  agentSessionName: 'fix the parser',
  agentSessionId: '0f3c2a7e-5d1b-4c8e-9a6f-2b7d4e1c8a90',
};

describe('buildResumePrompt', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('lists the agent session the review belongs to, so another chat asks first', () => {
    expect(buildResumePrompt(review)).toContain(
      [
        'This review belongs to this agent session:',
        '',
        '- **Agent:** Claude Code',
        '- **Session ID:** `0f3c2a7e-5d1b-4c8e-9a6f-2b7d4e1c8a90`',
        '- **Session name:** fix the parser',
        '- **Host:** devbox',
        '- **Repository:** gavel',
        '',
        'If you are not that session, say so and wait for me to confirm before you continue.',
      ].join('\n'),
    );
  });

  it('lists only the fields the review has', () => {
    const unnamed = { ...review, agent: undefined, agentSessionName: undefined };
    expect(buildResumePrompt(unnamed)).toContain(
      [
        '- **Session ID:** `0f3c2a7e-5d1b-4c8e-9a6f-2b7d4e1c8a90`',
        '- **Host:** devbox',
        '- **Repository:** gavel',
        '',
        'If you are not that session',
      ].join('\n'),
    );
  });

  it('says when no agent session owns the review', () => {
    const prompt = buildResumePrompt({ ...review, agentSessionId: undefined });
    expect(prompt).toContain(
      [
        'No agent session owns this review:',
        '',
        '- **Agent:** Claude Code',
        '- **Session ID:** none',
      ].join('\n'),
    );
    expect(prompt).not.toContain('If you are not that session');
  });

  it('puts the snapshot command in a code block', () => {
    vi.stubEnv('VITE_GAVEL_API_URL', 'http://10.1.1.24:4966');
    expect(buildResumePrompt(review)).toContain(
      '```sh\ngavel comment snapshot --host 10.1.1.24 --port 4966\n```',
    );
  });

  it('leaves the session out while the review has not loaded', () => {
    const prompt = buildResumePrompt(undefined);
    expect(prompt).not.toContain('This review belongs to');
    expect(prompt).not.toContain('agent session');
  });

  it('keeps the repository path out of the prompt', () => {
    expect(buildResumePrompt(review)).not.toContain('/home/user/');
  });

  // The snapshot command would read whichever server holds the address now: another review's.
  it('asks the session to reopen the review instead of reading the address another review now holds', () => {
    vi.stubEnv('VITE_GAVEL_API_URL', 'http://10.1.1.24:4966');
    const prompt = buildResumePrompt(review, { replaced: true });
    expect(prompt).toMatch(
      /^Another gavel review's server now runs at http:\/\/10\.1\.1\.24:4966, where my gavel review \S+ was, so do not read that server\./,
    );
    expect(prompt).toContain(
      'If you are not that session, say so and wait for me to confirm before you continue.',
    );
    expect(prompt).toContain('Reopen this review with gavel and send me its new link.');
    expect(prompt).not.toContain('comment snapshot');
  });
});
