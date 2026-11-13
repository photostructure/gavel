import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';

import type { CommentThread, DiffCommentMessage, DiffFile } from '../../types/diff';
import { agentMessageRevision, type AgentUpdate } from '../hooks/useAgentUpdates';

import { FileList } from './FileList';

const createFile = (
  path: string,
  totals: { additions?: number; deletions?: number } = {},
): DiffFile => ({
  path,
  status: 'modified',
  additions: totals.additions ?? 1,
  deletions: totals.deletions ?? 1,
  chunks: [],
});

function getTreeRow(title: string): HTMLElement {
  const row = screen.getByTitle(title).closest<HTMLElement>('[data-tree-row="true"]');
  expect(row).not.toBeNull();
  return row as HTMLElement;
}

function getLabel(title: string): HTMLElement {
  return screen.getByTitle(title);
}

describe('FileList', () => {
  it.each([
    { status: 'renamed', icon: '.lucide-file-pen' },
    { status: 'copied', icon: '.lucide-files' },
  ] as const)('marks a $status file with its icon', ({ status, icon }) => {
    const { container } = render(
      <FileList
        files={[{ ...createFile('README.md'), status, oldPath: 'old.md' }]}
        onScrollToFile={vi.fn()}
        comments={[]}
        unreadUpdates={[]}
        reviewedFiles={new Set()}
        onToggleReviewed={vi.fn()}
        onToggleFolderReviewed={vi.fn()}
        selectedFilePath={null}
      />,
    );

    expect(container.querySelector(icon)).toBeInTheDocument();
  });

  it('renders total additions and deletions beside the file count', () => {
    render(
      <FileList
        files={[
          createFile('README.md', { additions: 3, deletions: 1 }),
          createFile('src/client/App.tsx', { additions: 2, deletions: 4 }),
        ]}
        onScrollToFile={vi.fn()}
        comments={[]}
        unreadUpdates={[]}
        reviewedFiles={new Set()}
        onToggleReviewed={vi.fn()}
        onToggleFolderReviewed={vi.fn()}
        selectedFilePath={null}
      />,
    );

    expect(screen.getByText('Files changed (2)')).toBeInTheDocument();
    expect(screen.getByLabelText('5 additions and 5 deletions')).toBeInTheDocument();
    expect(screen.getByText('+5')).toBeInTheDocument();
    expect(screen.getByText('-5')).toBeInTheDocument();
  });

  it('lists the change summary first and jumps to it', () => {
    const onScrollToSummary = vi.fn();
    const onFileSelected = vi.fn();
    render(
      <FileList
        files={[createFile('README.md')]}
        onScrollToFile={vi.fn()}
        onScrollToSummary={onScrollToSummary}
        onFileSelected={onFileSelected}
        comments={[]}
        unreadUpdates={[]}
        reviewedFiles={new Set()}
        onToggleReviewed={vi.fn()}
        onToggleFolderReviewed={vi.fn()}
        selectedFilePath={null}
      />,
    );
    const summary = screen.getByRole('button', { name: 'Change summary' });
    expect(summary.querySelector('svg.lucide-file-question-mark')).not.toBeNull();
    // Above the files, like the section it jumps to.
    expect(
      summary.compareDocumentPosition(getLabel('README.md')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(summary);
    expect(onScrollToSummary).toHaveBeenCalledOnce();
    // On phones this closes the file list, as picking a file does.
    expect(onFileSelected).toHaveBeenCalledOnce();
  });

  it('highlights the change summary row like a selected file', () => {
    const props = {
      files: [createFile('README.md')],
      onScrollToFile: vi.fn(),
      onScrollToSummary: vi.fn(),
      comments: [],
      unreadUpdates: [],
      reviewedFiles: new Set<string>(),
      onToggleReviewed: vi.fn(),
      onToggleFolderReviewed: vi.fn(),
      selectedFilePath: null,
    };
    const { rerender } = render(<FileList {...props} summarySelected={false} />);
    const summary = screen.getByRole('button', { name: 'Change summary' });
    expect(summary).not.toHaveClass('file-tree-row-selected');

    rerender(<FileList {...props} summarySelected />);

    expect(summary).toHaveClass('file-tree-row-selected');
  });

  it('strikes through directories when all descendant files are reviewed', () => {
    const files = [
      createFile('src/cli/index.ts'),
      createFile('src/client/App.tsx'),
      createFile('README.md'),
    ];
    const props = {
      files,
      onScrollToFile: vi.fn(),
      comments: [],
      unreadUpdates: [],
      onToggleReviewed: vi.fn(),
      onToggleFolderReviewed: vi.fn(),
      selectedFilePath: null,
    };
    const { rerender } = render(
      <FileList {...props} reviewedFiles={new Set(['README.md', 'src/cli/index.ts'])} />,
    );

    expect(getLabel('src')).not.toHaveClass('line-through');
    expect(getTreeRow('src')).not.toHaveClass('opacity-70');
    expect(getLabel('cli')).toHaveClass('line-through');
    expect(getTreeRow('cli')).toHaveClass('opacity-70');
    expect(getLabel('client')).not.toHaveClass('line-through');
    expect(getTreeRow('client')).not.toHaveClass('opacity-70');

    rerender(
      <FileList
        {...props}
        reviewedFiles={new Set(['README.md', 'src/cli/index.ts', 'src/client/App.tsx'])}
      />,
    );

    expect(getLabel('src')).toHaveClass('line-through');
    expect(getTreeRow('src')).toHaveClass('opacity-70');
    expect(getLabel('cli')).toHaveClass('line-through');
    expect(getTreeRow('cli')).toHaveClass('opacity-70');
    expect(getLabel('client')).toHaveClass('line-through');
    expect(getTreeRow('client')).toHaveClass('opacity-70');
  });

  it('marks all files in a folder as reviewed via the directory checkbox', () => {
    const onToggleFolderReviewed = vi.fn();
    render(
      <FileList
        files={[
          createFile('src/cli/index.ts'),
          createFile('src/client/App.tsx'),
          createFile('README.md'),
        ]}
        onScrollToFile={vi.fn()}
        comments={[]}
        unreadUpdates={[]}
        reviewedFiles={new Set()}
        onToggleReviewed={vi.fn()}
        onToggleFolderReviewed={onToggleFolderReviewed}
        selectedFilePath={null}
      />,
    );

    const checkbox = within(getTreeRow('src')).getByRole('checkbox');
    expect(checkbox).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(checkbox);
    expect(onToggleFolderReviewed).toHaveBeenCalledWith('src', true);
  });

  it('renders both a file row and directory children when a path is both a file and a directory prefix', () => {
    const onScrollToFile = vi.fn();
    render(
      <FileList
        files={[
          { ...createFile('vendor'), status: 'deleted' },
          createFile('vendor/lib.ts'),
          createFile('vendor/utils.ts'),
        ]}
        onScrollToFile={onScrollToFile}
        comments={[]}
        unreadUpdates={[]}
        reviewedFiles={new Set()}
        onToggleReviewed={vi.fn()}
        onToggleFolderReviewed={vi.fn()}
        selectedFilePath={null}
      />,
    );

    expect(screen.getByTitle('vendor/lib.ts')).toBeInTheDocument();
    expect(screen.getByTitle('vendor/utils.ts')).toBeInTheDocument();

    const vendorElements = screen.getAllByTitle('vendor');
    const vendorFileRow = vendorElements
      .map((el) => el.closest('[data-file-row="true"]'))
      .find(Boolean);
    expect(vendorFileRow).toBeDefined();
    fireEvent.click(vendorFileRow!);
    expect(onScrollToFile).toHaveBeenCalledWith('vendor');
  });

  it('unmarks all files in a fully reviewed folder via the directory checkbox', () => {
    const onToggleFolderReviewed = vi.fn();
    render(
      <FileList
        files={[createFile('src/cli/index.ts'), createFile('src/client/App.tsx')]}
        onScrollToFile={vi.fn()}
        comments={[]}
        unreadUpdates={[]}
        reviewedFiles={new Set(['src/cli/index.ts', 'src/client/App.tsx'])}
        onToggleReviewed={vi.fn()}
        onToggleFolderReviewed={onToggleFolderReviewed}
        selectedFilePath={null}
      />,
    );

    const checkbox = within(getTreeRow('src')).getByRole('checkbox');
    expect(checkbox).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(checkbox);
    expect(onToggleFolderReviewed).toHaveBeenCalledWith('src', false);
  });
});

it('makes the comment count a separate action and preserves mobile file selection', () => {
  const onScrollToFile = vi.fn();
  const onScrollToFirstComment = vi.fn();
  const onFileSelected = vi.fn();
  render(
    <FileList
      files={[createFile('test.ts')]}
      comments={[
        {
          id: 'thread',
          file: 'test.ts',
          line: 10,
          createdAt: '2026-11-02',
          updatedAt: '2026-11-02',
          messages: [],
        },
      ]}
      unreadUpdates={[]}
      onScrollToFile={onScrollToFile}
      onScrollToFirstComment={onScrollToFirstComment}
      onFileSelected={onFileSelected}
      reviewedFiles={new Set()}
      onToggleReviewed={vi.fn()}
      onToggleFolderReviewed={vi.fn()}
      selectedFilePath={null}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Jump to first comment in test.ts' }));
  expect(onScrollToFirstComment).toHaveBeenCalledWith('test.ts');
  expect(onScrollToFile).not.toHaveBeenCalled();
  expect(onFileSelected).toHaveBeenCalledOnce();
});

it('puts an unread dot on the comment button of files with unread agent replies', () => {
  const thread = (id: string, file: string): CommentThread => ({
    id,
    file,
    line: 1,
    createdAt: '2026-11-10',
    updatedAt: '2026-11-10',
    messages: [],
  });
  const reply = (id: string): DiffCommentMessage => ({
    id,
    origin: 'agent',
    body: 'Done.',
    createdAt: '2026-11-10',
    updatedAt: '2026-11-10',
  });
  const unreadThread = thread('unread', 'unread.ts');
  // App's unread list also holds other reviews' threads; one on read.ts must not mark this review's read.ts.
  const otherReviewThread = thread('other-review', 'read.ts');
  const update = (message: DiffCommentMessage, owner = unreadThread): AgentUpdate => ({
    key: JSON.stringify([owner.id, message.id]),
    thread: owner,
    message,
    revision: agentMessageRevision(message),
  });
  render(
    <FileList
      files={[createFile('unread.ts'), createFile('read.ts')]}
      comments={[unreadThread, thread('read', 'read.ts')]}
      unreadUpdates={[
        update(reply('one')),
        update(reply('two')),
        update(reply('three'), otherReviewThread),
      ]}
      onScrollToFile={vi.fn()}
      reviewedFiles={new Set()}
      onToggleReviewed={vi.fn()}
      onToggleFolderReviewed={vi.fn()}
      selectedFilePath={null}
    />,
  );

  const unreadButton = screen.getByRole('button', {
    name: 'Jump to first comment in unread.ts, 2 unread agent messages',
  });
  const dot = unreadButton.querySelector('svg > circle');
  expect(dot).toHaveClass('fill-blue-500', 'dark:fill-blue-400');
  const maskUrl = unreadButton.querySelector('path')?.getAttribute('mask');
  const maskId = unreadButton.querySelector('mask')?.id;
  expect(maskUrl).toBe(`url(#${maskId})`);

  const readButton = screen.getByRole('button', { name: 'Jump to first comment in read.ts' });
  expect(readButton.querySelector('circle')).toBeNull();
});
