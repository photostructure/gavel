import { useState } from 'react';

import type { CommentThread, DiffSide, LineNumber } from '../../types/diff';
import {
  draftKey,
  useCommentDraft,
  useDraftAnchors,
  type DraftAnchor,
  type LineDraftAnchor,
} from '../hooks/useCommentDrafts';

import type { CommentSubmitOptions } from './CommentForm';
import { describeLines, LineCommentComposer } from './LineCommentComposer';
import type { AppearanceSettings } from './SettingsModal';

interface UnsentDraftsProps {
  threads: CommentThread[];
  // Paths of the files in the current diff; a line draft on any other file has no
  // place on the page but here.
  diffFilePaths: ReadonlySet<string>;
  syntaxTheme?: AppearanceSettings['syntaxTheme'];
  onAddComment: (
    filePath: string,
    line: LineNumber,
    body: string,
    codeContent?: string,
    side?: DiffSide,
    options?: CommentSubmitOptions,
  ) => Promise<void>;
  onNavigateToLine: (anchor: LineDraftAnchor) => void;
  // The code the diff shows now under a draft's lines, or undefined when the diff
  // does not show all of them; the draft then sends the code it saved.
  codeFor: (anchor: LineDraftAnchor) => string | undefined;
  // messageId is the edited message for an edit draft.
  onNavigateToThread: (thread: CommentThread, messageId?: string) => void;
  onClosePanel: () => void;
}

// Every unsent draft of the review, at the top of the Conversation panel. Line
// drafts appear as their comment form (the same draft as the form in the diff, so
// typing in either updates both); reply and edit drafts appear as a row that jumps
// to their thread, whose own form already holds the text.
export function UnsentDrafts({
  threads,
  diffFilePaths,
  syntaxTheme,
  onAddComment,
  onNavigateToLine,
  codeFor,
  onNavigateToThread,
  onClosePanel,
}: UnsentDraftsProps) {
  // The list is the drafts that existed when the panel opened (it mounts on open),
  // minus any sent or discarded since. A draft started in the panel joins on the next
  // open, so typing a reply here does not insert rows above it and push it down. A
  // key leaves the list for good once its draft is gone, so a new draft with that key
  // (a second reply to the same thread) waits for the next open too.
  const live = useDraftAnchors();
  const liveKeys = new Set(live.map(draftKey));
  const [listedKeys, setListedKeys] = useState(liveKeys);
  if ([...listedKeys].some((key) => !liveKeys.has(key))) {
    setListedKeys(new Set([...listedKeys].filter((key) => liveKeys.has(key))));
  }
  const anchors = live.filter((anchor) => listedKeys.has(draftKey(anchor)));
  if (anchors.length === 0) return null;
  return (
    <section aria-label="Unsent drafts" className="mb-6 border-b border-github-border pb-5">
      <h3 className="mb-2 text-sm ui-heading">Unsent drafts</h3>
      <div className="space-y-3">
        {anchors.map((anchor) =>
          anchor.kind === 'line' ? (
            <LineDraftEntry
              key={draftKey(anchor)}
              anchor={anchor}
              inDiff={diffFilePaths.has(anchor.filePath)}
              selectedCode={diffFilePaths.has(anchor.filePath) ? codeFor(anchor) : undefined}
              syntaxTheme={syntaxTheme}
              onAddComment={onAddComment}
              onNavigateToLine={onNavigateToLine}
              onClosePanel={onClosePanel}
            />
          ) : (
            <ThreadDraftRow
              key={draftKey(anchor)}
              anchor={anchor}
              thread={threads.find((thread) => thread.id === anchor.threadId)}
              onNavigateToThread={onNavigateToThread}
            />
          ),
        )}
      </div>
    </section>
  );
}

function LineDraftEntry({
  anchor,
  inDiff,
  selectedCode,
  syntaxTheme,
  onAddComment,
  onNavigateToLine,
  onClosePanel,
}: {
  anchor: LineDraftAnchor;
  inDiff: boolean;
  selectedCode: string | undefined;
  syntaxTheme?: AppearanceSettings['syntaxTheme'];
  onAddComment: UnsentDraftsProps['onAddComment'];
  onNavigateToLine: UnsentDraftsProps['onNavigateToLine'];
  onClosePanel: () => void;
}) {
  return (
    <div>
      <LineCommentComposer
        anchor={anchor}
        selectedCode={selectedCode}
        syntaxTheme={syntaxTheme}
        title={`Comment on ${anchor.filePath} ${describeLines(anchor)}${
          inDiff ? '' : ', which is not in this diff'
        }`}
        autoFocus={false}
        onSubmit={(body, options, code) =>
          onAddComment(anchor.filePath, anchor.lineNumber, body, code, anchor.side, options)
        }
        onClose={() => {}}
        onEscape={onClosePanel}
      />
      {inDiff && (
        <div className="mx-3 flex justify-end">
          <button
            type="button"
            onClick={() => {
              onNavigateToLine(anchor);
              onClosePanel();
            }}
            className="text-xs text-github-text-secondary underline hover:text-github-text-primary"
          >
            Go to line
          </button>
        </div>
      )}
    </div>
  );
}

function ThreadDraftRow({
  anchor,
  thread,
  onNavigateToThread,
}: {
  anchor: Exclude<DraftAnchor, LineDraftAnchor>;
  thread: CommentThread | undefined;
  onNavigateToThread: UnsentDraftsProps['onNavigateToThread'];
}) {
  const { body, clear } = useCommentDraft(anchor);
  const action = anchor.kind === 'reply' ? 'Reply' : 'Edit';
  const messageGone =
    anchor.kind === 'edit' &&
    thread !== undefined &&
    (thread.deletedMessageIds?.includes(anchor.messageId) === true ||
      !thread.messages.some((message) => message.id === anchor.messageId));
  // A deleted thread's card stays collapsed and a deleted message has no editor, so
  // only a live thread has a form to jump to.
  const liveThread = thread && !thread.deleted && !messageGone ? thread : undefined;
  const label = !thread
    ? `${action} on a thread that is not loaded`
    : thread.deleted
      ? `${action} on a deleted thread`
      : messageGone
        ? 'Edit of a deleted message'
        : thread.scope === 'review'
          ? `${action} on the review conversation`
          : `${action} on ${thread.file}:${Array.isArray(thread.line) ? `${thread.line[0]}-${thread.line[1]}` : thread.line}`;
  // Discard is the only way to drop a draft whose thread or message is gone: no form
  // shows it anywhere else.
  return (
    <div className="flex items-start gap-2 rounded-md border border-yellow-600/50 border-l-4 border-l-yellow-400 bg-github-bg-tertiary px-3 py-2 text-sm">
      <button
        type="button"
        disabled={!liveThread}
        onClick={() =>
          liveThread &&
          onNavigateToThread(liveThread, anchor.kind === 'edit' ? anchor.messageId : undefined)
        }
        className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left hover:underline disabled:no-underline disabled:opacity-60"
      >
        <span className="ui-heading">{label}</span>
        <span className="w-full truncate text-github-text-secondary">{body}</span>
      </button>
      <button
        type="button"
        onClick={clear}
        className="shrink-0 rounded border border-github-border bg-github-bg-secondary px-2 py-1 text-xs text-github-text-primary hover:opacity-80"
      >
        Discard
      </button>
    </div>
  );
}
