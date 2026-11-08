// Auto-viewed patterns live in the server's ~/.gavel/config.json, shared by
// every browser; /api/diff returns them with the files they apply to.

const SAVE_DELAY_MS = 300;

let saveTimer: ReturnType<typeof setTimeout> | null = null;

// Typing in the Settings textarea calls this per keystroke; only the last
// value within SAVE_DELAY_MS reaches the server.
export function saveAutoViewedPatterns(patterns: string[]): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void (async () => {
      const response = await fetch('/api/auto-viewed-patterns', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patterns }),
      });
      if (!response.ok) {
        throw new Error(`Saving auto-viewed patterns failed with HTTP ${response.status}`);
      }
    })();
  }, SAVE_DELAY_MS);
}
