import { describe, expect, it, vi } from 'vitest';

import { createCliStdoutProxy } from './dev-stdout.js';

describe('createCliStdoutProxy', () => {
  it('detects legacy readiness once and forwards diagnostics and line endings unchanged', () => {
    const onServerUrl = vi.fn();
    const output: string[] = [];
    const proxy = createCliStdoutProxy({ onServerUrl, onOutput: (text) => output.push(text) });
    const chunks = [
      '\nPort 4966 is busy, trying 4967...\r\n🚀 gavel server started on http://local',
      'host:4967#gavel-editor-token=legacy-capability\r\n📋 Reviewing: HEAD\n\n',
      '🚀 gavel server started on http://localhost:4999\n\n',
    ];
    for (const chunk of chunks) proxy.push(chunk);
    proxy.flush();
    expect(onServerUrl).toHaveBeenCalledExactlyOnceWith(
      'http://localhost:4967#gavel-editor-token=legacy-capability',
    );
    expect(output.join('')).toBe(chunks.join(''));
  });

  it('detects JSONL readiness across chunks and forwards every event unchanged', () => {
    const onServerUrl = vi.fn();
    const output: string[] = [];
    const proxy = createCliStdoutProxy({ onServerUrl, onOutput: (text) => output.push(text) });
    const ready = JSON.stringify({
      type: 'server.ready',
      url: 'http://localhost:4981',
      launchUrl: 'http://localhost:4981#gavel-editor-token=jsonl-capability',
      port: 4981,
    });
    const comment = JSON.stringify({ type: 'comment.created', body: 'line one\nline two' });
    proxy.push(ready.slice(0, 17));
    expect(onServerUrl).not.toHaveBeenCalled();
    proxy.push(`${ready.slice(17)}\n${comment}\n`);
    proxy.flush();
    expect(onServerUrl).toHaveBeenCalledExactlyOnceWith(
      'http://localhost:4981#gavel-editor-token=jsonl-capability',
    );
    expect(output.join('')).toBe(`${ready}\n${comment}\n`);
  });

  it('detects a final readiness line without a newline when flushed', () => {
    const onServerUrl = vi.fn();
    const output: string[] = [];
    const proxy = createCliStdoutProxy({ onServerUrl, onOutput: (text) => output.push(text) });
    const ready = JSON.stringify({ type: 'server.ready', url: 'http://localhost:4981' });
    proxy.push(ready);
    proxy.flush();
    proxy.flush();
    expect(onServerUrl).toHaveBeenCalledExactlyOnceWith('http://localhost:4981');
    expect(output.join('')).toBe(ready);
  });

  it('forwards blank lines and incomplete diagnostics even when no server starts', () => {
    const onServerUrl = vi.fn();
    const output: string[] = [];
    const proxy = createCliStdoutProxy({ onServerUrl, onOutput: (text) => output.push(text) });
    proxy.push('\n\nPort 4966 is busy, trying 4967...\ncompiler error');
    proxy.flush();
    expect(onServerUrl).not.toHaveBeenCalled();
    expect(output.join('')).toBe('\n\nPort 4966 is busy, trying 4967...\ncompiler error');
  });

  it('does not treat comment text containing a server URL as readiness', () => {
    const onServerUrl = vi.fn();
    const output: string[] = [];
    const proxy = createCliStdoutProxy({ onServerUrl, onOutput: (text) => output.push(text) });
    const comment = JSON.stringify({
      type: 'comment.created',
      body: '🚀 gavel server started on http://localhost:4981',
    });
    proxy.push(`${comment}\n`);
    expect(onServerUrl).not.toHaveBeenCalled();
    expect(output.join('')).toBe(`${comment}\n`);
  });
});
