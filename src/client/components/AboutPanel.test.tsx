import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { version } from '../../../package.json';

import { AboutPanel } from './AboutPanel';

afterEach(() => {
  vi.unstubAllEnvs();
});

function renderPanel(onShowShortcuts = vi.fn()) {
  render(<AboutPanel onClose={vi.fn()} onShowShortcuts={onShowShortcuts} />);
}

describe('AboutPanel', () => {
  it('shows the package version on a release build', () => {
    vi.stubEnv('VITE_GAVEL_RELEASE_BUILD', 'true');
    renderPanel();
    const notice = screen.getByText(`Version ${version}`);
    expect(notice.closest('[style*="repeating-linear-gradient"]')).toBeNull();
  });

  it('frames the notice in hazard stripes on a development build', () => {
    vi.stubEnv('VITE_GAVEL_RELEASE_BUILD', undefined);
    renderPanel();
    const notice = screen.getByText(`Development build (last release ${version})`);
    expect(notice.closest('[style*="repeating-linear-gradient"]')).not.toBeNull();
  });

  it('opens the keyboard shortcuts', () => {
    const onShowShortcuts = vi.fn();
    renderPanel(onShowShortcuts);
    fireEvent.click(screen.getByRole('button', { name: 'Shortcuts' }));
    expect(onShowShortcuts).toHaveBeenCalledOnce();
  });

  it('links to the GitHub repository', () => {
    renderPanel();
    expect(screen.getByRole('link', { name: /Star on GitHub/ })).toHaveAttribute(
      'href',
      'https://github.com/photostructure/gavel',
    );
  });
});
