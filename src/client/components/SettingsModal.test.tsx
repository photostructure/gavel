import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { HotkeysProvider } from 'react-hotkeys-hook';
import { describe, expect, it, vi } from 'vitest';

import { SettingsModal } from './SettingsModal';

vi.mock('react-hotkeys-hook', () => ({
  useHotkeysContext: vi.fn(() => ({
    enableScope: vi.fn(),
    disableScope: vi.fn(),
  })),
  HotkeysProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <HotkeysProvider initiallyActiveScopes={['navigation']}>{children}</HotkeysProvider>
);

const baseSettings = {
  fontSize: 14,
  fontFamily: '"JetBrains Mono", monospace',
  theme: 'dark' as const,
  syntaxTheme: 'vsDark',
  colorVision: 'normal' as const,
  approvalAnimations: {
    confetti: true,
    streamers: true,
    sparkles: true,
    fireworks: true,
    stamp: true,
    lasers: true,
    disco: true,
    balloons: true,
  },
} satisfies React.ComponentProps<typeof SettingsModal>['settings'];

const diffProps = {
  diffMode: 'split',
  onDiffModeChange: vi.fn(),
  splitAvailable: true,
  ignoreWhitespace: true,
  onIgnoreWhitespaceChange: vi.fn(),
} satisfies Partial<React.ComponentProps<typeof SettingsModal>>;

describe('SettingsModal', () => {
  it('shows appearance settings by default and the editor note in the system section', () => {
    render(
      <SettingsModal
        isOpen={true}
        onClose={vi.fn()}
        settings={baseSettings}
        onSettingsChange={vi.fn()}
        autoViewedPatterns={[]}
        onAutoViewedPatternsChange={vi.fn()}
        {...diffProps}
      />,
      { wrapper },
    );

    expect(screen.getByText('Font Size')).toBeInTheDocument();
    expect(screen.queryByText('Scroll Animation')).not.toBeInTheDocument();
    expect(screen.queryByText('Open In Editor')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Theme, typography, and syntax highlighting.'),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText('Appearance')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^Appearance/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: /^System/ }));

    const autoViewedPatternsLabel = screen.getByText('Auto-Mark Viewed Patterns');
    const openInEditorLabel = screen.getByText('Open In Editor');
    expect(openInEditorLabel).toBeInTheDocument();
    expect(
      autoViewedPatternsLabel.compareDocumentPosition(openInEditorLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByText('Font Size')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^System/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('lets the font size go down to 9 px', () => {
    render(
      <SettingsModal
        isOpen={true}
        onClose={vi.fn()}
        settings={baseSettings}
        onSettingsChange={vi.fn()}
        autoViewedPatterns={[]}
        onAutoViewedPatternsChange={vi.fn()}
        {...diffProps}
      />,
      { wrapper },
    );
    expect(screen.getByRole('slider')).toHaveAttribute('min', '9');
  });

  it('offers the bundled fonts and the browser default font', () => {
    render(
      <SettingsModal
        isOpen={true}
        onClose={vi.fn()}
        settings={baseSettings}
        onSettingsChange={vi.fn()}
        autoViewedPatterns={[]}
        onAutoViewedPatternsChange={vi.fn()}
        {...diffProps}
      />,
      { wrapper },
    );

    for (const name of ['JetBrains Mono', 'IBM Plex Mono', 'Ubuntu Mono', 'Browser default']) {
      expect(screen.getByRole('option', { name })).toBeInTheDocument();
    }
    for (const name of ['System Font', 'Menlo', 'SF Mono', 'Fira Code']) {
      expect(screen.queryByRole('option', { name })).not.toBeInTheDocument();
    }
  });

  it('shows the deuteranopia explanation only while the button is hovered', async () => {
    render(
      <SettingsModal
        isOpen={true}
        onClose={vi.fn()}
        settings={baseSettings}
        onSettingsChange={vi.fn()}
        autoViewedPatterns={[]}
        onAutoViewedPatternsChange={vi.fn()}
        {...diffProps}
      />,
      { wrapper },
    );

    expect(
      screen.queryByText('Deuteranopia mode uses blue/orange instead of green/red for diffs.'),
    ).not.toBeInTheDocument();

    const deuteranopiaButton = screen.getByRole('button', { name: 'Deuteranopia' });
    fireEvent.mouseEnter(deuteranopiaButton);

    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent(
      'Deuteranopia mode uses blue/orange instead of green/red for diffs.',
    );
    expect(deuteranopiaButton).toHaveAttribute('aria-describedby', tooltip.id);

    fireEvent.mouseLeave(deuteranopiaButton);

    await waitFor(() => {
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
      expect(deuteranopiaButton).not.toHaveAttribute('aria-describedby');
    });
  });

  it('explains that the editor is configured on the server', () => {
    render(
      <SettingsModal
        isOpen={true}
        onClose={vi.fn()}
        settings={baseSettings}
        onSettingsChange={vi.fn()}
        autoViewedPatterns={[]}
        onAutoViewedPatternsChange={vi.fn()}
        {...diffProps}
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole('button', { name: /^System/ }));

    expect(screen.getByText(/Set GAVEL_EDITOR before starting gavel/)).toBeInTheDocument();
    expect(screen.getByText(/uses EDITOR when it names a preset/)).toBeInTheDocument();
    expect(screen.getByText(/full URL printed by gavel/)).toBeInTheDocument();
    expect(
      screen.getByText(/Pass %file or %file:%line as a separate argument/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Command')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Arguments')).not.toBeInTheDocument();
  });

  it('toggles each approval animation and resets them with the appearance defaults', () => {
    const onSettingsChange = vi.fn();
    const settings = {
      ...baseSettings,
      approvalAnimations: { ...baseSettings.approvalAnimations, streamers: false },
    };

    render(
      <SettingsModal
        isOpen={true}
        onClose={vi.fn()}
        settings={settings}
        onSettingsChange={onSettingsChange}
        autoViewedPatterns={[]}
        onAutoViewedPatternsChange={vi.fn()}
        {...diffProps}
      />,
      { wrapper },
    );

    expect(screen.getByRole('checkbox', { name: 'Confetti' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('checkbox', { name: 'Streamers' })).toHaveAttribute(
      'aria-checked',
      'false',
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Disco Ball' }));
    expect(onSettingsChange).toHaveBeenLastCalledWith({
      ...settings,
      approvalAnimations: { ...settings.approvalAnimations, disco: false },
    });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Streamers' }));
    expect(onSettingsChange).toHaveBeenLastCalledWith({
      ...settings,
      approvalAnimations: { ...settings.approvalAnimations, streamers: true },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Reset Appearance Defaults' }));
    expect(onSettingsChange).toHaveBeenLastCalledWith(baseSettings);
  });

  it('turns every approval animation on or off at once', () => {
    const onSettingsChange = vi.fn();
    const settings = {
      ...baseSettings,
      approvalAnimations: { ...baseSettings.approvalAnimations, confetti: false, disco: false },
    };

    render(
      <SettingsModal
        isOpen={true}
        onClose={vi.fn()}
        settings={settings}
        onSettingsChange={onSettingsChange}
        autoViewedPatterns={[]}
        onAutoViewedPatternsChange={vi.fn()}
        {...diffProps}
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Disable all' }));
    expect(onSettingsChange).toHaveBeenLastCalledWith({
      ...settings,
      approvalAnimations: {
        confetti: false,
        streamers: false,
        sparkles: false,
        fireworks: false,
        stamp: false,
        lasers: false,
        disco: false,
        balloons: false,
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Enable all' }));
    expect(onSettingsChange).toHaveBeenLastCalledWith({
      ...settings,
      approvalAnimations: baseSettings.approvalAnimations,
    });
  });

  it('edits auto-viewed patterns from the system section as newline-delimited values', () => {
    const onAutoViewedPatternsChange = vi.fn();

    render(
      <SettingsModal
        isOpen={true}
        onClose={vi.fn()}
        settings={baseSettings}
        onSettingsChange={vi.fn()}
        autoViewedPatterns={['*.snap']}
        onAutoViewedPatternsChange={onAutoViewedPatternsChange}
        {...diffProps}
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole('button', { name: /^System/ }));

    const textarea = screen.getByLabelText('Auto-Mark Viewed Patterns');
    expect(textarea).toHaveValue('*.snap');
    fireEvent.change(textarea, { target: { value: '*.test.ts\nsrc/generated/**' } });
    expect(onAutoViewedPatternsChange).toHaveBeenLastCalledWith(['*.test.ts', 'src/generated/**']);

    fireEvent.click(screen.getByRole('button', { name: 'Reset System Defaults' }));
    expect(onAutoViewedPatternsChange).toHaveBeenLastCalledWith([]);
    expect(textarea).toHaveValue('');
  });

  it('shows the diff layout and whitespace options first in Appearance and resets them with it', () => {
    const onDiffModeChange = vi.fn();
    const onIgnoreWhitespaceChange = vi.fn();
    render(
      <SettingsModal
        isOpen={true}
        onClose={vi.fn()}
        settings={baseSettings}
        onSettingsChange={vi.fn()}
        autoViewedPatterns={[]}
        onAutoViewedPatternsChange={vi.fn()}
        {...diffProps}
        diffMode="unified"
        ignoreWhitespace={false}
        onDiffModeChange={onDiffModeChange}
        onIgnoreWhitespaceChange={onIgnoreWhitespaceChange}
      />,
      { wrapper },
    );

    expect(screen.queryByRole('button', { name: /^Diff/ })).toBeNull();
    expect(
      screen.getByText('Layout').compareDocumentPosition(screen.getByText('Font Size')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(screen.getByRole('button', { name: 'Unified' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Split' })).toHaveAttribute('aria-pressed', 'false');
    const whitespace = screen.getByRole('checkbox', { name: 'Ignore Whitespace' });
    expect(whitespace).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Split' }));
    expect(onDiffModeChange).toHaveBeenLastCalledWith('split');
    fireEvent.click(whitespace);
    expect(onIgnoreWhitespaceChange).toHaveBeenLastCalledWith(true);

    onDiffModeChange.mockClear();
    onIgnoreWhitespaceChange.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Reset Appearance Defaults' }));
    expect(onDiffModeChange).toHaveBeenCalledWith('split');
    expect(onIgnoreWhitespaceChange).toHaveBeenCalledWith(true);
  });

  it('leaves out the split layout where only unified diffs fit', () => {
    render(
      <SettingsModal
        isOpen={true}
        onClose={vi.fn()}
        settings={baseSettings}
        onSettingsChange={vi.fn()}
        autoViewedPatterns={[]}
        onAutoViewedPatternsChange={vi.fn()}
        {...diffProps}
        splitAvailable={false}
      />,
      { wrapper },
    );

    expect(screen.queryByRole('button', { name: 'Split' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Unified' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Ignore Whitespace' })).toBeInTheDocument();
  });
});
