import { resolveEventSourceUrl } from './eventSourceUrl';

/** Shared by the Conversation panel and the final-verdict handoff. */
export function buildResumePrompt(): string {
  const url = new URL(resolveEventSourceUrl('/api/conversation/snapshot'), window.location.href);
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  const snapshotRequest =
    url.protocol === 'https:'
      ? `Read ${url.origin}${url.pathname} over HTTPS; use that server URL for replies.`
      : `From the repository's Git root, run gavel comment snapshot --host ${url.hostname} --port ${port} using the prescribed gavel launcher.`;
  return `Please read my latest gavel comments and verdicts, then continue the work: ${window.location.href.split('#')[0]}\n\n${snapshotRequest}\n\nAddress my feedback, reply in gavel, and follow each review's verdict. Include any unfinished feedback from earlier turns. Follow the repository's gavel instructions and existing permissions. When caught up, end your turn; do not poll for more feedback.`;
}
