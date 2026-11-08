import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

export interface AgentSession {
  agent?: string;
  agentSessionId?: string;
}

const CLAUDE_CODE_ENTRYPOINTS: Record<string, string> = {
  'claude-desktop': 'Claude Code desktop',
  cli: 'Claude Code terminal',
  'claude-vscode': 'Claude Code VS Code',
};

const CODEX_ORIGINATORS: Record<string, string> = {
  'Codex Desktop': 'Codex desktop',
  codex_exec: 'Codex exec',
};

interface CodexSessionMeta {
  payload: { originator: string };
}

/** Returns `value` trimmed, or undefined when it is missing or only whitespace. */
function toNotBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Identifies the agent whose shell launched gavel from the variables Claude Code
 * and Codex export to it, falling back to AI_AGENT for other agents. Claude Code
 * and Codex can both be present when one agent runs inside the other; Claude
 * Code is chosen then, and --agent/--agent-session-id override it.
 * Claude Code keeps an inherited CLAUDE_CODE_ENTRYPOINT, so a session started
 * from another session's shell (such as `claude -p` run by a desktop session)
 * reports the outer host and must pass --agent itself.
 * Blank variables count as unset. The agent is left unset, never guessed, when
 * the host's variables do not name it.
 */
export async function detectAgentSession(env: NodeJS.ProcessEnv): Promise<AgentSession> {
  const claudeSession = toNotBlank(env.CLAUDE_CODE_SESSION_ID);
  const entrypoint = toNotBlank(env.CLAUDE_CODE_ENTRYPOINT);
  if (claudeSession !== undefined || entrypoint !== undefined) {
    return {
      ...(entrypoint === undefined
        ? {}
        : { agent: CLAUDE_CODE_ENTRYPOINTS[entrypoint] ?? `Claude Code (${entrypoint})` }),
      ...(claudeSession === undefined ? {} : { agentSessionId: claudeSession }),
    };
  }
  const codexThread = toNotBlank(env.CODEX_THREAD_ID);
  if (codexThread !== undefined) {
    // Codex exports no host name; the thread's rollout records it as `originator`.
    const originator = await readCodexOriginator(
      toNotBlank(env.CODEX_HOME) ?? join(homedir(), '.codex'),
      codexThread,
    );
    return {
      ...(originator === undefined
        ? {}
        : { agent: CODEX_ORIGINATORS[originator] ?? `Codex (${originator})` }),
      agentSessionId: codexThread,
    };
  }
  // AI_AGENT (from Vercel's @vercel/detect-agent) is the cross-tool convention for
  // naming an agent; it has no session ID counterpart.
  const otherAgent = toNotBlank(env.AI_AGENT);
  return otherAgent === undefined ? {} : { agent: otherAgent };
}

async function readCodexOriginator(
  codexHome: string,
  threadId: string,
): Promise<string | undefined> {
  const rollout = await findCodexRollout(join(codexHome, 'sessions'), threadId);
  if (!rollout) return undefined;
  // The first line is the session metadata; later lines can add up to megabytes.
  const input = createReadStream(rollout);
  try {
    for await (const line of createInterface({ input, crlfDelay: Infinity })) {
      return (JSON.parse(line) as CodexSessionMeta).payload.originator;
    }
    return undefined;
  } finally {
    input.destroy();
  }
}

async function newestFirst(directory: string): Promise<string[]> {
  return (await readdir(directory)).sort().reverse();
}

/** Rollouts are stored as sessions/YYYY/MM/DD/rollout-<timestamp>-<thread id>.jsonl. */
async function findCodexRollout(sessions: string, threadId: string): Promise<string | undefined> {
  let years: string[];
  try {
    years = await newestFirst(sessions);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  const suffix = `-${threadId}.jsonl`;
  for (const year of years) {
    for (const month of await newestFirst(join(sessions, year))) {
      for (const day of await newestFirst(join(sessions, year, month))) {
        const directory = join(sessions, year, month, day);
        const rollout = (await readdir(directory)).find((name) => name.endsWith(suffix));
        if (rollout) return join(directory, rollout);
      }
    }
  }
  return undefined;
}
