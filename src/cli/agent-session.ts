import { createReadStream } from 'node:fs';
import { access, readdir } from 'node:fs/promises';
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
      agent:
        originator === undefined
          ? 'Codex'
          : (CODEX_ORIGINATORS[originator] ?? `Codex (${originator})`),
      agentSessionId: codexThread,
    };
  }
  // AI_AGENT (from Vercel's @vercel/detect-agent) is the cross-tool convention for
  // naming an agent; it has no session ID counterpart.
  const otherAgent = toNotBlank(env.AI_AGENT);
  return otherAgent === undefined ? {} : { agent: otherAgent };
}

/**
 * Reads the current name of the Claude Code session in CLAUDE_CODE_SESSION_ID, else of the
 * Codex thread in CODEX_THREAD_ID: the newest custom title in the Claude Code transcript,
 * else its newest automatic title, or the newest Codex thread name in the session index.
 * Both files only grow, so the newest record wins, and they are streamed because a
 * transcript reaches tens of megabytes. Untitled and unrecorded sessions have no name.
 */
export async function readAgentSessionName(env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const claudeSession = toNotBlank(env.CLAUDE_CODE_SESSION_ID);
  if (claudeSession !== undefined) {
    const transcript = await findClaudeTranscript(
      join(toNotBlank(env.CLAUDE_CONFIG_DIR) ?? join(homedir(), '.claude'), 'projects'),
      claudeSession,
    );
    if (transcript === undefined) return undefined;
    let customTitle: string | undefined;
    let aiTitle: string | undefined;
    for await (const line of readLines(transcript)) {
      if (line.includes('"type":"custom-title"')) {
        customTitle = (JSON.parse(line) as { customTitle: string }).customTitle;
      } else if (line.includes('"type":"ai-title"')) {
        aiTitle = (JSON.parse(line) as { aiTitle: string }).aiTitle;
      }
    }
    return customTitle ?? aiTitle;
  }
  const codexThread = toNotBlank(env.CODEX_THREAD_ID);
  if (codexThread === undefined) return undefined;
  const index = join(
    toNotBlank(env.CODEX_HOME) ?? join(homedir(), '.codex'),
    'session_index.jsonl',
  );
  let threadName: string | undefined;
  try {
    for await (const line of readLines(index)) {
      const record = JSON.parse(line) as { id: string; thread_name: string };
      if (record.id === codexThread) threadName = record.thread_name;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  return threadName;
}

function readLines(path: string): AsyncIterable<string> {
  return createInterface({ input: createReadStream(path), crlfDelay: Infinity });
}

/**
 * Transcripts are stored as projects/<directory>/<session id>.jsonl, where the directory is
 * named after the session's starting directory, which gavel's working directory need not be.
 */
async function findClaudeTranscript(
  projects: string,
  sessionId: string,
): Promise<string | undefined> {
  let directories: string[];
  try {
    directories = await readdir(projects);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  for (const directory of directories) {
    const transcript = join(projects, directory, `${sessionId}.jsonl`);
    try {
      await access(transcript);
      return transcript;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return undefined;
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
