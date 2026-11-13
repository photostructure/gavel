import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Edit2,
  LoaderCircle,
  Mail,
  MailOpen,
  MessageSquare,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import React, { useContext, useEffect, useId, useRef, useState } from 'react';

import {
  type CommentIntent,
  type CommentThread,
  type DiffCommentMessage,
  type DiffSelection,
} from '../../types/diff';
import { copyTextToClipboard } from '../utils/clipboard';
import { useFocusedAgentMessage } from '../hooks/useFocusedAgentMessage';
import { agentMessageRevision } from '../hooks/useAgentUpdates';
import { AgentUpdatesContext, type AgentUpdatesReadState } from '../contexts/AgentUpdatesContext';
import { useCommentDraft, useThreadHadDraftOnMount } from '../hooks/useCommentDrafts';
import { hasActiveTextSelection, isDisclosureRowClick } from '../utils/domUtils';

import { ActionMenu, iconButtonClasses, type ActionMenuItem } from './ActionMenu';
import { CommentBodyRenderer } from './CommentBodyRenderer';
import { CommentForm, type CommentSubmitOptions } from './CommentForm';
import type { AppearanceSettings } from './SettingsModal';

// A reply or edit form is 'restored' when it shows a saved draft nobody opened here:
// this card mounted with one (after a reload or a review switch) or another tab
// started one. A restored form does not take focus, and closes when its draft goes
// away. Apart from those, only a click in this copy opens a form, so when the same
// thread shows in the Conversation panel and the diff, a draft typed in one copy does
// not open the other.
type DraftFormState = 'closed' | 'restored' | 'opened';

function useDraftForm(draft: Pick<ReturnType<typeof useCommentDraft>, 'draft' | 'fromStorage'>) {
  const [form, setForm] = useState<DraftFormState>(draft.draft ? 'restored' : 'closed');
  if (form === 'closed' && draft.fromStorage) setForm('restored');
  if (form === 'restored' && draft.draft === undefined) setForm('closed');
  return [form, setForm] as const;
}

interface ThreadMessageItemProps {
  threadId: string;
  readOnly: boolean;
  linkReview?: DiffSelection;
  highlighted?: boolean;
  focusRequest?: number;
  message: DiffCommentMessage;
  isRootMessage?: boolean;
  showAuthorBadge: boolean;
  syntaxTheme?: AppearanceSettings['syntaxTheme'];
  filename?: string;
  originalCode?: string;
  onUpdate: (newBody: string, intent: CommentIntent) => void;
  onDeleteReply?: () => void;
  // The root comment's actions live in the thread heading; a new number opens its editor.
  editRequest?: number;
  onClick?: (e: React.MouseEvent) => void;
  onEscapeKeepingDraft?: () => void;
}

// The read state that a dot button and its menu item both show and flip, for one reply or for
// every agent message in a thread: unread while any of the messages is, and a flip marks them
// all read, or all unread when none is.
interface ReadMark {
  label: string;
  unread: boolean;
  toggle: () => void;
}

function readMark(
  readState: AgentUpdatesReadState,
  threadId: string,
  subject: 'reply' | 'thread',
  messages: readonly DiffCommentMessage[],
): ReadMark {
  const unread = messages.some((message) =>
    readState.unreadKeys.has(JSON.stringify([threadId, message.id])),
  );
  return {
    label: `Mark ${subject} as ${unread ? 'read' : 'unread'}`,
    unread,
    toggle: () => {
      for (const message of messages) {
        readState.setRead(threadId, message.id, agentMessageRevision(message), unread);
      }
    },
  };
}

// Touch screens show no tooltips, so each menu also names the actions its heading or reply row
// shows as icons.
function readMenuItem({ label, unread, toggle }: ReadMark): ActionMenuItem {
  const Icon = unread ? MailOpen : Mail;
  return { label, icon: <Icon aria-hidden="true" size={12} />, onSelect: toggle };
}

function ReadToggle({
  mark: { label, unread, toggle },
  enabled,
}: {
  mark: ReadMark;
  enabled: boolean;
}) {
  return (
    <button
      type="button"
      disabled={!enabled}
      title={label}
      aria-label={label}
      className={`${iconButtonClasses} disabled:cursor-not-allowed disabled:opacity-50`}
      onClick={(event) => {
        event.stopPropagation();
        toggle();
      }}
    >
      {/* A filled dot means unread, a hollow ring read; 8px plus margin fills the 12px icon box. */}
      <span
        aria-hidden="true"
        className={`m-0.5 block h-2 w-2 rounded-full ${unread ? 'bg-blue-500' : 'border border-blue-500'}`}
      />
    </button>
  );
}

function ThreadMessageItem({
  threadId,
  readOnly,
  linkReview,
  highlighted = false,
  focusRequest,
  message,
  isRootMessage = false,
  showAuthorBadge,
  syntaxTheme,
  filename,
  originalCode,
  onUpdate,
  onDeleteReply,
  editRequest,
  onClick,
  onEscapeKeepingDraft,
}: ThreadMessageItemProps) {
  const messageElement = useFocusedAgentMessage(message.id, highlighted, focusRequest);
  const readState = useContext(AgentUpdatesContext);
  // Another review's replies keep their read state until the reader uses its read controls.
  const canMarkRead = !readOnly && message.origin === 'agent' && readState?.enabled === true;
  const showAuthorHeader = showAuthorBadge && Boolean(message.author);
  const progress = message.origin !== 'agent' ? message.progress : undefined;
  const isUserAuthoredMessage = message.author?.trim() === 'User';
  const intent = message.intent ?? 'comment';
  const editDraft = useCommentDraft(
    { kind: 'edit', threadId, messageId: message.id },
    { body: message.body, intent },
  );
  const [editForm, setEditForm] = useDraftForm(editDraft);
  const [openedEditRequest, setOpenedEditRequest] = useState(editRequest);
  if (editRequest !== openedEditRequest) {
    setOpenedEditRequest(editRequest);
    setEditForm('opened');
  }
  const isEditing = editForm !== 'closed';
  const [isCopied, setIsCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const handleCopy = async () => {
    try {
      await copyTextToClipboard(message.body);
      setIsCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy message:', error);
    }
  };

  const replyRead =
    !isRootMessage && message.origin === 'agent' && readState
      ? readMark(readState, threadId, 'reply', [message])
      : undefined;
  const replyActions: ActionMenuItem[] =
    readOnly || isRootMessage
      ? []
      : [
          ...(replyRead && readState?.enabled ? [readMenuItem(replyRead)] : []),
          {
            label: 'Copy reply',
            icon: <Copy aria-hidden="true" size={12} />,
            onSelect: handleCopy,
          },
          ...(isUserAuthoredMessage
            ? [
                {
                  label: 'Edit reply',
                  icon: <Edit2 aria-hidden="true" size={12} />,
                  onSelect: () => setEditForm('opened'),
                },
              ]
            : []),
          ...(isUserAuthoredMessage && onDeleteReply
            ? [
                {
                  label: 'Delete reply',
                  icon: <Trash2 aria-hidden="true" size={12} />,
                  onSelect: onDeleteReply,
                  danger: true,
                },
              ]
            : []),
        ];

  // Cancel passes ''; Escape passes the text. Escape never discards unsaved changes: in
  // the panel it closes the panel and keeps them (see
  // CommentThreadCardProps.onEscapeKeepingDraft); in the diff it leaves the editor open
  // while the text or intent differs from the message, and closes it otherwise.
  const handleCancelEdit = (text: string) => {
    if (text.trim()) {
      if (onEscapeKeepingDraft) {
        onEscapeKeepingDraft();
        return;
      }
      if (text !== message.body || editDraft.intent !== intent) return;
    }
    editDraft.clear();
    setEditForm('closed');
  };

  const handleSaveEdit = (nextBody: string, options: CommentSubmitOptions) => {
    const nextIntent = options.intent ?? 'comment';
    if (nextBody !== message.body || nextIntent !== intent) {
      onUpdate(nextBody, nextIntent);
    }
    editDraft.clear();
    setEditForm('closed');
    return Promise.resolve();
  };

  return (
    <div
      ref={messageElement}
      tabIndex={-1}
      data-comment-message-id={message.id}
      className={`flow-root ${highlighted ? 'rounded ring-2 ring-blue-500 ring-offset-2 ring-offset-github-bg-tertiary' : ''}`}
      // Following a link means the reader read the message. A gavel link's handler stops the
      // click before onClick below, and onClick skips other links, so the read mark goes here.
      onClickCapture={(event) => {
        if (canMarkRead && event.target instanceof Element && event.target.closest('a[href]'))
          readState.setRead(threadId, message.id, agentMessageRevision(message), true);
      }}
      onClick={(event) => {
        const target = event.target;
        if (
          canMarkRead &&
          !isEditing &&
          !hasActiveTextSelection() &&
          target instanceof Element &&
          !target.closest('button, a, input, textarea, select, [contenteditable="true"]')
        ) {
          readState.setRead(threadId, message.id, agentMessageRevision(message), true);
        }
        onClick?.(event);
      }}
    >
      {!isEditing ? (
        <>
          {/* A reply's controls float, so its text wraps beneath them instead of leaving a
              full-height column; the root comment's controls are in the thread heading. */}
          {(replyRead || replyActions.length > 0) && (
            <div className="float-right ml-3 flex items-center gap-2">
              {replyRead && readState && (
                <ReadToggle mark={replyRead} enabled={readState.enabled} />
              )}
              {replyActions.length > 0 && (
                <ActionMenu
                  label="Reply actions"
                  items={replyActions}
                  confirmation={isCopied ? 'Copied!' : undefined}
                />
              )}
            </div>
          )}
          <div>
            {showAuthorHeader && (
              <div className="mb-2 flex min-w-0 items-center gap-2 pr-2 text-xs text-github-text-secondary">
                <span className="inline-flex items-center rounded-full border border-github-border bg-github-bg-primary px-2 py-0.5 text-[11px] font-medium text-github-text-primary">
                  {message.author}
                </span>
              </div>
            )}

            {(message.intent || isUserAuthoredMessage) && (
              <span className="mb-2 inline-block rounded border border-github-border px-1.5 py-0.5 text-xs text-github-text-secondary">
                {intent === 'question'
                  ? 'Question'
                  : intent === 'change'
                    ? 'Change request'
                    : 'Comment'}
              </span>
            )}
            {progress && (
              <div
                role="status"
                className="mb-2 flex items-center gap-1.5 text-xs text-github-text-secondary"
                title={`Agent progress last updated ${new Date(progress.updatedAt).toLocaleString()}`}
              >
                {(progress.status === 'thinking' || progress.status === 'replying') && (
                  <LoaderCircle
                    aria-hidden="true"
                    size={12}
                    className="animate-spin motion-reduce:animate-none"
                  />
                )}
                {(progress.status === 'replied' || progress.status === 'noted') && (
                  <Check aria-hidden="true" size={12} />
                )}
                <span>{progress.status.charAt(0).toUpperCase() + progress.status.slice(1)}</span>
              </div>
            )}
            <CommentBodyRenderer
              body={message.body}
              linkSource={{ threadId, review: linkReview }}
              originalCode={originalCode}
              filename={filename}
              syntaxTheme={syntaxTheme}
            />
          </div>
        </>
      ) : (
        <CommentForm
          onSubmit={handleSaveEdit}
          onCancel={handleCancelEdit}
          selectedCode={originalCode}
          syntaxTheme={syntaxTheme}
          filename={filename}
          value={editDraft.body}
          onChange={editDraft.setBody}
          intentValue={editDraft.intent}
          onIntentChange={editDraft.setIntent}
          embedded={true}
          title="Edit comment"
          submitLabel="Save"
          placeholder="Edit your message..."
          autoFocus={editForm === 'opened'}
          draftKey={editDraft.key}
        />
      )}
    </div>
  );
}

interface CommentThreadCardProps {
  focusedMessageId?: string;
  focusRequest?: number;
  unreadCount?: number;
  onReadUnread?: () => void;
  // A thread from another review: read/unread controls and a click-through only.
  readOnly?: boolean;
  // That other review, which relative links in the thread's comments point into.
  linkReview?: DiffSelection;
  thread: CommentThread;
  showAuthorBadges?: boolean;
  onGeneratePrompt: (thread: CommentThread) => string;
  onToggleThreadResolved: (threadId: string) => void;
  onRemoveThread?: (threadId: string) => void;
  onRestoreComment?: (threadId: string, messageId?: string) => void;
  onReplyToThread: (threadId: string, body: string, intent?: CommentIntent) => Promise<void>;
  onRemoveMessage: (threadId: string, messageId: string) => void;
  onUpdateMessage: (
    threadId: string,
    messageId: string,
    newBody: string,
    intent?: CommentIntent,
  ) => void;

  onClick?: (e: React.MouseEvent) => void;
  syntaxTheme?: AppearanceSettings['syntaxTheme'];
  // Escape in a reply or edit form with unsaved text keeps the form and its draft; when
  // given (the Conversation panel passes its close handler), this is called too and
  // closes the panel.
  onEscapeKeepingDraft?: () => void;
}

export function CommentThreadCard({
  focusedMessageId,
  focusRequest,
  unreadCount = 0,
  onReadUnread,
  readOnly = false,
  linkReview,
  thread,
  showAuthorBadges = false,
  onGeneratePrompt,
  onToggleThreadResolved,
  onRemoveThread,
  onRestoreComment,
  onReplyToThread,
  onRemoveMessage,
  onUpdateMessage,

  onClick,
  syntaxTheme,
  onEscapeKeepingDraft,
}: CommentThreadCardProps) {
  const [isCopied, setIsCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  const contentId = useId();
  // A resolved thread that held an unsent reply or edit when it mounted opens, so
  // the restored draft shows.
  const restoredDraft = useThreadHadDraftOnMount(thread.id);
  const [isCollapsed, setIsCollapsed] = useState(
    Boolean(thread.deleted || (thread.resolution?.resolved && !focusedMessageId && !restoredDraft)),
  );
  useEffect(() => {
    setIsCollapsed(Boolean(thread.deleted || thread.resolution?.resolved));
  }, [thread.deleted, thread.resolution?.resolved]);
  useEffect(() => {
    if (focusedMessageId && !thread.deleted) setIsCollapsed(false);
  }, [focusedMessageId, focusRequest, thread.deleted]);
  useEffect(() => {
    if (restoredDraft && !thread.deleted) setIsCollapsed(false);
  }, [restoredDraft, thread.deleted]);
  const readState = useContext(AgentUpdatesContext);
  const agentMessages = thread.messages.filter(
    (message) => message.origin === 'agent' && !thread.deletedMessageIds?.includes(message.id),
  );
  const threadRead =
    readState && agentMessages.length > 0
      ? readMark(readState, thread.id, 'thread', agentMessages)
      : undefined;
  // Answering a thread means its agent replies have been read.
  const markAgentRepliesRead = () => {
    if (!readState?.enabled) return;
    for (const message of agentMessages) {
      readState.setRead(thread.id, message.id, agentMessageRevision(message), true);
    }
  };
  const replyDraft = useCommentDraft({ kind: 'reply', threadId: thread.id });
  const [replyForm, setReplyForm] = useDraftForm(replyDraft);
  const isReplying = replyForm !== 'closed';
  const replyArea = useRef<HTMLDivElement>(null);
  const replyTrigger = useRef<HTMLButtonElement>(null);
  const returnFocusToReplyTrigger = useRef(false);
  useEffect(() => {
    if (isReplying || !returnFocusToReplyTrigger.current) return;
    returnFocusToReplyTrigger.current = false;
    replyTrigger.current?.focus();
  }, [isReplying]);
  const lineLabel = Array.isArray(thread.line)
    ? `${thread.line[0]}-${thread.line[1]}`
    : thread.line;

  const toggleCollapsed = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsCollapsed((prev) => !prev);
  };

  const [rootEditRequest, setRootEditRequest] = useState(0);

  const handleCopyThread = async () => {
    try {
      const prompt = onGeneratePrompt(thread);
      await copyTextToClipboard(prompt);
      setIsCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy thread prompt:', error);
    }
  };

  const rootMessage = thread.messages[0];
  if (!rootMessage) return null;

  const toggleLabel = isCollapsed ? 'Expand thread' : 'Collapse thread';
  const threadActions: ActionMenuItem[] = [
    thread.resolution?.resolved
      ? {
          label: 'Reopen thread',
          icon: <RotateCcw aria-hidden="true" size={12} />,
          onSelect: () => onToggleThreadResolved(thread.id),
        }
      : {
          label: 'Resolve thread',
          icon: <Check aria-hidden="true" size={12} />,
          onSelect: () => onToggleThreadResolved(thread.id),
        },
    ...(threadRead && readState?.enabled ? [readMenuItem(threadRead)] : []),
    {
      label: 'Copy prompt',
      icon: <Copy aria-hidden="true" size={12} />,
      onSelect: handleCopyThread,
    },
    {
      label: 'Edit comment',
      icon: <Edit2 aria-hidden="true" size={12} />,
      onSelect: () => setRootEditRequest((request) => request + 1),
    },
    ...(onRemoveThread
      ? [
          {
            label: 'Delete thread',
            icon: <Trash2 aria-hidden="true" size={12} />,
            onSelect: () => onRemoveThread(thread.id),
            danger: true,
          },
        ]
      : []),
  ];

  return (
    <div
      id={`comment-thread-${thread.id}`}
      data-comment-thread-id={thread.id}
      data-comment-deleted={thread.deleted || undefined}
      tabIndex={-1}
      onFocus={(event) => {
        if (event.target === event.currentTarget && !thread.deleted) setIsCollapsed(false);
      }}
      className={`rounded-md border border-yellow-600/50 border-l-4 border-l-yellow-400 bg-github-bg-tertiary p-3 font-sans shadow-sm transition-all ${
        onClick ? 'cursor-pointer hover:shadow-md' : ''
      }`}
      onClick={onClick}
    >
      {/* tabIndex keeps a click here from focusing the card, whose focus handler would expand it. */}
      <div
        tabIndex={-1}
        onClick={(event) => {
          // A deleted thread's heading is inert; the card's click would navigate away from the list.
          if (thread.deleted) event.stopPropagation();
          else if (isDisclosureRowClick(event.target)) toggleCollapsed(event);
        }}
        className={`flex items-center justify-between gap-3 ${isCollapsed ? '' : 'mb-3'} ${
          thread.deleted ? '' : 'cursor-pointer'
        }`}
      >
        {/* Holds the tooltip instead of the row, so Reopen and Undelete do not inherit it. */}
        <div
          title={thread.deleted ? undefined : toggleLabel}
          className="flex min-w-0 flex-1 items-center gap-2 p-0.5 text-xs text-github-text-secondary"
        >
          <button
            type="button"
            onClick={toggleCollapsed}
            disabled={thread.deleted}
            aria-expanded={!isCollapsed}
            aria-controls={contentId}
            aria-label={toggleLabel}
            className="shrink-0 text-github-text-muted disabled:cursor-default!"
          >
            {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
          <span
            className="font-mono px-1 py-0.5 rounded overflow-hidden text-ellipsis whitespace-nowrap"
            style={{
              backgroundColor: 'var(--color-yellow-path-bg)',
              color: 'var(--color-yellow-path-text)',
            }}
          >
            {thread.scope === 'review' ? 'Review conversation' : `${thread.file}:${lineLabel}`}
          </span>
          {thread.deleted ? (
            <span>Deleted</span>
          ) : (
            thread.resolution?.resolved && <span className="text-github-text-muted">Resolved</span>
          )}
          {thread.isOutdated && (
            <span
              className="inline-flex h-5 shrink-0 items-center rounded-full border border-github-text-muted px-2 text-[10px] font-medium text-github-text-muted"
              title="Code has changed since this comment was made"
              aria-label="Outdated comment"
            >
              Outdated
            </span>
          )}
          {isCollapsed && (
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-github-text-secondary">
                {rootMessage.body.split('\n')[0]}
              </span>
              <span
                className="inline-flex shrink-0 items-center gap-1 text-github-text-muted"
                aria-label={`${thread.messages.length} messages in thread`}
              >
                <MessageSquare size={12} />
                {thread.messages.length}
              </span>
            </span>
          )}
        </div>
        {(thread.deleted || thread.resolution?.resolved || !isCollapsed || unreadCount > 0) && (
          <div className="flex shrink-0 items-center gap-2">
            {/* An expanded thread shows each reply's own read control. */}
            {isCollapsed && unreadCount > 0 && onReadUnread && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onReadUnread();
                }}
                className="inline-flex items-center justify-center rounded p-1.5 hover:bg-github-bg-primary"
                aria-label={`Jump to ${unreadCount} unread agent message${unreadCount === 1 ? '' : 's'} in ${thread.scope === 'review' ? 'review conversation' : `${thread.file}:${lineLabel}`}`}
                title="Jump to the first unread reply"
              >
                <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-blue-500" />
              </button>
            )}
            {!isCollapsed && threadRead && readState && (
              <ReadToggle mark={threadRead} enabled={readState.enabled} />
            )}
            {thread.deleted ? (
              <button
                type="button"
                className="rounded border border-github-border bg-github-bg-primary px-2 py-1 text-xs text-github-text-primary hover:bg-github-bg-secondary"
                onClick={(event) => {
                  event.stopPropagation();
                  onRestoreComment?.(thread.id);
                }}
              >
                Undelete
              </button>
            ) : (
              !readOnly &&
              thread.resolution?.resolved && (
                <button
                  type="button"
                  className="text-xs text-github-accent-text"
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleThreadResolved(thread.id);
                  }}
                >
                  Reopen
                </button>
              )
            )}
            {!readOnly && !isCollapsed && !thread.resolution?.resolved && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleThreadResolved(thread.id);
                }}
                className={`${iconButtonClasses} text-github-accent-text!`}
                title="Resolve thread"
                aria-label="Resolve thread"
              >
                <Check aria-hidden="true" size={12} />
              </button>
            )}
            {!readOnly && !isCollapsed && (
              <ActionMenu
                label="Thread actions"
                items={threadActions}
                confirmation={isCopied ? 'Copied!' : undefined}
              />
            )}
          </div>
        )}
      </div>

      <div id={contentId} hidden={isCollapsed} className="space-y-3">
        {!isCollapsed && (
          <>
            <ThreadMessageItem
              threadId={thread.id}
              readOnly={readOnly}
              linkReview={linkReview}
              onEscapeKeepingDraft={onEscapeKeepingDraft}
              highlighted={focusedMessageId === rootMessage.id}
              focusRequest={focusedMessageId === rootMessage.id ? focusRequest : undefined}
              message={{
                ...rootMessage,
                intent: rootMessage.intent ?? (thread.isQuestion ? 'question' : undefined),
              }}
              isRootMessage={true}
              showAuthorBadge={showAuthorBadges}
              syntaxTheme={syntaxTheme}
              filename={thread.file}
              originalCode={thread.codeContent}
              onUpdate={(newBody, intent) =>
                onUpdateMessage(thread.id, rootMessage.id, newBody, intent)
              }
              editRequest={rootEditRequest}
            />

            {thread.messages.slice(1).map((message) => (
              <div key={message.id} className="ml-4 border-l border-github-border pl-3">
                {thread.deletedMessageIds?.includes(message.id) ? (
                  <div
                    className="flex items-center justify-between gap-3 text-xs text-github-text-secondary"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <span>Reply deleted</span>
                    <button
                      type="button"
                      className="rounded border border-github-border bg-github-bg-primary px-2 py-1 text-github-text-primary hover:bg-github-bg-secondary"
                      onClick={() => onRestoreComment?.(thread.id, message.id)}
                    >
                      Undelete
                    </button>
                  </div>
                ) : (
                  <ThreadMessageItem
                    threadId={thread.id}
                    readOnly={readOnly}
                    linkReview={linkReview}
                    onEscapeKeepingDraft={onEscapeKeepingDraft}
                    highlighted={focusedMessageId === message.id}
                    focusRequest={focusedMessageId === message.id ? focusRequest : undefined}
                    message={message}
                    showAuthorBadge={showAuthorBadges}
                    syntaxTheme={syntaxTheme}
                    filename={thread.file}
                    originalCode={thread.codeContent}
                    onUpdate={(newBody, intent) =>
                      onUpdateMessage(thread.id, message.id, newBody, intent)
                    }
                    onDeleteReply={() => onRemoveMessage(thread.id, message.id)}
                  />
                )}
              </div>
            ))}

            {!readOnly && (
              <div
                ref={replyArea}
                className="ml-4 border-l border-github-border pl-3"
                onClick={(e) => e.stopPropagation()}
              >
                {isReplying ? (
                  <CommentForm
                    value={replyDraft.body}
                    onChange={replyDraft.setBody}
                    intentValue={replyDraft.intent}
                    onIntentChange={replyDraft.setIntent}
                    onSubmit={async (body, options) => {
                      await onReplyToThread(thread.id, body, options.intent);
                      markAgentRepliesRead();
                      replyDraft.clear();
                      setReplyForm('closed');
                    }}
                    onCancel={(draft) => {
                      if (draft.trim()) {
                        onEscapeKeepingDraft?.();
                        return;
                      }
                      // Escape returns focus to the reply field; an outside click keeps its target.
                      returnFocusToReplyTrigger.current =
                        replyArea.current?.contains(document.activeElement) ?? false;
                      replyDraft.clear();
                      setReplyForm('closed');
                    }}
                    selectedCode={thread.codeContent}
                    syntaxTheme={syntaxTheme}
                    filename={thread.file}
                    embedded={true}
                    title="Reply to thread"
                    submitLabel="Send"
                    placeholder="Write a reply..."
                    autoFocus={replyForm === 'opened'}
                    draftKey={replyDraft.key}
                  />
                ) : (
                  <button
                    ref={replyTrigger}
                    type="button"
                    onClick={() => setReplyForm('opened')}
                    className="w-full cursor-text rounded border border-github-border bg-github-bg-secondary px-3 py-1.5 text-left text-sm text-github-text-muted transition-colors hover:border-github-text-secondary"
                  >
                    Write a reply...
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
