// ~/.gavel/config.json holds the auto-viewed patterns, which apply to files
// rather than screens and so are shared by every browser.
import { promises as fs } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

export interface UserConfig {
  autoViewedPatterns: string[];
}

const CONFIG_VERSION = 1 as const;

// Generous ceiling for the user config; anything larger is a bug or abuse.
export const MAX_USER_CONFIG_BYTES = 64 * 1024;

export function getUserConfigPath(): string {
  const configDir = process.env.GAVEL_CONFIG_DIR?.trim();
  if (configDir) {
    return join(configDir, 'config.json');
  }
  return join(homedir(), '.gavel', 'config.json');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

// A missing file means nothing is saved yet. Any other failure throws, so a
// hand-edited file with a typo is reported instead of overwritten.
async function readConfigFile(path: string): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await fs.readFile(path, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${(error as Error).message}`);
  }
  if (!isPlainObject(parsed)) {
    throw new Error(`${path} does not hold a JSON object`);
  }
  return parsed;
}

export async function readUserConfig(path: string = getUserConfigPath()): Promise<UserConfig> {
  const raw = await readConfigFile(path);
  return {
    autoViewedPatterns: isStringArray(raw.autoViewedPatterns) ? raw.autoViewedPatterns : [],
  };
}

export function parseAutoViewedPatternsBody(body: unknown): string[] | null {
  return isPlainObject(body) && isStringArray(body.patterns) ? body.patterns : null;
}

export async function writeAutoViewedPatterns(
  patterns: string[],
  path: string = getUserConfigPath(),
): Promise<void> {
  const raw = await readConfigFile(path);
  const next = { ...raw, version: CONFIG_VERSION, autoViewedPatterns: patterns };

  const serialized = `${JSON.stringify(next, null, 2)}\n`;
  if (Buffer.byteLength(serialized, 'utf-8') > MAX_USER_CONFIG_BYTES) {
    throw new Error('The user config exceeds the maximum allowed size');
  }

  await fs.mkdir(dirname(path), { recursive: true });
  // Write via a temp file + rename so a crash mid-write can't corrupt the config.
  const tmpPath = `${path}.${process.pid}.tmp`;
  await fs.writeFile(tmpPath, serialized, 'utf-8');
  await fs.rename(tmpPath, path);
}
