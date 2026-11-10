import { X } from 'lucide-react';
import {
  useEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
  useId,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { useHotkeys, useHotkeysContext } from 'react-hotkeys-hook';

import type { CommentIntent, CommentThread, DiffSelection } from '../../types/diff';
import { hasActiveTextSelection } from '../utils/domUtils';
import { useDraftAnchors } from '../hooks/useCommentDrafts';
import type { AgentUpdate } from '../hooks/useAgentUpdates';

import { CommentForm, type CommentSubmitOptions } from './CommentForm';
import { CommentThreadCard } from './CommentThreadCard';
import type { AppearanceSettings } from './SettingsModal';
import { UnsentDrafts } from './UnsentDrafts';

/** Another review on this server, whose threads the panel can list but not change. */
export interface OtherReviewConversation {
  key: string;
  name: string;
  selection: DiffSelection;
  threads: CommentThread[];
  showAuthorBadges: boolean;
}

interface CommentsListModalProps {
  headerActions?: ReactNode;
  // Across every review on the server, not only the open one.
  unreadUpdates?: AgentUpdate[];
  readScope?: string | null;
  onMarkAllRead?: () => void;
  onMarkAllReviewsRead?: () => void;
  otherReviews?: OtherReviewConversation[];
  currentReviewName?: string;
  onOpenOtherReviewThread?: (review: OtherReviewConversation, threadId: string) => void;
  // Opens this thread's card once the open review's threads include it.
  focusThreadId?: string | null;
  onThreadFocused?: () => void;
  isOpen: boolean;
  onClose: () => void;
  onAddGeneralComment?: (body: string, options: CommentSubmitOptions) => Promise<void>;
  onNavigate: (thread: CommentThread) => void;
  // Shows the Unsent drafts section when given.
  unsentDrafts?: Pick<
    ComponentProps<typeof UnsentDrafts>,
    'diffFilePaths' | 'onAddComment' | 'onNavigateToLine' | 'codeFor'
  >;
  comments: CommentThread[];
  showAuthorBadges?: boolean;
  onToggleThreadResolved: (threadId: string) => void;
  onRemoveThread?: (threadId: string) => void;
  onRestoreComment?: (threadId: string, messageId?: string) => void;
  onGenerateThreadPrompt: (thread: CommentThread) => string;
  onReplyToThread: (threadId: string, body: string, intent?: CommentIntent) => Promise<void>;
  onRemoveMessage: (threadId: string, messageId: string) => void;
  onUpdateMessage: (
    threadId: string,
    messageId: string,
    newBody: string,
    intent?: CommentIntent,
  ) => void;

  syntaxTheme?: AppearanceSettings['syntaxTheme'];
}

const EMPTY_UPDATES: AgentUpdate[] = [];
const EMPTY_REVIEWS: OtherReviewConversation[] = [];

function compareThreadsByPosition(a: CommentThread, b: CommentThread): number {
  const fileCompare = (a.file ?? '').localeCompare(b.file ?? '');
  if (fileCompare !== 0) return fileCompare;

  const aLine = Array.isArray(a.line) ? a.line[0] : a.line;
  const bLine = Array.isArray(b.line) ? b.line[0] : b.line;
  if (aLine !== bLine) return (aLine ?? 0) - (bLine ?? 0);

  return a.createdAt.localeCompare(b.createdAt);
}

const MARK_READ_BUTTON_CLASSES =
  'inline-flex h-8 items-center justify-center rounded border border-github-border px-2 text-xs text-github-text-primary hover:bg-github-bg-tertiary disabled:cursor-not-allowed disabled:opacity-50';

export function CommentsListModal({
  headerActions,
  unreadUpdates = EMPTY_UPDATES,
  readScope = null,
  onMarkAllRead,
  onMarkAllReviewsRead,
  otherReviews = EMPTY_REVIEWS,
  currentReviewName,
  onOpenOtherReviewThread,
  focusThreadId = null,
  onThreadFocused,
  isOpen,
  onClose,
  onAddGeneralComment,
  onNavigate,
  unsentDrafts,
  comments,
  showAuthorBadges = false,
  onToggleThreadResolved,
  onRemoveThread,
  onRestoreComment,
  onGenerateThreadPrompt,
  onReplyToThread,
  onRemoveMessage,
  onUpdateMessage,

  syntaxTheme,
}: CommentsListModalProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedFilter, setFilter] = useState<
    'current' | 'open' | 'resolved' | 'unread' | 'all-reviews'
  >('current');
  // The All reviews pill goes away with the last other review, even while selected.
  const filter =
    selectedFilter === 'all-reviews' && otherReviews.length === 0 ? 'current' : selectedFilter;
  const filterName = useId();
  const [focus, setFocus] = useState<{
    scope: string | null;
    threadId: string;
    messageId: string;
    request: number;
  } | null>(null);
  const focusedMessage = focus?.scope === readScope ? focus : null;
  const unreadByThread = useMemo(() => {
    const grouped = new Map<string, AgentUpdate[]>();
    for (const update of unreadUpdates) {
      const list = grouped.get(update.thread.id) ?? [];
      list.push(update);
      grouped.set(update.thread.id, list);
    }
    return grouped;
  }, [unreadUpdates]);
  const [generalDraft, setGeneralDraft] = useState<{
    body: string;
    intent: CommentIntent;
  }>({ body: '', intent: 'comment' });
  const commentRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dialogRef = useRef<HTMLDivElement>(null);
  const { enableScope, disableScope } = useHotkeysContext();
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement;
    dialogRef.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    setFocus((previous) => (!isOpen || previous?.scope !== readScope ? null : previous));
  }, [isOpen, readScope]);

  const otherReviewByThread = useMemo(
    () =>
      new Map(
        otherReviews.flatMap((review) =>
          review.threads.map((thread) => [thread.id, review] as const),
        ),
      ),
    [otherReviews],
  );
  const listsEveryReview = filter === 'unread' || filter === 'all-reviews';
  const threadGroups = [
    { review: null, threads: comments },
    ...(listsEveryReview
      ? otherReviews.map((review) => ({ review, threads: review.threads }))
      : []),
  ]
    .map((group) => ({
      ...group,
      threads: group.threads
        .filter((thread) =>
          filter === 'unread'
            ? !thread.deleted && unreadByThread.has(thread.id)
            : thread.deleted ||
              filter === 'current' ||
              filter === 'all-reviews' ||
              Boolean(thread.resolution?.resolved) === (filter === 'resolved'),
        )
        .sort(compareThreadsByPosition),
    }))
    .filter((group) => group.threads.length > 0);
  const sortedThreads = threadGroups.flatMap((group) => group.threads);
  const showReviewHeadings = listsEveryReview && otherReviews.length > 0;
  const currentUnreadCount = unreadUpdates.filter(
    (update) => !otherReviewByThread.has(update.thread.id),
  ).length;

  const focusedThreadIndex = sortedThreads.findIndex(
    (thread) => thread.id === focusedMessage?.threadId,
  );
  const handledFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!isOpen || !focusedMessage) {
      handledFocus.current = null;
      return;
    }
    const key = JSON.stringify([
      focusedMessage.threadId,
      focusedMessage.messageId,
      focusedMessage.request,
    ]);
    if (handledFocus.current === key) return;
    if (focusedThreadIndex >= 0) {
      setSelectedIndex(focusedThreadIndex);
      handledFocus.current = key;
    }
  }, [isOpen, focusedMessage, focusedThreadIndex]);

  useEffect(() => {
    setSelectedIndex((index) => Math.max(0, Math.min(index, sortedThreads.length - 1)));
  }, [sortedThreads.length]);

  // Discarding or sending an unsent draft removes the control that had focus, too.
  const draftCount = useDraftAnchors().length;
  useEffect(() => {
    if (isOpen && document.activeElement === document.body) dialogRef.current?.focus();
  }, [isOpen, sortedThreads.length, draftCount]);

  const handleThreadClick = useCallback(
    (thread: CommentThread) => {
      const otherReview = otherReviewByThread.get(thread.id);
      if (otherReview) {
        onOpenOtherReviewThread?.(otherReview, thread.id);
        return;
      }
      if (thread.scope === 'review') return;
      onNavigate(thread);
      onClose();
    },
    [onClose, onNavigate, onOpenOtherReviewThread, otherReviewByThread],
  );

  // A reply or edit draft opens its thread's card here, which holds the draft's form.
  // The diff may not draw the thread at all (a later capture dropped its hunk), so the
  // panel never sends it there. The filter switches to This review so the card is listed.
  const openThreadCard = useCallback(
    (thread: CommentThread, messageId?: string) => {
      const focusId = messageId ?? thread.messages[0]?.id;
      if (focusId === undefined) return;
      setFilter('current');
      setFocus((previous) => ({
        scope: readScope,
        threadId: thread.id,
        messageId: focusId,
        request: (previous?.request ?? 0) + 1,
      }));
    },
    [readScope],
  );

  useEffect(() => {
    if (!isOpen || focusThreadId === null) return;
    const thread = comments.find((item) => item.id === focusThreadId);
    if (!thread) return;
    const unreadIds = new Set(unreadByThread.get(thread.id)?.map((update) => update.message.id));
    openThreadCard(thread, thread.messages.find((message) => unreadIds.has(message.id))?.id);
    onThreadFocused?.();
  }, [isOpen, focusThreadId, comments, unreadByThread, openThreadCard, onThreadFocused]);

  const handleRemoveThread = (threadId: string) => {
    onRemoveThread?.(threadId);
    if (selectedIndex >= sortedThreads.length - 1 && selectedIndex > 0) {
      setSelectedIndex(selectedIndex - 1);
    }
  };

  const handleToggleResolution = useCallback(
    (thread: CommentThread) => {
      if (!thread.deleted && !otherReviewByThread.has(thread.id)) onToggleThreadResolved(thread.id);
    },
    [onToggleThreadResolved, otherReviewByThread],
  );

  useEffect(() => {
    if (isOpen) {
      enableScope('comments-list');
      disableScope('navigation');
    } else {
      enableScope('navigation');
      disableScope('comments-list');
      setSelectedIndex(0);
    }

    return () => {
      enableScope('navigation');
      disableScope('comments-list');
    };
  }, [disableScope, enableScope, isOpen]);

  const hotkeyOptions = { scopes: 'comments-list', enableOnFormTags: false };

  useHotkeys('escape', () => onClose(), hotkeyOptions, [onClose]);

  useHotkeys(
    'j, down',
    () => setSelectedIndex((prev) => Math.min(prev + 1, sortedThreads.length - 1)),
    hotkeyOptions,
    [sortedThreads.length],
  );

  useHotkeys('k, up', () => setSelectedIndex((prev) => Math.max(prev - 1, 0)), hotkeyOptions, []);

  useHotkeys(
    'enter',
    () => {
      if (sortedThreads[selectedIndex]) {
        handleThreadClick(sortedThreads[selectedIndex]);
      }
    },
    {
      ...hotkeyOptions,
      preventDefault: true,
      ignoreEventWhen: (event: KeyboardEvent) =>
        event.target instanceof Element &&
        event.target.closest('button, a, [role="button"]') !== null,
    },
    [handleThreadClick, selectedIndex, sortedThreads],
  );

  useHotkeys(
    'd',
    () => {
      if (sortedThreads[selectedIndex]) {
        handleToggleResolution(sortedThreads[selectedIndex]);
      }
    },
    hotkeyOptions,
    [handleToggleResolution, selectedIndex, sortedThreads],
  );

  useEffect(() => {
    if (commentRefs.current[selectedIndex]) {
      commentRefs.current[selectedIndex]?.scrollIntoView({
        block: 'nearest',
      });
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        id="conversation-panel"
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="conversation-title"
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const controls = [
            ...event.currentTarget.querySelectorAll<HTMLElement>(
              'button, a[href], input, select, textarea, [tabindex]',
            ),
          ].filter(
            (element) =>
              element.tabIndex >= 0 &&
              !element.hasAttribute('disabled') &&
              !element.closest('[hidden]') &&
              !(
                element instanceof HTMLInputElement &&
                element.type === 'radio' &&
                !element.checked
              ),
          );
          const first = controls[0],
            last = controls.at(-1);
          if (
            event.shiftKey &&
            (document.activeElement === first || document.activeElement === dialogRef.current)
          ) {
            event.preventDefault();
            last?.focus();
          } else if (
            !event.shiftKey &&
            (document.activeElement === last || document.activeElement === dialogRef.current)
          ) {
            event.preventDefault();
            first?.focus();
          }
        }}
        className="relative flex h-full w-full max-w-2xl flex-col overflow-hidden border border-github-border bg-github-bg-primary shadow-lg"
      >
        <div className="sticky top-0 border-b border-github-border bg-github-bg-primary px-6 py-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="conversation-title" className="text-lg ui-heading">
              Conversation
            </h2>
            <button
              onClick={onClose}
              className="text-github-text-secondary transition-colors hover:text-github-text-primary"
              aria-label="Close conversation"
            >
              <X size={20} />
            </button>
          </div>
          {(headerActions || onMarkAllRead) && (
            <div className="mb-3 flex flex-wrap items-center gap-3">
              {headerActions}
              {onMarkAllRead && (
                <button
                  type="button"
                  onClick={onMarkAllRead}
                  disabled={currentUnreadCount === 0}
                  title="Mark every agent reply in this review as read, including hidden threads"
                  className={MARK_READ_BUTTON_CLASSES}
                >
                  {otherReviews.length > 0 ? 'Mark this review read' : 'Mark all read'}
                </button>
              )}
              {onMarkAllReviewsRead && otherReviews.length > 0 && (
                <button
                  type="button"
                  onClick={onMarkAllReviewsRead}
                  disabled={unreadUpdates.length === 0}
                  title="Mark every agent reply in every review as read, including hidden threads"
                  className={MARK_READ_BUTTON_CLASSES}
                >
                  Mark all reviews read
                </button>
              )}
            </div>
          )}
          <fieldset role="radiogroup" aria-label="Conversation filter">
            <legend className="mb-2 text-xs ui-heading">Show conversations</legend>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['current', 'This review'],
                  ['open', 'Open'],
                  ['resolved', 'Resolved'],
                  ['unread', 'Unread'],
                  ...(otherReviews.length > 0 ? ([['all-reviews', 'All reviews']] as const) : []),
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="cursor-pointer">
                  <input
                    type="radio"
                    name={filterName}
                    value={value}
                    checked={filter === value}
                    onChange={() => {
                      setFilter(value);
                      setSelectedIndex(0);
                    }}
                    className="peer sr-only"
                  />
                  <span
                    className={`inline-flex rounded-full border px-3 py-1.5 text-sm transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-github-accent ${
                      filter === value
                        ? 'bg-github-accent text-white border-github-accent'
                        : 'bg-github-bg-tertiary text-github-text-secondary border-github-border hover:text-github-text-primary'
                    }`}
                  >
                    {label}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <p className="mt-3 text-xs text-github-text-secondary">
            Blue dots mark unread replies. Click a reply or its filled dot to mark it read; click a
            hollow dot to mark it unread.
            {otherReviews.length > 0 &&
              ' On a thread from another review, use the dot; clicking the thread opens that review.'}
          </p>
          <div className="mt-2 text-xs text-github-text-secondary">
            <span className="font-mono">j/k</span> or <span className="font-mono">↑/↓</span> to
            navigate • <span className="font-mono">Enter</span> to jump •{' '}
            <span className="font-mono">d</span> to resolve/reopen •{' '}
            <span className="font-mono">Esc</span> to close
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="p-6">
            {unsentDrafts && (
              <UnsentDrafts
                {...unsentDrafts}
                threads={comments}
                syntaxTheme={syntaxTheme}
                onNavigateToThread={openThreadCard}
                onClosePanel={onClose}
              />
            )}
            {onAddGeneralComment && (
              <div className="mb-6 border-b border-github-border pb-5">
                <CommentForm
                  embedded
                  submitLabel="Send"
                  value={generalDraft.body}
                  onChange={(nextBody) =>
                    setGeneralDraft((current) => {
                      const body =
                        typeof nextBody === 'function' ? nextBody(current.body) : nextBody;
                      return body === current.body ? current : { ...current, body };
                    })
                  }
                  intentValue={generalDraft.intent}
                  onIntentChange={(intent) =>
                    setGeneralDraft((current) => ({ ...current, intent }))
                  }
                  dismissOnOutsideClick={false}
                  autoFocus={false}
                  title="General comment or question"
                  placeholder="Comment or ask about this review…"
                  onSubmit={async (body, options) => {
                    const submittedDraft = generalDraft;
                    await onAddGeneralComment(body, options);
                    setGeneralDraft((current) =>
                      current === submittedDraft ? { body: '', intent: 'comment' } : current,
                    );
                  }}
                  onCancel={(text) => {
                    // Cancel passes ''; Escape passes the text, which stays in the
                    // draft for the next open, as in the panel's other forms.
                    if (!text.trim()) setGeneralDraft({ body: '', intent: 'comment' });
                    onClose();
                  }}
                />
              </div>
            )}

            {sortedThreads.length === 0 ? (
              <p className="text-center text-github-text-secondary">
                {filter === 'unread' ? 'No unread threads' : 'No comments yet'}
              </p>
            ) : (
              <>
                <div className="space-y-4">
                  {threadGroups.map((group, groupIndex) => {
                    const firstIndex = threadGroups
                      .slice(0, groupIndex)
                      .reduce((count, earlier) => count + earlier.threads.length, 0);
                    return (
                      <section key={group.review?.key ?? 'current'} className="space-y-2">
                        {showReviewHeadings && (
                          <h3 className="text-xs ui-heading">
                            <code>{group.review?.name ?? currentReviewName ?? 'This review'}</code>
                          </h3>
                        )}
                        {group.threads.map((thread, threadIndex) => {
                          const index = firstIndex + threadIndex;
                          return (
                            <div
                              key={thread.id}
                              ref={(el) => {
                                commentRefs.current[index] = el;
                              }}
                              className={
                                selectedIndex === index ? 'rounded ring-2 ring-blue-500' : ''
                              }
                            >
                              <CommentThreadCard
                                readOnly={group.review !== null}
                                linkReview={group.review?.selection}
                                onEscapeKeepingDraft={onClose}
                                unreadCount={unreadByThread.get(thread.id)?.length ?? 0}
                                onReadUnread={() => {
                                  const unreadIds = new Set(
                                    unreadByThread
                                      .get(thread.id)
                                      ?.map((update) => update.message.id),
                                  );
                                  const message = thread.messages.find((item) =>
                                    unreadIds.has(item.id),
                                  );
                                  if (!message) return;
                                  setFocus((previous) => ({
                                    scope: readScope,
                                    threadId: thread.id,
                                    messageId: message.id,
                                    request: (previous?.request ?? 0) + 1,
                                  }));
                                }}
                                focusedMessageId={
                                  focusedMessage?.threadId === thread.id
                                    ? focusedMessage.messageId
                                    : undefined
                                }
                                focusRequest={
                                  focusedMessage?.threadId === thread.id
                                    ? focusedMessage.request
                                    : undefined
                                }
                                thread={thread}
                                showAuthorBadges={
                                  group.review?.showAuthorBadges ?? showAuthorBadges
                                }
                                onGeneratePrompt={onGenerateThreadPrompt}
                                onRemoveThread={onRemoveThread ? handleRemoveThread : undefined}
                                onRestoreComment={onRestoreComment}
                                onToggleThreadResolved={onToggleThreadResolved}
                                onReplyToThread={onReplyToThread}
                                onRemoveMessage={onRemoveMessage}
                                onUpdateMessage={onUpdateMessage}
                                syntaxTheme={syntaxTheme}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // Selecting text inside a card fires a click as well; do not
                                  // treat it as a request to navigate and close the modal.
                                  if (hasActiveTextSelection()) return;
                                  setSelectedIndex(index);
                                  handleThreadClick(thread);
                                }}
                              />
                            </div>
                          );
                        })}
                      </section>
                    );
                  })}
                </div>
                <div className="mt-4 border-t border-github-border pt-4 text-center text-xs text-github-text-secondary">
                  {selectedIndex + 1} of {sortedThreads.length} threads
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
