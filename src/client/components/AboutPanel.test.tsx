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

  it('shows the commit and uncommitted-changes hash on a development build', () => {
    vi.stubEnv('VITE_GAVEL_RELEASE_BUILD', undefined);
    vi.stubEnv('VITE_GAVEL_BUILD_COMMIT', '0123456789abcdef0123456789abcdef01234567');
    vi.stubEnv('VITE_GAVEL_BUILD_DIFF_HASH', 'fedcba9876543210'.repeat(4));
    renderPanel();
    expect(screen.getByText('0123456789abcdef0123456789abcdef01234567')).toBeInTheDocument();
    expect(screen.getByText(`sha256 ${'fedcba9876543210'.repeat(4)}`)).toBeInTheDocument();
  });

  it('says a development build had no uncommitted changes', () => {
    vi.stubEnv('VITE_GAVEL_RELEASE_BUILD', undefined);
    vi.stubEnv('VITE_GAVEL_BUILD_COMMIT', '0123456789abcdef0123456789abcdef01234567');
    vi.stubEnv('VITE_GAVEL_BUILD_DIFF_HASH', '');
    renderPanel();
    expect(screen.getByText('None')).toBeInTheDocument();
  });

  it('omits commit details when the build did not record them', () => {
    vi.stubEnv('VITE_GAVEL_BUILD_COMMIT', undefined);
    renderPanel();
    expect(screen.queryByText('Built from commit')).toBeNull();
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
