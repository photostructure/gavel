import type { ReactNode } from 'react';

import type { ReviewContext as ReviewContextData } from '../../types/diff';

// A fixed label column, not max-content, so every group's labels and values line up. 11em fits
// "Uncommitted changes", the longest label, on one line.
export function DetailGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <h3 className="mb-2 text-sm ui-heading">{title}</h3>
      <dl className="grid min-w-0 grid-cols-[11em_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs">
        {children}
      </dl>
    </div>
  );
}

export function Detail({
  label,
  mono = false,
  children,
}: {
  label: string;
  mono?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <dt className="text-right ui-label">{label}</dt>
      <dd className={`min-w-0 select-text break-all ui-value ${mono ? 'font-mono' : ''}`}>
        {children}
      </dd>
    </>
  );
}

export function ReviewContext({ context }: { context?: ReviewContextData }) {
  const name = context?.repositoryName || 'Imported diff';
  if (!context) return null;

  return (
    <section aria-label="Review context" className="flex min-w-0 flex-col gap-5">
      <DetailGroup title="This review">
        {context.agent && <Detail label="Agent">{context.agent}</Detail>}
        {context.agentSessionName && (
          <Detail label="Agent session name">{context.agentSessionName}</Detail>
        )}
        {context.agentSessionId && (
          <Detail label="Agent session ID" mono>
            {context.agentSessionId}
          </Detail>
        )}
        {context.source === 'stdin' && <Detail label="Review source">Imported diff</Detail>}
        {context.repositoryPath && (
          <>
            <Detail label="Repository">{name}</Detail>
            <Detail label="Worktree" mono>
              {context.repositoryPath}
            </Detail>
          </>
        )}
      </DetailGroup>
      <DetailGroup title="Server">
        <Detail label="Server host" mono>
          {context.hostname}
        </Detail>
        <Detail label="Launched from" mono>
          {context.workingDirectory}
        </Detail>
      </DetailGroup>
    </section>
  );
}
