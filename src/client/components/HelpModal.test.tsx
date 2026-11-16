import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { HotkeysProvider } from 'react-hotkeys-hook';
import { describe, expect, it, vi } from 'vitest';

import { useKeyboardNavigation } from '../hooks/useKeyboardNavigation';

import { AboutPanel } from './AboutPanel';
import { HelpModal } from './HelpModal';

function AboutThenHelp() {
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  return (
    <HotkeysProvider initiallyActiveScopes={['navigation']}>
      <button type="button" onClick={() => setIsAboutOpen(true)}>
        Open About
      </button>
      <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
      {isAboutOpen && (
        <AboutPanel
          onClose={() => setIsAboutOpen(false)}
          onShowShortcuts={() => {
            setIsAboutOpen(false);
            setIsHelpOpen(true);
          }}
        />
      )}
    </HotkeysProvider>
  );
}

// The app's wiring: ? in the navigation scope opens the help, and the help closes itself
function HelpFromKeyboard() {
  const { isHelpOpen, setIsHelpOpen } = useKeyboardNavigation({
    files: [],
    comments: [],
    onToggleReviewed: vi.fn(),
    reviewedFiles: new Set<string>(),
    collapsedFiles: new Set<string>(),
  });
  return <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />;
}

describe('HelpModal', () => {
  // Its own row reads "Show/hide this help"
  it('closes with the ? that opened it', async () => {
    const user = userEvent.setup();
    render(
      <HotkeysProvider initiallyActiveScopes={['navigation']}>
        <HelpFromKeyboard />
      </HotkeysProvider>,
    );
    const heading = () => screen.queryByRole('heading', { name: 'Keyboard Shortcuts' });

    await user.keyboard('{Shift>}?{/Shift}');
    expect(heading()).toBeInTheDocument();

    await user.keyboard('{Shift>}?{/Shift}');
    expect(heading()).not.toBeInTheDocument();

    await user.keyboard('{Shift>}?{/Shift}');
    expect(heading()).toBeInTheDocument();
  });

  // The header's toasts float at z-50 above Conversation; this dialog sits above them, below the
  // tooltips (z-[60]), so a toast cannot cover it or take its clicks.
  it('sits above the header toasts', () => {
    render(
      <HotkeysProvider initiallyActiveScopes={['navigation']}>
        <HelpModal isOpen onClose={vi.fn()} />
      </HotkeysProvider>,
    );
    expect(document.querySelector('.fixed.inset-0')).toHaveClass('z-[55]');
  });

  it('lists the verdict shortcuts', () => {
    render(
      <HotkeysProvider initiallyActiveScopes={['navigation']}>
        <HelpModal isOpen onClose={vi.fn()} />
      </HotkeysProvider>,
    );

    const row = (description: string) => screen.getByText(description).parentElement;
    expect(row('Approve this review')).toHaveTextContent(/^Shift\+A/);
    expect(row('Reject this review')).toHaveTextContent(/^Shift\+X/);
    expect(row("After a verdict, take the toast's next step")).toHaveTextContent(/^Return/);
    expect(row('After a verdict, dismiss the toast')).toHaveTextContent(/^Esc/);
  });

  it('takes focus from the button that opened About, and returns it on close', async () => {
    const user = userEvent.setup();
    render(<AboutThenHelp />);
    const opener = screen.getByRole('button', { name: 'Open About' });
    await user.click(opener);
    await user.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));

    const modal = screen.getByRole('heading', { name: 'Keyboard Shortcuts' }).closest('.fixed');
    expect(modal?.contains(document.activeElement)).toBe(true);

    const restoreFocus = vi.spyOn(opener, 'focus');
    await user.click(screen.getByRole('button', { name: 'Close help modal' }));
    expect(document.activeElement).toBe(opener);
    // Focus may return to a control the reviewer has scrolled far past.
    expect(restoreFocus).toHaveBeenCalledWith({ preventScroll: true });
  });
});
