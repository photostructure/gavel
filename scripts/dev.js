#!/usr/bin/env node
import { spawn } from 'child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { getCompileCloseExitCode } from '../dev/dev-lifecycle.js';
import { createCliStdoutProxy } from '../dev/dev-stdout.js';
import { createOutputWriter } from '../dev/dev-output.js';
import { getManagedSpawnOptions, stopProcessTree } from '../dev/dev-process.js';

const require = createRequire(import.meta.url);
const compilerCli = join(dirname(require.resolve('typescript/package.json')), 'bin', 'tsc');
const viteCli = join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
const rawArgs = process.argv.slice(2);
// The CLI never opens its own page here; Vite opens the dev UI unless the caller passed --no-open.
const openBrowser = !rawArgs.includes('--no-open');
const cliArgs = openBrowser ? [...rawArgs, '--no-open'] : rawArgs;
const writeStdout = createOutputWriter(process.stdout);
const writeStderr = createOutputWriter(process.stderr);

// Wait for CLI server to be ready, then start Vite
let cliProcess = null;
let compileProcess = null;
let viteProcess = null;
let isShuttingDown = false;

function startVite(cliServerUrl) {
  if (viteProcess) return;
  writeStderr('🚀 Starting Vite dev server...\n');
  const serverUrl = new URL(cliServerUrl);
  viteProcess = spawn(process.execPath, [viteCli, '--clearScreen=false'], {
    ...getManagedSpawnOptions(),
    stdio: ['inherit', 'pipe', 'pipe'],
    env: {
      ...process.env,
      VITE_GAVEL_API_URL: serverUrl.origin,
      ...(openBrowser ? { GAVEL_VITE_OPEN_PATH: `/${serverUrl.search}${serverUrl.hash}` } : {}),
    },
  });
  viteProcess.stdout.on('data', writeStderr);
  viteProcess.stderr.on('data', writeStderr);
}

const cliStdoutProxy = createCliStdoutProxy({
  onServerUrl: startVite,
  onOutput: writeStdout,
});
const cliStderrProxy = createCliStdoutProxy({
  onServerUrl: startVite,
  onOutput: writeStderr,
});

function startCliProcess() {
  cliProcess = spawn(process.execPath, ['dist/cli/index.js', ...cliArgs], {
    // Keep stdin attached so CLI can decide stdin mode by itself.
    ...getManagedSpawnOptions(),
    stdio: ['inherit', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'development',
    },
  });

  cliProcess.stdout.setEncoding('utf8');
  cliProcess.stderr.setEncoding('utf8');
  cliProcess.stdout.on('data', (data) => {
    // Wait for CLI server before starting Vite to prevent proxy connection errors.
    // Forward JSONL intact while readiness starts the Vite UI.
    cliStdoutProxy.push(data);
  });

  cliProcess.stderr.on('data', (data) => cliStderrProxy.push(data));

  cliProcess.on('close', (code) => {
    cliStdoutProxy.flush();
    cliStderrProxy.flush();

    if (code !== 0 && code !== null && !isShuttingDown) {
      writeStderr(`CLI server exited with code ${code}\n`);
    }

    stopProcessTree(viteProcess, 'SIGINT');

    // Let queued stdout/stderr writes drain, including the final shutdown event.
    process.exitCode = code || 0;
  });
}

function startCompileProcess() {
  compileProcess = spawn(process.execPath, [compilerCli, '--project', 'tsconfig.cli.json'], {
    ...getManagedSpawnOptions(),
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  compileProcess.stdout.on('data', writeStderr);
  compileProcess.stderr.on('data', writeStderr);

  compileProcess.on('close', (code) => {
    compileProcess = null;

    const exitCode = getCompileCloseExitCode(code, isShuttingDown);

    if (exitCode !== null) {
      process.exitCode = exitCode;
      return;
    }

    startCliProcess();
  });
}

function shutdown(signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  stopProcessTree(compileProcess, signal);
  stopProcessTree(cliProcess, signal);
  stopProcessTree(viteProcess, signal);
}

process.on('SIGINT', () => {
  shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});

process.on('SIGHUP', () => {
  shutdown('SIGTERM');
});

startCompileProcess();
