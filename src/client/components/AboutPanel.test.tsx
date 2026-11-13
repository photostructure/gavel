import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { version } from '../../../package.json';

import { AboutPanel, tagline } from './AboutPanel';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(global.fetch).mockReset();
  Reflect.deleteProperty(navigator, 'globalPrivacyControl');
});

const latestUrl = 'https://registry.npmjs.org/@photostructure%2fgavel/latest';

function npmLatest(latest: string) {
  vi.mocked(global.fetch).mockResolvedValue(Response.json({ version: latest }));
}

function renderPanel(onShowShortcuts = vi.fn(), updateCheckDisabledBy?: string) {
  render(
    <AboutPanel
      onClose={vi.fn()}
      onShowShortcuts={onShowShortcuts}
      updateCheckDisabledBy={updateCheckDisabledBy}
    />,
  );
}

describe('AboutPanel', () => {
  it('shows the tagline under the logo', () => {
    renderPanel();
    expect(screen.getByText(tagline)).toBeInTheDocument();
  });

  it('shows the package version beside the logo on a release build', () => {
    vi.stubEnv('VITE_GAVEL_RELEASE_BUILD', 'true');
    renderPanel();
    expect(screen.getByText(`v${version}`)).toBeInTheDocument();
  });

  it('shows a development build and its short commit beside the logo', () => {
    vi.stubEnv('VITE_GAVEL_RELEASE_BUILD', undefined);
    vi.stubEnv('VITE_GAVEL_BUILD_COMMIT', '0123456789abcdef0123456789abcdef01234567');
    renderPanel();
    expect(screen.getByText('dev 0123456')).toBeInTheDocument();
  });

  it('shows a development build without a recorded commit as dev', () => {
    vi.stubEnv('VITE_GAVEL_RELEASE_BUILD', undefined);
    vi.stubEnv('VITE_GAVEL_BUILD_COMMIT', undefined);
    renderPanel();
    expect(screen.getByText('dev')).toBeInTheDocument();
  });

  it('asks npm for the latest release', () => {
    vi.stubEnv('VITE_GAVEL_RELEASE_BUILD', 'true');
    npmLatest(version);
    renderPanel();
    expect(global.fetch).toHaveBeenCalledWith(latestUrl, expect.anything());
  });

  it('says a release build is up to date when npm has no newer version', async () => {
    vi.stubEnv('VITE_GAVEL_RELEASE_BUILD', 'true');
    npmLatest(version);
    renderPanel();
    expect(await screen.findByText('Up to date')).toBeInTheDocument();
  });

  it('offers the upgrade commands when npm has a newer version', async () => {
    vi.stubEnv('VITE_GAVEL_RELEASE_BUILD', 'true');
    // 10.0.0 sorts before 6.0.0 as text, so this also checks the comparison is numeric.
    npmLatest('10.0.0');
    renderPanel();
    expect(await screen.findByText('Version 10.0.0 is available')).toBeInTheDocument();
    expect(screen.getByText('npm install -g @photostructure/gavel@latest')).toBeInTheDocument();
    expect(screen.getByText('npx @photostructure/gavel@latest')).toBeInTheDocument();
  });

  it('says when it could not reach npm', async () => {
    vi.stubEnv('VITE_GAVEL_RELEASE_BUILD', 'true');
    vi.mocked(global.fetch).mockRejectedValue(new TypeError('Failed to fetch'));
    renderPanel();
    expect(
      await screen.findByText("Couldn't check npm for the latest release"),
    ).toBeInTheDocument();
  });

  it('says when npm answered with an error', async () => {
    vi.stubEnv('VITE_GAVEL_RELEASE_BUILD', 'true');
    vi.mocked(global.fetch).mockResolvedValue(new Response('', { status: 503 }));
    renderPanel();
    expect(
      await screen.findByText("Couldn't check npm for the latest release"),
    ).toBeInTheDocument();
  });

  it('says when npm answered with a version it cannot compare', async () => {
    vi.stubEnv('VITE_GAVEL_RELEASE_BUILD', 'true');
    npmLatest('latest');
    renderPanel();
    expect(
      await screen.findByText("Couldn't check npm for the latest release"),
    ).toBeInTheDocument();
  });

  it('skips the npm check when the server names an opt-out', () => {
    vi.stubEnv('VITE_GAVEL_RELEASE_BUILD', 'true');
    renderPanel(vi.fn(), 'DO_NOT_TRACK');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.getByText('Update check off: DO_NOT_TRACK is set')).toBeInTheDocument();
  });

  it('skips the npm check when the browser sends Global Privacy Control', () => {
    vi.stubEnv('VITE_GAVEL_RELEASE_BUILD', 'true');
    Object.defineProperty(navigator, 'globalPrivacyControl', { value: true, configurable: true });
    renderPanel();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(
      screen.getByText('Update check off: your browser sends Global Privacy Control'),
    ).toBeInTheDocument();
  });

  it('checks npm when the browser turns Global Privacy Control off', () => {
    vi.stubEnv('VITE_GAVEL_RELEASE_BUILD', 'true');
    Object.defineProperty(navigator, 'globalPrivacyControl', { value: false, configurable: true });
    npmLatest(version);
    renderPanel();
    expect(global.fetch).toHaveBeenCalledWith(latestUrl, expect.anything());
  });

  it('neither asks npm nor shows a release status on a development build', () => {
    vi.stubEnv('VITE_GAVEL_RELEASE_BUILD', undefined);
    npmLatest('10.0.0');
    renderPanel();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.queryByText(/npm|Up to date|is available|Update check/)).toBeNull();
  });

  it('names the release a development build is based on under Build', () => {
    vi.stubEnv('VITE_GAVEL_RELEASE_BUILD', undefined);
    vi.stubEnv('VITE_GAVEL_BUILD_COMMIT', undefined);
    renderPanel();
    const build = screen.getByRole('region', { name: 'Gavel build' });
    expect(within(build).getByText('Based on release')).toBeInTheDocument();
    expect(within(build).getByText(version)).toBeInTheDocument();
  });

  it('omits the Build section on a release build', () => {
    vi.stubEnv('VITE_GAVEL_RELEASE_BUILD', 'true');
    npmLatest(version);
    renderPanel();
    expect(screen.queryByRole('region', { name: 'Gavel build' })).toBeNull();
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
    expect(within(links).getAllByRole('listitem')).toHaveLength(4);
    const details = screen.getByRole('region', { name: 'Review context' });
    expect(links.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('links to the introduction on photostructure.com', () => {
    renderPanel();
    const link = screen.getByRole('link', { name: /How gavel works/ });
    expect(link).toHaveAttribute('href', 'https://photostructure.com/coding/gavel/');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('links to the changelog', () => {
    renderPanel();
    const link = screen.getByRole('link', { name: /What's new/ });
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/photostructure/gavel/blob/main/CHANGELOG.md',
    );
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
