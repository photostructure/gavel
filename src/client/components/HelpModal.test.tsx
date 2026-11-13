import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { HotkeysProvider } from 'react-hotkeys-hook';
import { describe, expect, it, vi } from 'vitest';

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

describe('HelpModal', () => {
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
