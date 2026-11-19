import { Check, CircleAlert, Copy } from 'lucide-react';
import type { ReactNode } from 'react';

import type { ReviewContext as ReviewContextData } from '../../types/diff';
import { useCopy } from '../hooks/useCopy';

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

/** A detail row with a button that copies its value. */
function CopyableDetail({
  label,
  mono = false,
  value,
}: {
  label: string;
  mono?: boolean;
  value: string;
}) {
  const { status, copy } = useCopy();
  const action =
    status === 'copied'
      ? `${label} copied`
      : status === 'failed'
        ? 'Copy failed; select the text instead'
        : `Copy ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
  return (
    <Detail label={label} mono={mono}>
      {/* A flex row keeps the button beside a value that wraps, not alone on its last line. */}
      <span className="flex items-start gap-1.5">
        <span className="min-w-0">{value}</span>
        <button
          type="button"
          onClick={() => copy(value)}
          title={action}
          aria-label={action}
          className="inline-flex shrink-0 rounded p-0.5 text-github-text-secondary transition-colors hover:bg-github-bg-tertiary hover:text-github-text-primary"
        >
          {status === 'copied' ? (
            <Check size={12} aria-hidden="true" />
          ) : status === 'failed' ? (
            <CircleAlert size={12} aria-hidden="true" className="text-github-danger" />
          ) : (
            <Copy size={12} aria-hidden="true" />
          )}
        </button>
      </span>
    </Detail>
  );
}

export function ReviewContext({ context }: { context?: ReviewContextData }) {
  const name = context?.repositoryName || 'Imported diff';
  if (!context) return null;

  return (
    <section aria-label="Review context" className="flex min-w-0 flex-col gap-5">
      <DetailGroup title="This review">
        {context.agent && <CopyableDetail label="Agent" value={context.agent} />}
        {context.agentSessionName && (
          <CopyableDetail label="Agent session name" value={context.agentSessionName} />
        )}
        {context.agentSessionId && (
          <CopyableDetail label="Agent session ID" mono value={context.agentSessionId} />
        )}
        {context.source === 'stdin' && (
          <CopyableDetail label="Review source" value="Imported diff" />
        )}
        {context.repositoryPath && (
          <>
            <CopyableDetail label="Repository" value={name} />
            <CopyableDetail label="Worktree" mono value={context.repositoryPath} />
          </>
        )}
      </DetailGroup>
      <DetailGroup title="Server">
        <CopyableDetail label="Server host" mono value={context.hostname} />
        <CopyableDetail label="Launched from" mono value={context.workingDirectory} />
      </DetailGroup>
    </section>
  );
}
