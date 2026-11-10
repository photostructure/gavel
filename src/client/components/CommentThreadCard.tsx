import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Edit2,
  LoaderCircle,
  MessageSquare,
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
import { AgentUpdatesContext } from '../contexts/AgentUpdatesContext';
import { useCommentDraft, useThreadHadDraftOnMount } from '../hooks/useCommentDrafts';
import { hasActiveTextSelection, isDisclosureRowClick } from '../utils/domUtils';

import { CommentBodyRenderer } from './CommentBodyRenderer';
import { CommentForm, type CommentSubmitOptions } from './CommentForm';
import type { AppearanceSettings } from './SettingsModal';

// One-click answers to an agent reply. They are ordinary replies, so agents
// receive, acknowledge, and answer them like typed ones.
const QUICK_REPLIES: readonly { label: string; body: string; intent: CommentIntent }[] = [
  { label: '👍 Agreed', body: '👍 Agreed: no reply needed.', intent: 'comment' },
  {
    label: '❓ Still unclear',
    body: '❓ Still unclear: please explain again in different words.',
    intent: 'question',
  },
  {
    label: '👎 Disagree',
    body: '👎 Disagree: please reconsider, or defend the point.',
    intent: 'question',
  },
];

// A reply or edit form is 'restored' when this card mounted with a saved draft for it
// (after a reload or a review switch); a restored form does not take focus. Only a
// click in this copy opens a form, so when the same thread shows in the Conversation
// panel and the diff, a draft typed in one copy does not open the other.
type DraftFormState = 'closed' | 'restored' | 'opened';

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
  onResolveOrDelete: () => void;
  actionLabel: string;
  onDelete?: () => void;
  onClick?: (e: React.MouseEvent) => void;
  onEscapeKeepingDraft?: () => void;
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
  onResolveOrDelete,
  actionLabel,
  onDelete,
  onClick,
  onEscapeKeepingDraft,
}: ThreadMessageItemProps) {
  const messageElement = useFocusedAgentMessage(message.id, highlighted, focusRequest);
  const readState = useContext(AgentUpdatesContext);
  const unread = readState?.unreadKeys.has(JSON.stringify([threadId, message.id])) ?? false;
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
  const [editForm, setEditForm] = useState<DraftFormState>(editDraft.draft ? 'restored' : 'closed');
  const isEditing = editForm !== 'closed';
  const [isCopied, setIsCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditForm('opened');
  };

  const handleCopy = async (event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      await copyTextToClipboard(message.body);
      setIsCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy message:', error);
    }
  };

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
      className={`${isEditing ? '' : 'flex min-w-0 items-start gap-3'} ${highlighted ? 'rounded ring-2 ring-blue-500 ring-offset-2 ring-offset-github-bg-tertiary' : ''}`}
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
          <div className="min-w-0 flex-1">
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
          <div className="flex shrink-0 items-start gap-2 pt-0.5">
            {message.origin === 'agent' && readState && (
              <button
                type="button"
                disabled={!readState.enabled}
                title={unread ? 'Mark reply as read' : 'Mark reply as unread'}
                aria-label={unread ? 'Mark reply as read' : 'Mark reply as unread'}
                className="rounded border border-github-border bg-github-bg-tertiary p-1.5 transition-all hover:bg-github-bg-primary disabled:cursor-not-allowed disabled:opacity-50"
                onClick={(event) => {
                  event.stopPropagation();
                  readState.setRead(threadId, message.id, agentMessageRevision(message), unread);
                }}
              >
                {/* A filled dot means unread, a hollow ring read; 8px plus margin fills the 12px icon box. */}
                <span
                  aria-hidden="true"
                  className={`m-0.5 block h-2 w-2 rounded-full ${unread ? 'bg-blue-500' : 'border border-blue-500'}`}
                />
              </button>
            )}
            {!readOnly && !isRootMessage && (
              <button
                type="button"
                onClick={handleCopy}
                className="rounded border border-github-border bg-github-bg-tertiary p-1.5 text-github-text-primary transition-all hover:bg-github-bg-primary"
                title={isCopied ? 'Copied!' : 'Copy message'}
                aria-label={isCopied ? 'Copied!' : 'Copy message'}
              >
                {isCopied ? <Check size={12} /> : <Copy size={12} />}
              </button>
            )}
            {!readOnly && (isUserAuthoredMessage || isRootMessage) && (
              <button
                type="button"
                onClick={handleStartEdit}
                className="rounded border border-github-border bg-github-bg-tertiary p-1.5 text-github-text-primary transition-all hover:bg-github-bg-primary"
                title="Edit message"
              >
                <Edit2 size={12} />
              </button>
            )}
            {!readOnly && (isRootMessage || isUserAuthoredMessage) && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onResolveOrDelete();
                }}
                className={`rounded border border-github-border bg-github-bg-tertiary p-1.5 transition-all hover:bg-github-bg-primary ${
                  isRootMessage ? 'text-github-accent-text' : 'text-github-danger'
                }`}
                title={actionLabel}
                aria-label={actionLabel}
              >
                {isRootMessage ? <Check size={12} /> : <Trash2 size={12} />}
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                className="rounded border border-github-border bg-github-bg-tertiary p-1.5 text-github-danger transition-all hover:bg-github-bg-primary"
                title="Delete thread"
                aria-label="Delete thread"
              >
                <Trash2 size={12} />
              </button>
            )}
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
  // Answering a thread means its agent replies have been read.
  const markAgentRepliesRead = () => {
    if (!readState?.enabled) return;
    for (const message of thread.messages) {
      if (message.origin === 'agent' && !thread.deletedMessageIds?.includes(message.id)) {
        readState.setRead(thread.id, message.id, agentMessageRevision(message), true);
      }
    }
  };
  const replyDraft = useCommentDraft({ kind: 'reply', threadId: thread.id });
  const [replyForm, setReplyForm] = useState<DraftFormState>(
    replyDraft.draft ? 'restored' : 'closed',
  );
  const isReplying = replyForm !== 'closed';
  const replyArea = useRef<HTMLDivElement>(null);
  const replyTrigger = useRef<HTMLButtonElement>(null);
  const returnFocusToReplyTrigger = useRef(false);
  useEffect(() => {
    if (isReplying || !returnFocusToReplyTrigger.current) return;
    returnFocusToReplyTrigger.current = false;
    replyTrigger.current?.focus();
  }, [isReplying]);
  const agentRepliedLast =
    thread.messages.filter((message) => !thread.deletedMessageIds?.includes(message.id)).at(-1)
      ?.origin === 'agent';
  const lineLabel = Array.isArray(thread.line)
    ? `${thread.line[0]}-${thread.line[1]}`
    : thread.line;

  const toggleCollapsed = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsCollapsed((prev) => !prev);
  };

  const handleCopyThread = async (e: React.MouseEvent) => {
    e.stopPropagation();
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

  return (
    <div
      id={`comment-thread-${thread.id}`}
      data-comment-thread-id={thread.id}
      data-comment-deleted={thread.deleted || undefined}
      tabIndex={-1}
      onFocus={(event) => {
        if (event.target === event.currentTarget && !thread.deleted) setIsCollapsed(false);
      }}
      className={`rounded-md border border-yellow-600/50 border-l-4 border-l-yellow-400 bg-github-bg-tertiary p-3 shadow-sm transition-all ${
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
            {!readOnly && !isCollapsed && (
              <button
                type="button"
                onClick={handleCopyThread}
                className="whitespace-nowrap rounded px-2 py-1 text-xs transition-all"
                style={{
                  backgroundColor: 'var(--color-yellow-btn-bg)',
                  color: 'var(--color-yellow-btn-text)',
                  border: '1px solid var(--color-yellow-btn-border)',
                }}
                title="Copy thread prompt for AI coding agent"
              >
                <span className="inline-flex items-center gap-1">
                  <Copy size={12} />
                  {isCopied ? 'Copied!' : 'Copy Prompt'}
                </span>
              </button>
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
              onResolveOrDelete={() => onToggleThreadResolved(thread.id)}
              actionLabel={thread.resolution?.resolved ? 'Reopen thread' : 'Resolve thread'}
              onDelete={!readOnly && onRemoveThread ? () => onRemoveThread(thread.id) : undefined}
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
                    onResolveOrDelete={() => onRemoveMessage(thread.id, message.id)}
                    actionLabel="Delete reply"
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
                  <div
                    role="group"
                    aria-label="Reply"
                    className="flex flex-wrap items-center gap-2"
                  >
                    {agentRepliedLast &&
                      QUICK_REPLIES.map(({ label, body, intent }) => (
                        <button
                          key={label}
                          type="button"
                          title={`Send "${body}" as a ${intent}`}
                          onClick={() => {
                            onReplyToThread(thread.id, body, intent)
                              .then(markAgentRepliesRead)
                              .catch((error: unknown) => {
                                console.error('Failed to send quick reply:', error);
                              });
                          }}
                          className="whitespace-nowrap rounded-full border border-github-border bg-github-bg-secondary px-3 py-1 text-xs text-github-text-primary transition-colors hover:border-github-text-secondary hover:bg-github-bg-primary"
                        >
                          {label}
                        </button>
                      ))}
                    <button
                      ref={replyTrigger}
                      type="button"
                      onClick={() => setReplyForm('opened')}
                      className="min-w-40 flex-1 cursor-text rounded border border-github-border bg-github-bg-secondary px-3 py-1.5 text-left text-sm text-github-text-muted transition-colors hover:border-github-text-secondary"
                    >
                      Write a reply...
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
