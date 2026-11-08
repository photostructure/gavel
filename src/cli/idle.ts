import { Command } from 'commander';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export type RunCommand = (file: string, args: readonly string[]) => Promise<string>;

export interface IdleReading {
  /** Milliseconds since the last keyboard or mouse input in the desktop session. */
  idleMs: number;
  source: string;
}

const execFileAsync = promisify(execFile);

const runCommand: RunCommand = async (file, args) =>
  (await execFileAsync(file, args, { encoding: 'utf8' })).stdout;

// Each platform's idle time comes from a tool the OS already ships, so gavel
// needs no native module. Agents call this before opening a review to tell
// whether the user is at the desk.
const dbusSources = [
  {
    // KDE Plasma on X11, counting input even with the screensaver disabled. Under
    // Wayland KDE answers NotSupported, so the reading falls through to Mutter.
    source: 'org.freedesktop.ScreenSaver',
    args: ['/ScreenSaver', 'org.freedesktop.ScreenSaver.GetSessionIdleTime'],
  },
  {
    source: 'org.gnome.Mutter.IdleMonitor', // GNOME
    args: ['/org/gnome/Mutter/IdleMonitor/Core', 'org.gnome.Mutter.IdleMonitor.GetIdletime'],
  },
];

// GetLastInputInfo reports input in the caller's own session. An ssh session
// has never received keyboard or mouse input, so dwTime is 0 there and the
// script prints -1 rather than the machine's uptime.
const windowsScript = `$ProgressPreference = 'SilentlyContinue'
Add-Type -Namespace GavelIdle -Name Native -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)] public struct LastInputInfo { public uint cbSize; public uint dwTime; }
[DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LastInputInfo info);
[DllImport("kernel32.dll")] static extern uint GetTickCount();
public static long IdleMs() {
  var info = new LastInputInfo { cbSize = 8 };
  if (!GetLastInputInfo(ref info)) throw new System.ComponentModel.Win32Exception();
  if (info.dwTime == 0) return -1;
  return unchecked(GetTickCount() - info.dwTime);
}
'@
[GavelIdle.Native]::IdleMs()`;

function parse(output: string, pattern: RegExp, what: string): bigint {
  const match = pattern.exec(output);
  if (!match?.[1]) throw new Error(`Could not find ${what} in: ${output.trim()}`);
  return BigInt(match[1]);
}

export async function readIdle(platform: NodeJS.Platform, run: RunCommand): Promise<IdleReading> {
  switch (platform) {
    case 'linux': {
      const failures: string[] = [];
      for (const { source, args } of dbusSources) {
        try {
          const output = await run('dbus-send', [
            '--session',
            '--print-reply',
            `--dest=${source}`,
            ...args,
          ]);
          return { idleMs: Number(parse(output, /^\s*uint(?:32|64) (\d+)\s*$/m, 'uint')), source };
        } catch (error) {
          failures.push(`${source}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      throw new Error(`No idle-time source answered. ${failures.join('; ')}`);
    }
    case 'darwin': {
      const output = await run('ioreg', ['-c', 'IOHIDSystem']);
      const ns = parse(output, /"HIDIdleTime" = (\d+)/, 'HIDIdleTime');
      return { idleMs: Number(ns / 1_000_000n), source: 'IOHIDSystem' };
    }
    case 'win32': {
      const output = await run('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(windowsScript, 'utf16le').toString('base64'),
      ]);
      const idleMs = Number(parse(output, /^\s*(-?\d+)\s*$/m, 'an idle time'));
      if (idleMs < 0)
        throw new Error(
          'This Windows session has no keyboard or mouse input (an ssh session?); run gavel idle from the desktop session',
        );
      return { idleMs, source: 'GetLastInputInfo' };
    }
    default:
      throw new Error(`Idle time is not supported on ${platform}`);
  }
}

export function createIdleCommand(
  platform: NodeJS.Platform = process.platform,
  run: RunCommand = runCommand,
): Command {
  return new Command('idle')
    .description('Print how long the desktop user has been idle, as one JSON line')
    .addHelpText(
      'after',
      `
Prints {"idleMs": <milliseconds since the last keyboard or mouse input>, "source": <API>}.
Sources: org.freedesktop.ScreenSaver (KDE on X11) or org.gnome.Mutter.IdleMonitor (GNOME)
over D-Bus on Linux, IOHIDSystem's HIDIdleTime on macOS, GetLastInputInfo on Windows.

Exit codes: 0 = reading printed; 1 = no source answered (no desktop session, an ssh
session on Windows, KDE under Wayland, or an unsupported platform). Treat exit 1 as "the user may be away".
`,
    )
    .action(async () => {
      try {
        console.log(JSON.stringify(await readIdle(platform, run)));
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
}
