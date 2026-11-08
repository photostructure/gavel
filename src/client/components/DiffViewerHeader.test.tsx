import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';

import type { DiffFile } from '../../types/diff';

import { DiffViewerHeader } from './DiffViewerHeader';

const file: DiffFile = {
  path: 'src/app.ts',
  status: 'modified',
  additions: 1,
  deletions: 1,
  chunks: [],
};

const baseProps = {
  file,
  isCollapsed: false,
  isReviewed: false,
  onToggleCollapsed: vi.fn(),
  onToggleAllCollapsed: vi.fn(),
  onToggleReviewed: vi.fn(),
};

describe('DiffViewerHeader', () => {
  it.each([
    { status: 'renamed', label: 'Renamed from', icon: '.lucide-file-pen' },
    { status: 'copied', label: 'Copied from', icon: '.lucide-files' },
  ] as const)('labels and marks a file $status', ({ status, label, icon }) => {
    const { container } = render(
      <DiffViewerHeader {...baseProps} file={{ ...file, status, oldPath: 'src/old.ts' }} />,
    );

    expect(screen.getByText(label)).toHaveTextContent(`${label} src/old.ts`);
    expect(container.querySelector(icon)).toBeInTheDocument();
  });

  it('notes a path that is not valid UTF-8', () => {
    render(
      <DiffViewerHeader
        {...baseProps}
        file={{ ...file, path: '"caf\\351.txt"', hasNonUtf8Path: true }}
      />,
    );

    expect(screen.getByText(/not valid UTF-8/)).toBeInTheDocument();
  });

  it('words the note to hold when only the old name is not valid UTF-8', () => {
    render(
      <DiffViewerHeader
        {...baseProps}
        file={{
          ...file,
          status: 'renamed',
          path: 'renamed.txt',
          oldPath: '"caf\\351.txt"',
          hasNonUtf8Path: true,
        }}
      />,
    );

    expect(screen.getByText(/A name in this change is not valid UTF-8/)).toBeInTheDocument();
  });

  it('shows no path note for an ordinary file', () => {
    render(<DiffViewerHeader {...baseProps} />);

    expect(screen.queryByText(/not valid UTF-8/)).not.toBeInTheDocument();
  });

  it('shows the "Updated" badge when the file changed since last viewed', () => {
    render(<DiffViewerHeader {...baseProps} isChangedSinceViewed />);

    const badge = screen.getByLabelText('Updated since you last viewed this file');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('Updated');
    expect(badge).toHaveAttribute('title', 'Updated since you last viewed this file');
  });

  it('hides the "Updated" badge once the file is marked as reviewed', () => {
    render(<DiffViewerHeader {...baseProps} isChangedSinceViewed isReviewed />);

    expect(
      screen.queryByLabelText('Updated since you last viewed this file'),
    ).not.toBeInTheDocument();
  });

  it('hides the "Updated" badge when the file is unchanged since last viewed', () => {
    render(<DiffViewerHeader {...baseProps} isChangedSinceViewed={false} />);

    expect(
      screen.queryByLabelText('Updated since you last viewed this file'),
    ).not.toBeInTheDocument();
  });

  it('offers "Expand all lines" while lines are hidden', () => {
    const onToggle = vi.fn();
    render(<DiffViewerHeader {...baseProps} fullFileToggle={{ expanded: false, onToggle }} />);

    fireEvent.click(screen.getByLabelText('Expand all lines'));

    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('offers "Collapse expanded lines" once the whole file is shown', () => {
    render(
      <DiffViewerHeader {...baseProps} fullFileToggle={{ expanded: true, onToggle: vi.fn() }} />,
    );

    expect(screen.getByLabelText('Collapse expanded lines')).toBeInTheDocument();
  });

  it('shows no full-file toggle without one', () => {
    render(<DiffViewerHeader {...baseProps} />);

    expect(screen.queryByLabelText('Expand all lines')).not.toBeInTheDocument();
  });

  describe('clicking the header row', () => {
    const renderHeader = (isCollapsed: boolean, isReviewed = true) => {
      const handlers = {
        onToggleCollapsed: vi.fn(),
        onToggleAllCollapsed: vi.fn(),
        onToggleReviewed: vi.fn(),
      };
      const { container } = render(
        <DiffViewerHeader
          {...baseProps}
          {...handlers}
          isCollapsed={isCollapsed}
          isReviewed={isReviewed}
        />,
      );
      const row = container.querySelector('[data-diff-viewer-header="true"]');
      if (row === null) throw new Error('header row not rendered');
      return { ...handlers, row };
    };

    it('expands a collapsed file when the empty part of the row is clicked', () => {
      const { onToggleCollapsed, row } = renderHeader(true);

      fireEvent.click(row);

      expect(onToggleCollapsed).toHaveBeenCalledExactlyOnceWith(file.path);
    });

    it('expands a collapsed file when its path is clicked', () => {
      const { onToggleCollapsed } = renderHeader(true);

      fireEvent.click(screen.getByText(file.path));

      expect(onToggleCollapsed).toHaveBeenCalledExactlyOnceWith(file.path);
    });

    it('expands every file on Alt+click, like the chevron', () => {
      const { onToggleAllCollapsed, onToggleCollapsed, row } = renderHeader(true);

      fireEvent.click(row, { altKey: true });

      expect(onToggleAllCollapsed).toHaveBeenCalledExactlyOnceWith(false);
      expect(onToggleCollapsed).not.toHaveBeenCalled();
    });

    it('toggles once when the chevron itself is clicked', () => {
      const { onToggleCollapsed } = renderHeader(true);

      fireEvent.click(screen.getByRole('button', { name: /^Expand file/ }));

      expect(onToggleCollapsed).toHaveBeenCalledExactlyOnceWith(file.path);
    });

    it('leaves the file collapsed when "Viewed" is clicked', () => {
      const { onToggleCollapsed, onToggleReviewed } = renderHeader(true);

      fireEvent.click(screen.getByText('Viewed'));

      expect(onToggleReviewed).toHaveBeenCalledExactlyOnceWith(file.path);
      expect(onToggleCollapsed).not.toHaveBeenCalled();
    });

    it('collapses an expanded file', () => {
      const { onToggleCollapsed, row } = renderHeader(false);

      fireEvent.click(row);

      expect(onToggleCollapsed).toHaveBeenCalledExactlyOnceWith(file.path);
    });

    it('collapses every file on Alt+click of an expanded row', () => {
      const { onToggleAllCollapsed, onToggleCollapsed, row } = renderHeader(false);

      fireEvent.click(row, { altKey: true });

      expect(onToggleAllCollapsed).toHaveBeenCalledExactlyOnceWith(true);
      expect(onToggleCollapsed).not.toHaveBeenCalled();
    });

    it.each([true, false])(
      'toggles a file that is not marked viewed (collapsed: %s)',
      (collapsed) => {
        const { onToggleCollapsed, row } = renderHeader(collapsed, false);

        fireEvent.click(row);

        expect(onToggleCollapsed).toHaveBeenCalledExactlyOnceWith(file.path);
      },
    );

    it.each([
      [true, 'Expand file (Alt+Click to expand all)', 'false'],
      [false, 'Collapse file (Alt+Click to collapse all)', 'true'],
    ])('describes the toggle across the row (collapsed: %s)', (collapsed, title, expanded) => {
      const { row } = renderHeader(collapsed);

      expect(row).toHaveAttribute('title', title);
      expect(within(row as HTMLElement).getByRole('button', { name: title })).toHaveAttribute(
        'aria-expanded',
        expanded,
      );
    });

    it('leaves the file alone when the click ends a text selection', () => {
      const { onToggleCollapsed } = renderHeader(false);
      const path = screen.getByText(file.path);
      const selection = document.getSelection()!;
      const range = document.createRange();
      range.selectNodeContents(path);
      selection.addRange(range);

      try {
        fireEvent.click(path);
      } finally {
        selection.removeAllRanges();
      }

      expect(onToggleCollapsed).not.toHaveBeenCalled();
    });
  });
});
