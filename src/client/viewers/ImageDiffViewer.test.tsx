import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { DiffFile } from '../../types/diff';

import { ImageDiffViewer } from './ImageDiffViewer';
import type { DiffViewerBodyProps } from './types';

describe('ImageDiffViewer', () => {
  const baseProps: Omit<DiffViewerBodyProps, 'file'> = {
    threads: [],
    diffMode: 'unified',
    mergedChunks: [],
    isExpandLoading: false,
    expandHiddenLines: vi.fn().mockResolvedValue(undefined),
    expandAllBetweenChunks: vi.fn().mockResolvedValue(undefined),
    onAddComment: vi.fn().mockResolvedValue(undefined),
    onGenerateThreadPrompt: vi.fn(),
    onToggleThreadResolved: vi.fn(),
    onReplyToThread: vi.fn().mockResolvedValue(undefined),
    onRemoveMessage: vi.fn(),
    onUpdateMessage: vi.fn(),
  };

  const renderViewer = (file: DiffFile, overrides: Partial<DiffViewerBodyProps> = {}) =>
    render(<ImageDiffViewer {...baseProps} file={file} {...overrides} />);

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock fetch to return a blob with size
    (global.fetch as any).mockResolvedValue({
      blob: () => Promise.resolve({ size: 1024 }),
    });
  });

  describe('File status handling', () => {
    it('renders deleted image correctly', () => {
      const deletedFile: DiffFile = {
        path: 'test.jpg',
        oldPath: 'test.jpg',
        status: 'deleted',
        additions: 0,
        deletions: 1,
        chunks: [],
      };

      renderViewer(deletedFile);

      expect(screen.getByText('Deleted Image')).toBeInTheDocument();
      expect(screen.getByText('Previous version:')).toBeInTheDocument();
      expect(screen.getByRole('img')).toHaveAttribute('src', '/api/blob/test.jpg?ref=HEAD~1');
    });

    it('renders added image correctly', () => {
      const addedFile: DiffFile = {
        path: 'test.jpg',
        status: 'added',
        additions: 1,
        deletions: 0,
        chunks: [],
      };

      renderViewer(addedFile);

      expect(screen.getByText('Added Image')).toHaveClass('text-github-accent-text');
      expect(screen.getByText('New file:')).toBeInTheDocument();
      expect(screen.getByRole('img')).toHaveAttribute('src', '/api/blob/test.jpg?ref=HEAD');
    });

    it('renders modified image correctly in split mode', () => {
      const modifiedFile: DiffFile = {
        path: 'test.jpg',
        oldPath: 'test.jpg',
        status: 'modified',
        additions: 1,
        deletions: 1,
        chunks: [],
      };

      renderViewer(modifiedFile, { diffMode: 'split' });

      expect(screen.getByText('Modified Image')).toBeInTheDocument();
      expect(screen.getByText('Previous version:')).toBeInTheDocument();
      expect(screen.getByText('Current version:')).toBeInTheDocument();

      const images = screen.getAllByRole('img');
      expect(images).toHaveLength(2);
    });

    it('handles renamed image correctly', () => {
      const renamedFile: DiffFile = {
        path: 'new-name.jpg',
        oldPath: 'old-name.jpg',
        status: 'renamed',
        additions: 0,
        deletions: 0,
        chunks: [],
      };

      renderViewer(renamedFile);

      expect(screen.getByText('Modified Image')).toBeInTheDocument();

      const images = screen.getAllByRole('img');
      expect(images[0]).toHaveAttribute('src', '/api/blob/old-name.jpg?ref=HEAD~1');
      expect(images[1]).toHaveAttribute('src', '/api/blob/new-name.jpg?ref=HEAD');
    });

    it('renders a copied image with both versions', () => {
      const copiedFile: DiffFile = {
        path: 'copy.jpg',
        oldPath: 'source.jpg',
        status: 'copied',
        additions: 0,
        deletions: 0,
        chunks: [],
      };

      renderViewer(copiedFile);

      expect(screen.getByText('Modified Image')).toBeInTheDocument();

      const images = screen.getAllByRole('img');
      expect(images[0]).toHaveAttribute('src', '/api/blob/source.jpg?ref=HEAD~1');
      expect(images[1]).toHaveAttribute('src', '/api/blob/copy.jpg?ref=HEAD');
    });
  });

  describe('Image loading with custom refs', () => {
    it('sets correct image src URLs with custom commitish', () => {
      const file: DiffFile = {
        path: 'test.jpg',
        oldPath: 'old-test.jpg',
        status: 'modified',
        additions: 1,
        deletions: 1,
        chunks: [],
      };

      renderViewer(file, { baseCommitish: 'main', targetCommitish: 'feature' });

      const images = screen.getAllByRole('img');
      expect(images[0]).toHaveAttribute('src', '/api/blob/old-test.jpg?ref=main');
      expect(images[1]).toHaveAttribute('src', '/api/blob/test.jpg?ref=feature');
    });

    it('uses default refs when not provided', () => {
      const file: DiffFile = {
        path: 'test.jpg',
        oldPath: 'old-test.jpg',
        status: 'modified',
        additions: 1,
        deletions: 1,
        chunks: [],
      };

      renderViewer(file);

      const images = screen.getAllByRole('img');
      expect(images[0]).toHaveAttribute('src', '/api/blob/old-test.jpg?ref=HEAD~1');
      expect(images[1]).toHaveAttribute('src', '/api/blob/test.jpg?ref=HEAD');
    });
  });

  describe('Named reviews', () => {
    it("requests each side from the review's capture", () => {
      const file: DiffFile = {
        path: 'new name.webp',
        oldPath: 'old name.webp',
        status: 'renamed',
        additions: 0,
        deletions: 0,
        chunks: [],
      };

      renderViewer(file, { capture: { name: 'a task', version: 3 } });

      const images = screen.getAllByRole('img');
      expect(images[0]).toHaveAttribute(
        'src',
        '/api/blob/old%20name.webp?review=a%20task&version=3&side=old',
      );
      expect(images[1]).toHaveAttribute(
        'src',
        '/api/blob/new%20name.webp?review=a%20task&version=3&side=new',
      );
    });
  });

  it('loads the new capture after a failed load when the review updates', () => {
    const file: DiffFile = {
      path: 'demo.webm',
      status: 'added',
      additions: 0,
      deletions: 0,
      chunks: [],
    };
    const { container, rerender } = renderViewer(file, { capture: { name: 'task', version: 1 } });
    fireEvent.error(container.querySelector('video')!);
    expect(screen.getByText('Video could not be loaded')).toBeInTheDocument();

    rerender(<ImageDiffViewer {...baseProps} file={file} capture={{ name: 'task', version: 2 }} />);

    expect(container.querySelector('video')).toHaveAttribute(
      'src',
      '/api/blob/demo.webm?review=task&version=2&side=new',
    );
  });

  describe('Video files', () => {
    it('plays both versions of a modified WebM video and shows its size', async () => {
      const file: DiffFile = {
        path: 'demo.webm',
        status: 'modified',
        additions: 0,
        deletions: 0,
        chunks: [],
      };

      const { container } = renderViewer(file, { diffMode: 'split' });

      expect(screen.getByText('Modified Video')).toBeInTheDocument();
      expect(screen.queryByRole('img')).toBeNull();
      const videos = [...container.querySelectorAll('video')];
      expect(videos.map((video) => video.getAttribute('src'))).toEqual([
        '/api/blob/demo.webm?ref=HEAD~1',
        '/api/blob/demo.webm?ref=HEAD',
      ]);
      expect(videos.every((video) => video.controls)).toBe(true);

      const video = videos[1]!;
      Object.defineProperty(video, 'videoWidth', { value: 1280, configurable: true });
      Object.defineProperty(video, 'videoHeight', { value: 720, configurable: true });
      video.dispatchEvent(new Event('loadedmetadata'));

      await waitFor(() => {
        expect(screen.getByText(/W: 1280px \| H: 720px/)).toBeInTheDocument();
      });
    });
  });

  describe('Image information display', () => {
    it('shows image dimensions and file size when available', async () => {
      const file: DiffFile = {
        path: 'test.jpg',
        status: 'added',
        additions: 1,
        deletions: 0,
        chunks: [],
      };

      renderViewer(file);

      const image = screen.getByRole('img');

      // Mock naturalWidth and naturalHeight
      Object.defineProperty(image, 'naturalWidth', { value: 800, configurable: true });
      Object.defineProperty(image, 'naturalHeight', { value: 600, configurable: true });

      // Simulate image load
      const loadEvent = new Event('load');
      image.dispatchEvent(loadEvent);

      // Wait for the state to update and info to be displayed
      await waitFor(() => {
        expect(screen.getByText(/W: 800px \| H: 600px/)).toBeInTheDocument();
        expect(screen.getByText(/1\.0 KB/)).toBeInTheDocument();
      });
    });
  });
});
