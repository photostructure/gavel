import { BookOpen, Keyboard, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useHotkeysContext } from 'react-hotkeys-hook';

import { version } from '../../../package.json';
import type { ReviewContext as ReviewContextData } from '../../types/diff';

import { GitHubIcon } from './GitHubIcon';
import { Logo } from './Logo';
import { Detail, DetailGroup, ReviewContext } from './ReviewContext';

const linkRow =
  'flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm text-github-text-primary transition-colors hover:bg-github-bg-tertiary';
const linkIcon = 'shrink-0 text-github-text-secondary';
const linkHint = 'ml-auto text-xs text-github-text-secondary';

export const tagline = 'Your agent makes the case for its code. You give the verdict.';

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
        onKeyDown={(event) => {
          // The app binds ? in the navigation scope, which About disables while it is open.
          if (event.key !== '?') return;
          event.preventDefault();
          onShowShortcuts();
        }}
        className="review-panel relative h-full w-full max-w-lg overflow-y-auto border-l border-github-border bg-github-bg-primary p-5 text-github-text-primary shadow-lg"
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h2 className="sr-only">About</h2>
            <Logo style={{ height: '24px', color: 'var(--color-github-text-primary)' }} />
            <p className="mt-2 text-sm text-github-text-secondary">{tagline}</p>
            <p className="mt-1.5 select-text text-xs ui-label">
              {import.meta.env.VITE_GAVEL_RELEASE_BUILD === 'true'
                ? `Version ${version}`
                : `Development build (last release ${version})`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-github-text-secondary transition-colors hover:text-github-text-primary"
            aria-label="Close About"
          >
            <X size={20} />
          </button>
        </div>
        {/* What you open from About comes before the reference details below it. */}
        <ul aria-label="Gavel links" className="-mx-2 mb-5 border-b border-github-border pb-4">
          <li>
            <button
              type="button"
              onClick={onShowShortcuts}
              aria-keyshortcuts="?"
              className={linkRow}
            >
              <Keyboard size={16} aria-hidden="true" className={linkIcon} />
              Keyboard shortcuts
              <kbd
                aria-hidden="true"
                className="ml-auto rounded border border-github-border px-1.5 font-mono text-xs text-github-text-secondary"
              >
                ?
              </kbd>
            </button>
          </li>
          <li>
            <a
              href="https://photostructure.com/coding/gavel/"
              target="_blank"
              rel="noopener noreferrer"
              className={linkRow}
            >
              <BookOpen size={16} aria-hidden="true" className={linkIcon} />
              How gavel works
              <span className={linkHint}>photostructure.com</span>
            </a>
          </li>
          <li>
            <a
              href="https://github.com/photostructure/gavel"
              target="_blank"
              rel="noopener noreferrer"
              className={linkRow}
            >
              <span aria-hidden="true" className={`flex ${linkIcon}`}>
                <GitHubIcon style={{ height: '16px', width: '16px' }} />
              </span>
              Star on GitHub
              <span className={linkHint}>github.com</span>
            </a>
          </li>
        </ul>
        {context ? (
          <ReviewContext context={context} />
        ) : (
          <p className="text-sm text-github-text-secondary">
            Review information is unavailable from this server.
          </p>
        )}
        {buildCommit !== undefined && (
          <section aria-label="Gavel build" className="mt-5">
            <DetailGroup title="Build">
              <Detail label="Built from commit" mono>
                {buildCommit}
              </Detail>
              <Detail label="Uncommitted changes" mono={Boolean(buildDiffHash)}>
                {buildDiffHash ? `sha256 ${buildDiffHash}` : 'None'}
              </Detail>
            </DetailGroup>
          </section>
        )}
      </div>
    </div>
  );
}
