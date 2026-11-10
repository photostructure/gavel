import { Keyboard, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useHotkeysContext } from 'react-hotkeys-hook';

import { version } from '../../../package.json';
import type { ReviewContext as ReviewContextData } from '../../types/diff';

import { GitHubIcon } from './GitHubIcon';
import { ReviewContext } from './ReviewContext';

export function AboutPanel({
  context,
  onClose,
  onShowShortcuts,
}: {
  context?: ReviewContextData;
  onClose: () => void;
  onShowShortcuts: () => void;
}) {
  // vite.config.ts sets these only when `vite build` makes a development build.
  const buildCommit = import.meta.env.VITE_GAVEL_BUILD_COMMIT;
  const buildDiffHash = import.meta.env.VITE_GAVEL_BUILD_DIFF_HASH;
  const panel = useRef<HTMLDivElement>(null);
  const { enableScope, disableScope } = useHotkeysContext();
  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.focus();
    disableScope('navigation');
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
      if (event.key !== 'Tab' || !panel.current) return;
      const controls = [
        ...panel.current.querySelectorAll<HTMLElement>('button, summary, a[href]'),
      ].filter((control) => !control.hidden);
      const first = controls[0],
        last = controls.at(-1);
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === panel.current)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    const element = panel.current;
    element?.addEventListener('keydown', onKey);
    return () => {
      element?.removeEventListener('keydown', onKey);
      enableScope('navigation');
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [onClose, enableScope, disableScope]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        id="about-panel"
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="About"
        className="review-panel relative h-full w-full max-w-lg overflow-y-auto border-l border-github-border bg-github-bg-primary p-5 text-github-text-primary shadow-lg"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg ui-heading">About</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-github-text-secondary transition-colors hover:text-github-text-primary"
            aria-label="Close About"
          >
            <X size={20} />
          </button>
        </div>
        {context ? (
          <ReviewContext context={context} />
        ) : (
          <p className="text-sm text-github-text-secondary">
            Review information is unavailable from this server.
          </p>
        )}
        <section aria-label="Gavel" className="mt-4 border-t border-github-border pt-4">
          <dl className="grid grid-cols-1 gap-y-1 text-xs">
            <dt className="ui-heading">Gavel build</dt>
            <dd className="select-text ui-value">
              {import.meta.env.VITE_GAVEL_RELEASE_BUILD === 'true' ? (
                `Version ${version}`
              ) : (
                <span
                  className="mt-1 inline-block rounded p-1"
                  style={{
                    background:
                      'repeating-linear-gradient(-45deg, #facc15 0 8px, #171717 8px 16px)',
                  }}
                >
                  <span className="block rounded-sm bg-github-bg-primary px-2 py-1">
                    Development build (last release {version})
                  </span>
                </span>
              )}
            </dd>
            {buildCommit !== undefined && (
              <>
                <dt className="mt-2 ui-heading">Built from commit</dt>
                <dd className="font-mono select-text ui-value">{buildCommit}</dd>
                <dt className="mt-2 ui-heading">Uncommitted changes</dt>
                {buildDiffHash ? (
                  <dd className="font-mono break-all select-text ui-value">
                    sha256 {buildDiffHash}
                  </dd>
                ) : (
                  <dd className="ui-value">None</dd>
                )}
              </>
            )}
          </dl>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={onShowShortcuts}
              className="flex items-center gap-1.5 text-github-text-secondary transition-colors hover:text-github-text-primary"
              title="Keyboard shortcuts (Shift+?)"
            >
              <Keyboard size={16} />
              <span className="text-sm">Shortcuts</span>
            </button>
            <a
              href="https://github.com/photostructure/gavel"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-github-text-secondary transition-colors hover:text-github-text-primary"
              title="View on GitHub"
            >
              <span className="text-sm">Star on GitHub</span>
              <GitHubIcon style={{ height: '18px', width: '18px' }} />
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
