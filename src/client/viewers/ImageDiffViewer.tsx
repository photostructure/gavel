import { useState } from 'react';

import { DEFAULT_DIFF_VIEW_MODE } from '../../utils/diffMode';
import { isVideoFile } from '../utils/imageUtils';

import type { DiffViewerBodyProps } from './types';

interface MediaInfo {
  width?: number;
  height?: number;
  size?: number;
}

const formatFileSize = (bytes?: number): string => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDimensions = (info: MediaInfo): string => {
  if (!info.width || !info.height) return '';
  return `W: ${info.width}px | H: ${info.height}px`;
};

// Checkerboard background style for transparent images
const checkerboardStyle = {
  backgroundImage: `
    linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%),
    linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%)
  `,
  backgroundSize: '20px 20px',
  backgroundPosition: '0 0, 10px 10px',
  backgroundColor: 'white',
};

const mediaClassName = 'max-w-full max-h-96 border border-github-border rounded mx-auto';

interface MediaPanelProps {
  label: string;
  src: string;
  alt: string;
  isVideo: boolean;
  inline: boolean;
}

/**
 * One version of an image or video in a bordered box. A new `src`, such as a review update's,
 * starts a fresh panel, so an earlier load failure or size does not carry over.
 */
function MediaPanel(props: MediaPanelProps) {
  return <MediaPanelBody key={props.src} {...props} />;
}

/** The image or video with its dimensions and file size. */
function MediaPanelBody({ label, src, alt, isVideo, inline }: MediaPanelProps) {
  const [info, setInfo] = useState<MediaInfo>({});
  const [failed, setFailed] = useState(false);

  // The element reports dimensions; fetching the file again gives its size.
  const recordInfo = async (width: number, height: number) => {
    try {
      const response = await fetch(src);
      const blob = await response.blob();
      setInfo({ width, height, size: blob.size });
    } catch (error) {
      console.error('Failed to get media info:', error);
    }
  };

  return (
    <div
      className={`${inline ? 'inline-block ' : ''}border border-github-border rounded-md p-4 bg-github-bg-secondary`}
    >
      <div className="ui-heading mb-2" style={{ fontSize: '14px' }}>
        {label}
      </div>
      {failed ? (
        <div className="text-github-text-muted text-sm mt-2">
          {isVideo ? 'Video' : 'Image'} could not be loaded
        </div>
      ) : isVideo ? (
        <video
          src={src}
          aria-label={alt}
          controls
          preload="metadata"
          className={mediaClassName}
          onLoadedMetadata={(e) =>
            recordInfo(e.currentTarget.videoWidth, e.currentTarget.videoHeight)
          }
          onError={() => setFailed(true)}
        />
      ) : (
        <img
          src={src}
          alt={alt}
          className={mediaClassName}
          style={checkerboardStyle}
          onLoad={(e) => recordInfo(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
          onError={() => setFailed(true)}
        />
      )}
      {(info.width || info.size) && (
        <div className="text-github-text-muted mt-2" style={{ fontSize: '14px' }}>
          {formatDimensions(info)}
          {formatDimensions(info) && formatFileSize(info.size) && ' | '}
          {formatFileSize(info.size)}
        </div>
      )}
    </div>
  );
}

export function ImageDiffViewer({
  file,
  diffMode,
  baseCommitish,
  targetCommitish,
  capture,
}: DiffViewerBodyProps) {
  const mode = diffMode ?? DEFAULT_DIFF_VIEW_MODE;
  const isDeleted = file.status === 'deleted';
  const isAdded = file.status === 'added';
  const isModified =
    file.status === 'modified' || file.status === 'renamed' || file.status === 'copied';
  const isVideo = isVideoFile(file.path);
  const kind = isVideo ? 'Video' : 'Image';
  const oldPath = file.oldPath || file.path;

  // A named review shows its capture, so each side comes from the captured patch.
  const blobUrl = (path: string, side: 'old' | 'new'): string => {
    const query = capture
      ? `review=${encodeURIComponent(capture.name)}&version=${capture.version}&side=${side}`
      : `ref=${encodeURIComponent(side === 'old' ? baseCommitish || 'HEAD~1' : targetCommitish || 'HEAD')}`;
    return `/api/blob/${encodeURIComponent(path)}?${query}`;
  };

  // For deleted files, show only the old version
  if (isDeleted) {
    return (
      <div className="bg-github-bg-primary p-4">
        <div className="text-center">
          <div className="mb-2">
            <span className="text-github-danger font-semibold">Deleted {kind}</span>
          </div>
          <MediaPanel
            label="Previous version:"
            src={blobUrl(oldPath, 'old')}
            alt={`Previous version of ${oldPath}`}
            isVideo={isVideo}
            inline
          />
        </div>
      </div>
    );
  }

  // For added files, show only the new version
  if (isAdded) {
    return (
      <div className="bg-github-bg-primary p-4">
        <div className="text-center">
          <div className="mb-2">
            <span className="text-github-accent-text font-semibold">Added {kind}</span>
          </div>
          <MediaPanel
            label="New file:"
            src={blobUrl(file.path, 'new')}
            alt={`New ${kind.toLowerCase()} ${file.path}`}
            isVideo={isVideo}
            inline
          />
        </div>
      </div>
    );
  }

  if (!isModified) return null;

  // For modified/renamed files, show both versions: side by side in split mode, stacked otherwise
  const split = mode === 'split';
  return (
    <div className="bg-github-bg-primary p-4">
      <div className="text-center mb-4">
        <span className="ui-heading">Modified {kind}</span>
      </div>
      <div className={split ? 'grid grid-cols-2 gap-4' : 'space-y-6'}>
        <div className="text-center">
          <MediaPanel
            label="Previous version:"
            src={blobUrl(oldPath, 'old')}
            alt={`Previous version of ${oldPath}`}
            isVideo={isVideo}
            inline={!split}
          />
        </div>
        <div className="text-center">
          <MediaPanel
            label="Current version:"
            src={blobUrl(file.path, 'new')}
            alt={`Current version of ${file.path}`}
            isVideo={isVideo}
            inline={!split}
          />
        </div>
      </div>
    </div>
  );
}
