import React, { useId, useRef, useState } from 'react';

import type { CommentIntent } from '../../types/diff';

import { CommentBodyRenderer, hasSuggestionInBody } from './CommentBodyRenderer';
import type { AppearanceSettings } from './SettingsModal';
import { SuggestionTemplateButton } from './SuggestionTemplateButton';
import { Tooltip } from './Tooltip';

export interface CommentSubmitOptions {
  isQuestion: boolean;
  intent?: CommentIntent;
}

interface CommentFormProps {
  onSubmit: (body: string, options: CommentSubmitOptions) => Promise<void>;
  // Receives the unsent draft so a caller can keep a form with text open on
  // Escape. Outside clicks reset only empty forms (resetEmptyCommentFormsOutside in
  // utils/domUtils.ts). The Cancel button discards the draft, so it passes ''.
  onCancel: (draft: string) => void;
  selectedCode?: string;
  syntaxTheme?: AppearanceSettings['syntaxTheme'];
  filename?: string;
  initialValue?: string;
  value?: string;
  onChange?: React.Dispatch<React.SetStateAction<string>>;
  embedded?: boolean;
  title?: string;
  submitLabel?: string;
  placeholder?: string;
  autoFocus?: boolean;
  dismissOnOutsideClick?: boolean;
  // The saved draft this form shows. Copies of one form share it, and an outside
  // click in one copy does not reset the others.
  draftKey?: string;
  initialIntent?: CommentIntent;
  intentValue?: CommentIntent;
  onIntentChange?: (intent: CommentIntent) => void;
}

type CommentFormMode = 'edit' | 'preview';

export function CommentForm({
  onSubmit,
  onCancel,
  selectedCode,
  syntaxTheme,
  filename,
  initialValue = '',
  value,
  onChange,
  embedded = false,
  title = 'Add a comment',
  submitLabel = 'Send',
  initialIntent = 'comment',
  intentValue,
  onIntentChange,
  autoFocus = true,
  dismissOnOutsideClick = true,
  draftKey,
  placeholder = 'Leave a comment...',
}: CommentFormProps) {
  const [localBody, setLocalBody] = useState(initialValue);
  const body = value ?? localBody;
  const setBody = (nextBody: React.SetStateAction<string>) => {
    setLocalBody(nextBody);
    onChange?.(nextBody);
  };
  const [localIntent, setLocalIntent] = useState<CommentIntent>(initialIntent);
  const intent = intentValue ?? localIntent;
  const intentGroupId = useId();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mode, setMode] = useState<CommentFormMode>('edit');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasSuggestion = hasSuggestionInBody(body);
  const effectiveMode: CommentFormMode = hasSuggestion ? mode : 'edit';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!body.trim()) return;

    setIsSubmitting(true);
    try {
      await onSubmit(body.trim(), {
        isQuestion: intent === 'question',
        intent,
      });
      if (value === undefined) {
        setBody((currentBody) => (currentBody === body ? '' : currentBody));
      }
      setLocalIntent('comment');
      setMode('edit');
    } catch (error) {
      console.error('Failed to submit comment:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      void handleSubmit(e);
    } else if (e.key === 'Escape') {
      onCancel(body);
    }
  };

  return (
    <form
      className={
        embedded
          ? 'bg-transparent'
          : 'm-2 mx-3 rounded-md border border-yellow-600/50 border-l-4 border-l-yellow-400 bg-github-bg-tertiary p-3'
      }
      onSubmit={handleSubmit}
      onReset={(event) => {
        event.preventDefault();
        if (!isSubmitting) onCancel(body);
      }}
      onClick={(e) => e.stopPropagation()}
      data-empty={!body.trim()}
      data-dismiss-on-outside-click={dismissOnOutsideClick}
      data-draft-key={draftKey}
    >
      <div
        role="radiogroup"
        aria-label="Comment intent"
        onKeyDownCapture={handleKeyDown}
        className="mb-3 flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1 text-xs text-github-text-secondary"
      >
        {(
          [
            ['comment', 'Comment', 'Share context or feedback. No agent reply is expected.'],
            ['change', 'Change request', 'Ask the agent to change the code and follow up.'],
            ['question', 'Question', 'Ask the agent for an explanation or answer.'],
          ] as const
        ).map(([value, label, description]) => (
          <Tooltip key={value} content={description}>
            <label
              className={`inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[4px] px-1.5 py-1 transition-colors${intent === value ? ' bg-github-text-primary/8 font-bold text-github-text-primary' : ''}`}
            >
              <input
                type="radio"
                name={intentGroupId}
                value={value}
                aria-description={description}
                checked={intent === value}
                disabled={isSubmitting}
                onChange={() => {
                  setLocalIntent(value);
                  onIntentChange?.(value);
                }}
              />
              {label}
            </label>
          </Tooltip>
        ))}
      </div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm ui-heading">{title}</span>
        {hasSuggestion ? (
          <div className="flex items-center border border-github-border rounded-md overflow-hidden">
            <button
              type="button"
              onClick={() => setMode('edit')}
              className={`text-xs px-2.5 py-1.5 ${
                effectiveMode === 'edit'
                  ? 'bg-github-bg-tertiary text-github-text-primary'
                  : 'bg-github-bg-secondary text-github-text-secondary'
              } transition-colors`}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => setMode('preview')}
              className={`text-xs px-2.5 py-1.5 border-l border-github-border ${
                effectiveMode === 'preview'
                  ? 'bg-github-bg-tertiary text-github-text-primary'
                  : 'bg-github-bg-secondary text-github-text-secondary'
              } transition-colors`}
            >
              Preview
            </button>
          </div>
        ) : (
          <SuggestionTemplateButton
            selectedCode={selectedCode}
            value={body}
            onChange={setBody}
            textareaRef={textareaRef}
          />
        )}
      </div>

      {hasSuggestion && effectiveMode === 'preview' ? (
        <div className="min-h-[60px] mb-2 bg-github-bg-secondary border border-github-border rounded px-3 py-2">
          <CommentBodyRenderer
            body={body}
            originalCode={selectedCode}
            filename={filename}
            syntaxTheme={syntaxTheme}
          />
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          className="w-full min-h-[60px] mb-2 resize-y bg-github-bg-secondary border border-github-border rounded px-3 py-2 text-github-text-primary text-sm leading-6 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/30 focus:min-h-[80px] disabled:opacity-50"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={Math.max(3, body.split('\n').length)}
          autoFocus={autoFocus}
          disabled={isSubmitting}
        />
      )}

      {/* Send precedes Cancel in tab order but renders at the opposite end of the
          row, so neither a Tab+Enter nor a slightly missed click on Send cancels. */}
      <div className="flex flex-row-reverse justify-between gap-2">
        <button
          type="submit"
          className="text-xs px-3 py-1.5 rounded transition-all disabled:opacity-50"
          style={{
            backgroundColor: 'var(--color-yellow-btn-bg)',
            color: 'var(--color-yellow-btn-text)',
            border: '1px solid var(--color-yellow-btn-border)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--color-yellow-btn-hover-bg)';
            e.currentTarget.style.borderColor = 'var(--color-yellow-btn-hover-border)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--color-yellow-btn-bg)';
            e.currentTarget.style.borderColor = 'var(--color-yellow-btn-border)';
          }}
          disabled={!body.trim() || isSubmitting}
        >
          {isSubmitting ? 'Submitting...' : submitLabel}
        </button>
        <button
          type="button"
          onClick={() => onCancel('')}
          className="text-xs px-3 py-1.5 bg-github-bg-tertiary text-github-text-primary border border-github-border rounded hover:opacity-80 transition-all disabled:opacity-50"
          disabled={isSubmitting}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
