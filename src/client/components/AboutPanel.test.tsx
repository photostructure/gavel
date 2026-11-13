import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { version } from '../../../package.json';

import { AboutPanel, tagline } from './AboutPanel';

afterEach(() => {
  vi.unstubAllEnvs();
});

function renderPanel(onShowShortcuts = vi.fn()) {
  render(<AboutPanel onClose={vi.fn()} onShowShortcuts={onShowShortcuts} />);
}

describe('AboutPanel', () => {
  it('shows the tagline under the logo', () => {
    renderPanel();
    expect(screen.getByText(tagline)).toBeInTheDocument();
  });

  it('shows the package version on a release build', () => {
    vi.stubEnv('VITE_GAVEL_RELEASE_BUILD', 'true');
    renderPanel();
    expect(screen.getByText(`Version ${version}`)).toBeInTheDocument();
  });

  it('says a development build is one, with the last release', () => {
    vi.stubEnv('VITE_GAVEL_RELEASE_BUILD', undefined);
    renderPanel();
    expect(screen.getByText(`Development build (last release ${version})`)).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    expect(onShowShortcuts).toHaveBeenCalledOnce();
  });

  it('opens the keyboard shortcuts on ?, which its row shows as the key', () => {
    // About disables the navigation scope where the app binds ?, so the panel handles it.
    const onShowShortcuts = vi.fn();
    renderPanel(onShowShortcuts);
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'About' }), { key: '?' });
    expect(onShowShortcuts).toHaveBeenCalledOnce();
  });

  it('lists the shortcuts and links above the review details', () => {
    render(
      <AboutPanel
        context={{ source: 'git', workingDirectory: '/repo', hostname: 'speedy' }}
        onClose={vi.fn()}
        onShowShortcuts={vi.fn()}
      />,
    );
    const links = screen.getByRole('list', { name: 'Gavel links' });
    expect(within(links).getAllByRole('listitem')).toHaveLength(3);
    const details = screen.getByRole('region', { name: 'Review context' });
    expect(links.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('links to the introduction on photostructure.com', () => {
    renderPanel();
    const link = screen.getByRole('link', { name: /How gavel works/ });
    expect(link).toHaveAttribute('href', 'https://photostructure.com/coding/gavel/');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('links to the GitHub repository', () => {
    renderPanel();
    expect(screen.getByRole('link', { name: /Star on GitHub/ })).toHaveAttribute(
      'href',
      'https://github.com/photostructure/gavel',
    );
  });
});
