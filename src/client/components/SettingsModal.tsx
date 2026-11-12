import { AlignLeft, Columns, Settings, X } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { useHotkeysContext } from 'react-hotkeys-hook';

import type { DiffViewMode } from '../../types/diff';
import { DEFAULT_DIFF_VIEW_MODE } from '../../utils/diffMode';
import type { ColorVisionMode } from '../utils/appearanceTheme';
import { formatAutoViewedPatterns, parseAutoViewedPatterns } from '../utils/autoViewedPatterns';
import {
  getFallbackSyntaxTheme,
  getThemesForResolvedTheme,
  isSyntaxThemeForResolvedTheme,
} from '../utils/themeLoader';
import { Checkbox } from './Checkbox';
import { Tooltip } from './Tooltip';

const APPROVAL_ANIMATIONS = [
  { id: 'confetti', label: 'Confetti' },
  { id: 'streamers', label: 'Streamers' },
  { id: 'sparkles', label: 'Sparkles' },
  { id: 'fireworks', label: 'Fireworks' },
  { id: 'stamp', label: 'Approved Stamp' },
  { id: 'lasers', label: 'Lasers' },
  { id: 'disco', label: 'Disco Ball' },
  { id: 'balloons', label: 'Balloons' },
] as const;

type ApprovalAnimation = (typeof APPROVAL_ANIMATIONS)[number]['id'];

interface AppearanceSettings {
  fontSize: number;
  fontFamily: string;
  theme: 'light' | 'dark' | 'auto';
  syntaxTheme: string;
  colorVision: ColorVisionMode;
  /** Which bursts the Approve button may fire; each approval picks one at random. */
  approvalAnimations: Record<ApprovalAnimation, boolean>;
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppearanceSettings;
  onSettingsChange: (settings: AppearanceSettings) => void;
  // Saved on the server, not with the per-browser appearance settings.
  autoViewedPatterns: string[];
  onAutoViewedPatternsChange: (patterns: string[]) => void;
  diffMode: DiffViewMode;
  onDiffModeChange: (mode: DiffViewMode) => void;
  // Phones show only unified diffs.
  splitAvailable: boolean;
  ignoreWhitespace: boolean;
  onIgnoreWhitespaceChange: (ignore: boolean) => void;
}

type SettingsSection = 'appearance' | 'system';

export const DEFAULT_IGNORE_WHITESPACE = true;

export const DEFAULT_SETTINGS: AppearanceSettings = {
  fontSize: 14,
  fontFamily: '"JetBrains Mono", monospace',
  theme: 'dark',
  syntaxTheme: 'vsDark',
  colorVision: 'normal',
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
};

// The named fonts are bundled (see styles/fonts.ts), so they render the same on every
// machine. Browser default is the font set as monospace in the browser's settings.
export const FONT_FAMILIES = [
  { name: 'JetBrains Mono', value: '"JetBrains Mono", monospace' },
  { name: 'IBM Plex Mono', value: '"IBM Plex Mono", monospace' },
  { name: 'Ubuntu Mono', value: '"Ubuntu Mono", monospace' },
  { name: 'Browser default', value: 'monospace' },
];

const COLOR_VISION_MODES = [
  { id: 'normal', label: 'Normal' },
  {
    id: 'deuteranopia',
    label: 'Deuteranopia',
    tooltip: 'Deuteranopia mode uses blue/orange instead of green/red for diffs.',
  },
] as const;

const SETTINGS_SECTIONS = [
  {
    id: 'appearance',
    label: 'Appearance',
  },
  {
    id: 'system',
    label: 'System',
  },
] as const;

export function SettingsModal({
  isOpen,
  onClose,
  settings,
  onSettingsChange,
  autoViewedPatterns,
  onAutoViewedPatternsChange,
  diffMode,
  onDiffModeChange,
  splitAvailable,
  ignoreWhitespace,
  onIgnoreWhitespaceChange,
}: SettingsModalProps) {
  const [autoViewedPatternsInput, setAutoViewedPatternsInput] = useState(
    formatAutoViewedPatterns(autoViewedPatterns),
  );
  const [activeSection, setActiveSection] = useState<SettingsSection>('appearance');
  const { enableScope, disableScope } = useHotkeysContext();

  // Like About and Conversation, Settings takes focus when it opens, so screen readers announce
  // it, and gives focus back when it closes.
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement;
    panel.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [isOpen]);

  // Manage scopes when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      // Disable navigation scope when settings modal is open
      disableScope('navigation');
    } else {
      // Re-enable navigation scope when modal closes
      enableScope('navigation');
    }

    return () => {
      // Cleanup: ensure navigation scope is enabled
      enableScope('navigation');
    };
  }, [isOpen, enableScope, disableScope]);

  // Get current theme (resolve 'auto' to actual theme)
  const getCurrentTheme = (): 'light' | 'dark' => {
    if (settings.theme === 'auto') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return settings.theme;
  };

  // Get available themes based on current background color
  const getAvailableThemes = () => {
    return getThemesForResolvedTheme(getCurrentTheme());
  };

  // Handle theme change and auto-select valid syntax theme
  const handleThemeChange = (theme: 'light' | 'dark' | 'auto') => {
    const newSettings = { ...settings, theme };

    // Determine the effective theme
    const effectiveTheme =
      theme === 'auto'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : theme;

    const isCurrentThemeValid = isSyntaxThemeForResolvedTheme(settings.syntaxTheme, effectiveTheme);

    // If current theme becomes invalid, auto-select first item
    if (!isCurrentThemeValid) {
      const firstTheme = getFallbackSyntaxTheme(effectiveTheme);
      if (firstTheme) {
        newSettings.syntaxTheme = firstTheme.id;
      }
    }

    onSettingsChange(newSettings);
  };

  const handleReset = () => {
    if (activeSection === 'appearance') {
      onSettingsChange({
        ...settings,
        fontSize: DEFAULT_SETTINGS.fontSize,
        fontFamily: DEFAULT_SETTINGS.fontFamily,
        theme: DEFAULT_SETTINGS.theme,
        syntaxTheme: DEFAULT_SETTINGS.syntaxTheme,
        colorVision: DEFAULT_SETTINGS.colorVision,
        approvalAnimations: DEFAULT_SETTINGS.approvalAnimations,
      });
      onDiffModeChange(DEFAULT_DIFF_VIEW_MODE);
      onIgnoreWhitespaceChange(DEFAULT_IGNORE_WHITESPACE);
      return;
    }

    onAutoViewedPatternsChange([]);
    setAutoViewedPatternsInput('');
  };

  const setAllApprovalAnimations = (enabled: boolean) => {
    onSettingsChange({
      ...settings,
      approvalAnimations: Object.fromEntries(
        APPROVAL_ANIMATIONS.map((animation) => [animation.id, enabled]),
      ) as Record<ApprovalAnimation, boolean>,
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none">
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-label="Settings"
        className="flex flex-col max-h-[calc(100dvh-2rem)] bg-github-bg-secondary border border-github-border rounded-lg w-full max-w-3xl mx-4 pointer-events-auto overflow-hidden"
      >
        <div className="shrink-0 flex items-center justify-between p-4 border-b border-github-border">
          <h2 className="text-lg ui-heading flex items-center gap-2">
            <Settings size={20} />
            Settings
          </h2>
          <button
            onClick={onClose}
            aria-label="Close settings"
            className="text-github-text-secondary hover:text-github-text-primary p-1"
          >
            <X size={18} />
          </button>
        </div>

        {/* Short windows shrink this pane and scroll it, keeping the header and footer in view. */}
        <div className="flex flex-col sm:flex-row min-h-[min(420px,calc(100dvh-10rem))]">
          <nav
            aria-label="Settings sections"
            className="sm:w-40 border-b sm:border-b-0 sm:border-r border-github-border px-3 py-2"
          >
            <div className="flex sm:flex-col gap-1">
              {SETTINGS_SECTIONS.map((section) => {
                const isActive = section.id === activeSection;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => setActiveSection(section.id)}
                    aria-pressed={isActive}
                    className={`flex-1 sm:flex-none text-left px-3 py-2 text-sm font-medium transition-colors border-b-2 sm:border-b-0 sm:border-l-2 ${
                      isActive
                        ? 'text-github-text-primary border-github-accent'
                        : 'text-github-text-secondary border-transparent hover:text-github-text-primary'
                    }`}
                  >
                    {section.label}
                  </button>
                );
              })}
            </div>
          </nav>

          <div className="flex-1 min-h-0 p-4 sm:p-6 overflow-y-auto">
            {activeSection === 'appearance' && (
              <div className="space-y-6">
                {splitAvailable && (
                  <div>
                    <span className="block text-sm ui-heading mb-2">Layout</span>
                    <div className="flex gap-2" role="group" aria-label="Diff layout">
                      {(['split', 'unified'] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          aria-pressed={diffMode === mode}
                          onClick={() => onDiffModeChange(mode)}
                          className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded border transition-colors ${
                            diffMode === mode
                              ? 'bg-github-accent text-white border-github-accent'
                              : 'bg-github-bg-tertiary text-github-text-secondary border-github-border hover:text-github-text-primary'
                          }`}
                        >
                          {mode === 'split' ? (
                            <Columns size={14} aria-hidden="true" />
                          ) : (
                            <AlignLeft size={14} aria-hidden="true" />
                          )}
                          {mode === 'split' ? 'Split' : 'Unified'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <Checkbox
                  checked={ignoreWhitespace}
                  onChange={onIgnoreWhitespaceChange}
                  label="Ignore Whitespace"
                />
                <div>
                  <label className="block text-sm ui-heading mb-2">Font Size</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min="9"
                      max="20"
                      step="1"
                      value={settings.fontSize}
                      onChange={(e) =>
                        onSettingsChange({
                          ...settings,
                          fontSize: Number.parseInt(e.target.value, 10),
                        })
                      }
                      className="flex-1 accent-github-accent"
                    />
                    <span className="text-sm ui-value w-8 text-right">{settings.fontSize}px</span>
                  </div>
                </div>

                <div>
                  <label className="block text-sm ui-heading mb-2">Font Family</label>
                  <select
                    value={settings.fontFamily}
                    onChange={(e) => onSettingsChange({ ...settings, fontFamily: e.target.value })}
                    className="w-full p-2 bg-github-bg-tertiary border border-github-border rounded text-github-text-primary text-sm"
                  >
                    {FONT_FAMILIES.map((font) => (
                      <option key={font.value} value={font.value}>
                        {font.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm ui-heading mb-2">Theme</label>
                  <div className="flex gap-2">
                    {(['light', 'dark', 'auto'] as const).map((theme) => (
                      <button
                        key={theme}
                        type="button"
                        onClick={() => handleThemeChange(theme)}
                        className={`px-3 py-2 text-sm rounded border transition-colors ${
                          settings.theme === theme
                            ? 'bg-github-accent text-white border-github-accent'
                            : 'bg-github-bg-tertiary text-github-text-secondary border-github-border hover:text-github-text-primary'
                        }`}
                      >
                        {theme.charAt(0).toUpperCase() + theme.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm ui-heading mb-2">Color Vision</label>
                  <div className="flex gap-2">
                    {COLOR_VISION_MODES.map((mode) => {
                      const isSelected = (settings.colorVision ?? 'normal') === mode.id;
                      const button = (
                        <button
                          key={mode.id}
                          type="button"
                          onClick={() => onSettingsChange({ ...settings, colorVision: mode.id })}
                          className={`px-3 py-2 text-sm rounded border transition-colors ${
                            isSelected
                              ? 'bg-github-accent text-white border-github-accent'
                              : 'bg-github-bg-tertiary text-github-text-secondary border-github-border hover:text-github-text-primary'
                          }`}
                        >
                          {mode.label}
                        </button>
                      );

                      if (!('tooltip' in mode)) {
                        return button;
                      }

                      return (
                        <Tooltip key={mode.id} content={mode.tooltip}>
                          {button}
                        </Tooltip>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-sm ui-heading mb-2">Syntax Highlighting Theme</label>
                  <select
                    value={settings.syntaxTheme}
                    onChange={(e) =>
                      onSettingsChange({
                        ...settings,
                        syntaxTheme: e.target.value,
                      })
                    }
                    className="w-full p-2 bg-github-bg-tertiary border border-github-border rounded text-github-text-primary text-sm"
                  >
                    {getAvailableThemes().map((theme) => (
                      <option key={theme.id} value={theme.id}>
                        {theme.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="flex items-baseline justify-between gap-4 mb-2">
                    <span className="text-sm ui-heading">Approval Celebration</span>
                    <span className="flex items-baseline gap-2 text-xs text-github-text-muted">
                      <button
                        type="button"
                        onClick={() => setAllApprovalAnimations(true)}
                        className="text-github-accent-text hover:underline"
                      >
                        Enable all
                      </button>
                      ·
                      <button
                        type="button"
                        onClick={() => setAllApprovalAnimations(false)}
                        className="text-github-accent-text hover:underline"
                      >
                        Disable all
                      </button>
                    </span>
                  </div>
                  <p className="text-sm text-github-text-secondary mb-2">
                    Approving a review plays one of the enabled animations at random, unless your
                    system is set to reduce motion. Turn them all off for none.
                  </p>
                  <div className="flex flex-wrap gap-4">
                    {APPROVAL_ANIMATIONS.map((animation) => (
                      <Checkbox
                        key={animation.id}
                        label={animation.label}
                        checked={settings.approvalAnimations[animation.id]}
                        onChange={(checked) =>
                          onSettingsChange({
                            ...settings,
                            approvalAnimations: {
                              ...settings.approvalAnimations,
                              [animation.id]: checked,
                            },
                          })
                        }
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeSection === 'system' && (
              <div className="space-y-6">
                <div>
                  <label htmlFor="auto-viewed-patterns" className="block text-sm ui-heading mb-2">
                    Auto-Mark Viewed Patterns
                  </label>
                  <p className="text-sm text-github-text-secondary mb-2">
                    Files matching these glob patterns are marked as Viewed automatically. Enter one
                    pattern per line.
                  </p>
                  <textarea
                    id="auto-viewed-patterns"
                    value={autoViewedPatternsInput}
                    onChange={(e) => {
                      setAutoViewedPatternsInput(e.target.value);
                      onAutoViewedPatternsChange(parseAutoViewedPatterns(e.target.value));
                    }}
                    rows={6}
                    spellCheck={false}
                    placeholder={'*.test.ts\n*.stories.tsx\nsrc/generated/**'}
                    className="w-full p-3 bg-github-bg-tertiary border border-github-border rounded text-github-text-primary text-sm font-mono"
                  />
                </div>

                <div>
                  <label className="block text-sm ui-heading mb-2">Open In Editor</label>
                  <p className="text-sm text-github-text-secondary">
                    Set GAVEL_EDITOR before starting gavel to choose an editor. If unset, gavel uses
                    EDITOR when it names a preset; otherwise it uses VS Code. For a custom editor,
                    set GAVEL_EDITOR=custom, GAVEL_EDITOR_COMMAND, and GAVEL_EDITOR_ARGS. Pass %file
                    or %file:%line as a separate argument. Open the full URL printed by gavel; its
                    fragment authorizes editor launches.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 flex items-center justify-between p-4 border-t border-github-border">
          <button
            onClick={handleReset}
            className="px-3 py-2 text-sm text-github-text-secondary hover:text-github-text-primary"
          >
            {activeSection === 'appearance' ? 'Reset Appearance Defaults' : 'Reset System Defaults'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm bg-github-accent text-white rounded hover:bg-green-600"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export type { AppearanceSettings, ApprovalAnimation };
