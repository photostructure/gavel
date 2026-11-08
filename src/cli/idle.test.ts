import { afterEach, describe, expect, it, vi } from 'vitest';

import { createIdleCommand, readIdle, type RunCommand } from './idle.js';

// Outputs captured on real hosts (2026-11-04): speedy (KDE Plasma, X11) via
// `dbus-send --session --print-reply --dest=org.freedesktop.ScreenSaver /ScreenSaver
// org.freedesktop.ScreenSaver.GetSessionIdleTime`, m1 (macOS) via `ioreg -c IOHIDSystem`.
const kdeReply = `method return time=1793819175.760337 sender=:1.41 -> destination=:1.137996 serial=11916 reply_serial=2
   uint32 3012
`;
const mutterReply = `method return time=1793819175.760337 sender=:1.41 -> destination=:1.13 serial=7 reply_serial=2
   uint64 125000
`;
const ioregOutput = `    | |   {
    | | |   "HIDIdleTime" = 55155262251750
    | | |   "HIDParameters" = {}
`;

function runner(outputs: Record<string, string | Error>): RunCommand {
  return vi.fn((file: string, args: readonly string[]) => {
    const key = [file, ...args].find((part) => part in outputs) ?? file;
    const output = outputs[key];
    if (output === undefined) return Promise.reject(new Error(`${file}: not found`));
    return output instanceof Error ? Promise.reject(output) : Promise.resolve(output);
  });
}

describe('readIdle', () => {
  it('reads the freedesktop ScreenSaver idle time on Linux', async () => {
    await expect(
      readIdle('linux', runner({ '--dest=org.freedesktop.ScreenSaver': kdeReply })),
    ).resolves.toEqual({ idleMs: 3012, source: 'org.freedesktop.ScreenSaver' });
  });

  it('falls back to the GNOME Mutter idle monitor', async () => {
    const run = runner({
      '--dest=org.freedesktop.ScreenSaver': new Error('ServiceUnknown'),
      '--dest=org.gnome.Mutter.IdleMonitor': mutterReply,
    });
    await expect(readIdle('linux', run)).resolves.toEqual({
      idleMs: 125000,
      source: 'org.gnome.Mutter.IdleMonitor',
    });
  });

  it('converts macOS HIDIdleTime from nanoseconds', async () => {
    await expect(readIdle('darwin', runner({ ioreg: ioregOutput }))).resolves.toEqual({
      idleMs: 55155262,
      source: 'IOHIDSystem',
    });
  });

  it('reads GetLastInputInfo on Windows', async () => {
    await expect(readIdle('win32', runner({ 'powershell.exe': '42000\r\n' }))).resolves.toEqual({
      idleMs: 42000,
      source: 'GetLastInputInfo',
    });
  });

  it('rejects a Windows session that has never seen input, as over ssh', async () => {
    // swift over ssh: GetLastInputInfo succeeds with dwTime=0, so the script prints -1.
    await expect(readIdle('win32', runner({ 'powershell.exe': '-1\r\n' }))).rejects.toThrow(
      'no keyboard or mouse input',
    );
  });

  it('rejects when no Linux source answers', async () => {
    await expect(readIdle('linux', runner({}))).rejects.toThrow(
      'org.freedesktop.ScreenSaver: dbus-send: not found',
    );
  });

  it('rejects output it cannot parse instead of guessing', async () => {
    await expect(readIdle('darwin', runner({ ioreg: '{}' }))).rejects.toThrow('HIDIdleTime');
  });

  it('rejects an unsupported platform', async () => {
    await expect(readIdle('aix', runner({}))).rejects.toThrow('aix');
  });
});

describe('gavel idle', () => {
  afterEach(() => {
    process.exitCode = 0;
    vi.restoreAllMocks();
  });

  it('prints one JSON reading', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await createIdleCommand(
      'linux',
      runner({ '--dest=org.freedesktop.ScreenSaver': kdeReply }),
    ).parseAsync(['node', 'gavel']);
    expect(log).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({ idleMs: 3012, source: 'org.freedesktop.ScreenSaver' }),
    );
    expect(process.exitCode ?? 0).toBe(0);
  });

  it('exits 1 with the reason when idle time is unavailable', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await createIdleCommand('aix', runner({})).parseAsync(['node', 'gavel']);
    expect(log).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('aix'));
    expect(process.exitCode).toBe(1);
  });
});
