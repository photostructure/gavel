import type { ReviewContext } from '../../types/diff';

import { resolveEventSourceUrl } from './eventSourceUrl';

// Which chat the prompt belongs in, as a Markdown list the agent can match field by field. Another
// session asks before it continues: the reviewer may have pasted it by mistake, or into a new or
// cleared chat on purpose. It names the repository, not its path, which would show the reviewer's
// home directory to the chat.
function sessionBlock(review: ReviewContext): string {
  const fields = [
    review.agent && `- **Agent:** ${review.agent}`,
    `- **Session ID:** ${review.agentSessionId ? `\`${review.agentSessionId}\`` : 'none'}`,
    review.agentSessionName && `- **Session name:** ${review.agentSessionName}`,
    `- **Host:** ${review.hostname}`,
    review.repositoryName && `- **Repository:** ${review.repositoryName}`,
  ].filter(Boolean);
  return review.agentSessionId
    ? `This review belongs to this agent session:\n\n${fields.join('\n')}\n\nIf you are not that session, say so and wait for me to confirm before you continue.`
    : `No agent session owns this review:\n\n${fields.join('\n')}`;
}

/**
 * The prompt the reviewer pastes into the agent's chat, shared by the robot menu, the presence
 * indicator, and the final-verdict handoff. `replaced`: another review's server now holds this
 * page's address, so the prompt asks the session to reopen its review instead of reading it.
 */
export function buildResumePrompt(
  review: ReviewContext | undefined,
  { replaced = false }: { replaced?: boolean } = {},
): string {
  const url = new URL(resolveEventSourceUrl('/api/conversation/snapshot'), window.location.href);
  const page = window.location.href.split('#')[0];
  const session = review ? `\n\n${sessionBlock(review)}` : '';
  if (replaced) {
    return `Another gavel review's server now runs at ${url.origin}, where my gavel review ${page} was, so do not read that server.${session}\n\nReopen this review with gavel and send me its new link. Follow the repository's gavel instructions and existing permissions.`;
  }
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  const snapshotRequest =
    url.protocol === 'https:'
      ? `Read \`${url.origin}${url.pathname}\` over HTTPS with an \`X-Gavel-Token\` header holding the contents of \`\${GAVEL_CONFIG_DIR:-$HOME/.gavel}/access-token\` on the machine running gavel; use that server URL and header for replies.`
      : `From the repository's Git root, run this with the prescribed gavel launcher:\n\n\`\`\`sh\ngavel comment snapshot --host ${url.hostname} --port ${port}\n\`\`\``;
  return `Please read my latest gavel comments and verdicts, then continue the work: ${page}${session}\n\n${snapshotRequest}\n\nAddress my feedback, reply in gavel, and follow each review's verdict. Include any unfinished feedback from earlier turns. Follow the repository's gavel instructions and existing permissions. When caught up, end your turn; do not poll for more feedback.`;
}
