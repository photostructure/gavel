import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectAgentSession, readAgentSessionName } from './agent-session';

const threadId = '01a19e91-1182-7c53-b9af-60faeece2713';
let codexHome: string;

async function writeRollout(day: string, originator: string): Promise<void> {
  const directory = join(codexHome, 'sessions', ...day.split('-'));
  await mkdir(directory, { recursive: true });
  const meta = { type: 'session_meta', payload: { id: threadId, originator } };
  await writeFile(
    join(directory, `rollout-${day}T15-21-10-${threadId}.jsonl`),
    `${JSON.stringify(meta)}\n{"type":"event_msg"}\n`,
  );
}

beforeEach(async () => {
  codexHome = await mkdtemp(join(tmpdir(), 'gavel-codex-home-'));
});

afterEach(async () => {
  await rm(codexHome, { recursive: true, force: true });
});

describe('detectAgentSession', () => {
  it.each([
    { entrypoint: 'claude-desktop', agent: 'Claude Code desktop' },
    { entrypoint: 'cli', agent: 'Claude Code terminal' },
    { entrypoint: 'claude-vscode', agent: 'Claude Code VS Code' },
    { entrypoint: 'sdk-ts', agent: 'Claude Code (sdk-ts)' },
  ])('names Claude Code launched from $entrypoint', async ({ entrypoint, agent }) => {
    expect(
      await detectAgentSession({
        CLAUDE_CODE_ENTRYPOINT: entrypoint,
        CLAUDE_CODE_SESSION_ID: 'claude-session',
      }),
    ).toEqual({ agent, agentSessionId: 'claude-session' });
  });

  it.each([
    { originator: 'Codex Desktop', agent: 'Codex desktop' },
    // codex 0.164.0 lists codex_cli_rs beside codex-tui and codex-cli
    // (`strings <codex binary> | grep codex_cli_rs`), so it does not identify the terminal UI.
    { originator: 'codex_cli_rs', agent: 'Codex (codex_cli_rs)' },
    { originator: 'codex_exec', agent: 'Codex exec' },
    { originator: 'codex_vscode', agent: 'Codex (codex_vscode)' },
  ])(
    'names Codex from the thread rollout originator $originator',
    async ({ originator, agent }) => {
      await writeRollout('2026-11-02', originator);
      expect(
        await detectAgentSession({ CODEX_THREAD_ID: threadId, CODEX_HOME: codexHome }),
      ).toEqual({ agent, agentSessionId: threadId });
    },
  );

  it('identifies Codex without a rollout, without guessing its host from AI_AGENT', async () => {
    expect(
      await detectAgentSession({
        CODEX_THREAD_ID: threadId,
        CODEX_HOME: codexHome,
        AI_AGENT: 'github-copilot',
      }),
    ).toEqual({ agent: 'Codex', agentSessionId: threadId });
  });

  it('leaves the agent unset when Claude Code exports no entrypoint, even with AI_AGENT', async () => {
    expect(
      await detectAgentSession({
        CLAUDE_CODE_SESSION_ID: 'claude-session',
        AI_AGENT: 'claude-code_2-1-309_agent',
      }),
    ).toEqual({ agentSessionId: 'claude-session' });
  });

  it('prefers Claude Code when both hosts exported their variables', async () => {
    await writeRollout('2026-11-02', 'codex_exec');
    expect(
      await detectAgentSession({
        CLAUDE_CODE_ENTRYPOINT: 'cli',
        CLAUDE_CODE_SESSION_ID: 'claude-session',
        CODEX_THREAD_ID: threadId,
        CODEX_HOME: codexHome,
      }),
    ).toEqual({ agent: 'Claude Code terminal', agentSessionId: 'claude-session' });
  });

  it('names other agents from AI_AGENT, without a session ID', async () => {
    expect(await detectAgentSession({ AI_AGENT: 'github-copilot' })).toEqual({
      agent: 'github-copilot',
    });
  });

  it('prefers the Claude Code variables over AI_AGENT', async () => {
    expect(
      await detectAgentSession({
        AI_AGENT: 'claude-code_2-1-309_agent',
        CLAUDE_CODE_ENTRYPOINT: 'cli',
        CLAUDE_CODE_SESSION_ID: 'claude-session',
      }),
    ).toEqual({ agent: 'Claude Code terminal', agentSessionId: 'claude-session' });
  });

  it('names Claude Code from its entrypoint without a session ID, ignoring AI_AGENT', async () => {
    expect(
      await detectAgentSession({
        CLAUDE_CODE_ENTRYPOINT: 'cli',
        AI_AGENT: 'claude-code_2-1-309_agent',
      }),
    ).toEqual({ agent: 'Claude Code terminal' });
  });

  it('treats blank variables as unset', async () => {
    expect(
      await detectAgentSession({
        CLAUDE_CODE_SESSION_ID: ' ',
        CODEX_THREAD_ID: '',
        AI_AGENT: '  ',
      }),
    ).toEqual({});
  });

  it('detects nothing outside an agent', async () => {
    expect(await detectAgentSession({})).toEqual({});
  });
});

describe('readAgentSessionName', () => {
  const claudeSession = 'ce46f41a-af30-4e98-8251-49b0619a32df';
  let claudeHome: string;

  beforeEach(async () => {
    claudeHome = await mkdtemp(join(tmpdir(), 'gavel-claude-home-'));
  });

  afterEach(async () => {
    await rm(claudeHome, { recursive: true, force: true });
  });

  /** Writes the transcript under a project directory gavel cannot derive from its own cwd. */
  async function writeTranscript(...records: object[]): Promise<void> {
    const directory = join(claudeHome, 'projects', '-home-someone-elsewhere');
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, `${claudeSession}.jsonl`),
      records.map((record) => `${JSON.stringify(record)}\n`).join(''),
    );
  }

  const claudeEnv = () => ({
    CLAUDE_CODE_SESSION_ID: claudeSession,
    CLAUDE_CONFIG_DIR: claudeHome,
  });

  it('reads the newest custom title of a Claude Code session, over any automatic title', async () => {
    await writeTranscript(
      { type: 'ai-title', aiTitle: 'automatic one' },
      { type: 'custom-title', customTitle: 'first name' },
      { type: 'user', message: { content: 'the word "custom-title" in a prompt' } },
      { type: 'ai-title', aiTitle: 'automatic two' },
      { type: 'custom-title', customTitle: 'renamed' },
    );
    expect(await readAgentSessionName(claudeEnv())).toBe('renamed');
  });

  it('falls back to the newest automatic title of a Claude Code session', async () => {
    await writeTranscript(
      { type: 'ai-title', aiTitle: 'automatic one' },
      { type: 'ai-title', aiTitle: 'automatic two' },
    );
    expect(await readAgentSessionName(claudeEnv())).toBe('automatic two');
  });

  it('reads a rename made after an earlier read', async () => {
    await writeTranscript({ type: 'custom-title', customTitle: 'first name' });
    expect(await readAgentSessionName(claudeEnv())).toBe('first name');
    await writeTranscript(
      { type: 'custom-title', customTitle: 'first name' },
      { type: 'custom-title', customTitle: 'renamed' },
    );
    expect(await readAgentSessionName(claudeEnv())).toBe('renamed');
  });

  it('has no name for an untitled Claude Code session', async () => {
    await writeTranscript({ type: 'user', message: { content: 'hello' } });
    expect(await readAgentSessionName(claudeEnv())).toBeUndefined();
  });

  it('has no name for a Claude Code session without a transcript', async () => {
    expect(await readAgentSessionName(claudeEnv())).toBeUndefined();
    await mkdir(join(claudeHome, 'projects', '-home-someone'), { recursive: true });
    expect(await readAgentSessionName(claudeEnv())).toBeUndefined();
  });

  it('reads the newest thread name of a Codex thread from the session index', async () => {
    await writeFile(
      join(codexHome, 'session_index.jsonl'),
      [
        { id: threadId, thread_name: 'first name', updated_at: '2026-11-02T15:21:10Z' },
        { id: 'another-thread', thread_name: 'not this one', updated_at: '2026-11-02T15:22:10Z' },
        { id: threadId, thread_name: 'renamed', updated_at: '2026-11-02T15:23:10Z' },
      ]
        .map((record) => `${JSON.stringify(record)}\n`)
        .join(''),
    );
    expect(await readAgentSessionName({ CODEX_THREAD_ID: threadId, CODEX_HOME: codexHome })).toBe(
      'renamed',
    );
  });

  it('has no name for a Codex thread missing from the session index', async () => {
    expect(
      await readAgentSessionName({ CODEX_THREAD_ID: threadId, CODEX_HOME: codexHome }),
    ).toBeUndefined();
  });

  it('prefers the Claude Code session when both hosts exported their variables', async () => {
    await writeTranscript({ type: 'custom-title', customTitle: 'claude name' });
    await writeFile(
      join(codexHome, 'session_index.jsonl'),
      `${JSON.stringify({ id: threadId, thread_name: 'codex name' })}\n`,
    );
    expect(
      await readAgentSessionName({
        ...claudeEnv(),
        CODEX_THREAD_ID: threadId,
        CODEX_HOME: codexHome,
      }),
    ).toBe('claude name');
  });

  it('has no name outside Claude Code and Codex', async () => {
    expect(await readAgentSessionName({ AI_AGENT: 'github-copilot' })).toBeUndefined();
  });
});
