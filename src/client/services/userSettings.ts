// UI settings live in one cookie per browser. Cookies ignore the port, so
// settings survive gavel starting on a different port, while each browser (a
// desktop and an iPad, say) keeps its own font size and theme.

const COOKIE_NAME = 'gavel-settings';
// The property of the gavel-settings cookie's JSON that holds the appearance settings.
export const APPEARANCE_SETTINGS_KEY = 'appearance';
// Chrome caps cookie lifetime at 400 days; every save renews it.
const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
// Browsers drop cookies over 4096 bytes including the name and attributes.
const MAX_COOKIE_VALUE_BYTES = 4000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readCookieValue(): string | undefined {
  return document.cookie
    .split('; ')
    .find((cookie) => cookie.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1);
}

export function readClientSettings(): Record<string, unknown> {
  const value = readCookieValue();
  if (value === undefined) {
    return {};
  }
  const parsed: unknown = JSON.parse(decodeURIComponent(value));
  if (!isPlainObject(parsed)) {
    throw new Error(`The ${COOKIE_NAME} cookie does not hold a settings object`);
  }
  return parsed;
}

// App shows these on the page. Saves are called from effects and event
// handlers, where a thrown error would blank the page or reach only the console.
const saveErrorListeners = new Set<(message: string) => void>();

export function onSettingsSaveError(listener: (message: string) => void): () => void {
  saveErrorListeners.add(listener);
  return () => {
    saveErrorListeners.delete(listener);
  };
}

function reportSaveError(message: string): void {
  for (const listener of saveErrorListeners) {
    listener(message);
  }
}

function writeClientSettings(settings: Record<string, unknown>): void {
  const value = encodeURIComponent(JSON.stringify(settings));
  if (value.length > MAX_COOKIE_VALUE_BYTES) {
    reportSaveError(
      `gavel settings need ${value.length} bytes, over the ${MAX_COOKIE_VALUE_BYTES}-byte cookie limit`,
    );
    return;
  }
  document.cookie = `${COOKIE_NAME}=${value}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
  // Browsers drop cookies without an error: Chromium does inside a cross-site
  // frame, and so does any browser with cookies blocked.
  if (readCookieValue() !== value) {
    reportSaveError(
      `The browser did not keep the ${COOKIE_NAME} cookie; settings changes are lost`,
    );
  }
}

export function saveClientSettings(patch: Record<string, unknown>): void {
  writeClientSettings({ ...readClientSettings(), ...patch });
}

export function resetClientSettingsForTests(): void {
  document.cookie = `${COOKIE_NAME}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}
