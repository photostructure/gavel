import { useEffect, useState } from 'react';

import { name } from '../../../package.json';

export type LatestRelease =
  | { state: 'checking' }
  | { state: 'found'; version: string }
  | { state: 'failed' }
  | { state: 'off'; reason: string };

const latestUrl = `https://registry.npmjs.org/${name.replace('/', '%2f')}/latest`;
const releaseVersion = /^(\d+)\.(\d+)\.(\d+)$/;

/** Whether `candidate` is a later x.y.z release than `current`, comparing each part as a number. */
export function isNewerRelease(candidate: string, current: string): boolean {
  const [major, minor, patch] = releaseParts(candidate);
  const [currentMajor, currentMinor, currentPatch] = releaseParts(current);
  if (major !== currentMajor) return major > currentMajor;
  if (minor !== currentMinor) return minor > currentMinor;
  return patch > currentPatch;
}

function releaseParts(version: string): [number, number, number] {
  const match = releaseVersion.exec(version);
  if (!match) throw new Error(`Not an x.y.z release version: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

async function fetchLatestVersion(): Promise<string> {
  const response = await fetch(latestUrl);
  if (!response.ok) throw new Error(`npm answered ${response.status}`);
  const body = (await response.json()) as { version?: unknown };
  if (typeof body.version !== 'string' || !releaseVersion.test(body.version)) {
    throw new Error(`npm answered an unexpected version: ${String(body.version)}`);
  }
  return body.version;
}

// The first About open in a page starts the request; later opens reuse its answer until reload.
let latestVersion: Promise<string> | undefined;

/** Forgets the page's npm answer, so the next About open asks again. Tests call it between cases. */
export function forgetLatestRelease(): void {
  latestVersion = undefined;
}

/** Asks npm for gavel's `latest` release once per page load, unless given a reason not to. */
export function useLatestRelease(offReason: string | undefined): LatestRelease {
  const [latest, setLatest] = useState<LatestRelease>({ state: 'checking' });
  useEffect(() => {
    if (offReason !== undefined) return;
    // Closing About only stops listening: aborting would hand the next open an aborted request.
    let listening = true;
    latestVersion ??= fetchLatestVersion();
    latestVersion.then(
      (version) => {
        if (listening) setLatest({ state: 'found', version });
      },
      () => {
        if (listening) setLatest({ state: 'failed' });
      },
    );
    return () => {
      listening = false;
    };
  }, [offReason]);
  return offReason === undefined ? latest : { state: 'off', reason: offReason };
}
