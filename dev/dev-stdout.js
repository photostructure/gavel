const CLI_SERVER_URL_PATTERN = /^🚀 gavel server started on (https?:\/\/\S+)$/;

/**
 * @param {{
 *   onServerUrl: (serverUrl: string) => void;
 *   onOutput: (output: string) => void;
 * }} options
 */
export function createCliStdoutProxy({ onServerUrl, onOutput }) {
  let buffer = '';
  let detectedServerUrl = false;

  /** @param {string} rawLine */
  function detectServerUrl(rawLine) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    /** @type {string | undefined} */
    let readyUrl;
    if (line.startsWith('{')) {
      try {
        const event = /** @type {unknown} */ (JSON.parse(line));
        if (
          event &&
          typeof event === 'object' &&
          'type' in event &&
          event.type === 'server.ready' &&
          'url' in event &&
          typeof event.url === 'string'
        )
          readyUrl =
            'launchUrl' in event && typeof event.launchUrl === 'string'
              ? event.launchUrl
              : event.url;
      } catch {
        // Legacy human output is still supported with --no-jsonl.
      }
    }
    const serverUrlMatch = line.match(CLI_SERVER_URL_PATTERN);
    const serverUrl = readyUrl ?? serverUrlMatch?.[1];
    if (serverUrl) {
      detectedServerUrl = true;
      onServerUrl(serverUrl);
    }
  }

  return {
    /** @param {string} chunk */
    push(chunk) {
      // Preserve every byte, including diagnostics, blank lines and line endings.
      onOutput(chunk);
      if (detectedServerUrl) return;
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        detectServerUrl(line);
        if (detectedServerUrl) {
          buffer = '';
          break;
        }
      }
    },
    flush() {
      if (!detectedServerUrl && buffer.length > 0) detectServerUrl(buffer);
      buffer = '';
    },
  };
}
