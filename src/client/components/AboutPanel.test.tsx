import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { version } from '../../../package.json';

import { AboutPanel } from './AboutPanel';

afterEach(() => {
  vi.unstubAllEnvs();
});

function renderPanel() {
  render(<AboutPanel onClose={vi.fn()} />);
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
});
