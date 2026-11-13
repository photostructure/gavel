/**
 * Image file utilities
 */

import { getFileExtension } from '../../utils/fileUtils';

const IMAGE_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'gif',
  'bmp',
  'svg',
  'webp',
  'ico',
  'tiff',
  'tif',
  'avif',
  'heic',
  'heif',
];

const VIDEO_EXTENSIONS = ['webm'];

/**
 * Check if a file is an image based on its extension
 */
export function isImageFile(filename: string): boolean {
  if (!filename) return false;

  const extension = getFileExtension(filename);
  return extension ? IMAGE_EXTENSIONS.includes(extension) : false;
}

/** Check if a file is a video the image viewer plays, based on its extension */
export function isVideoFile(filename: string): boolean {
  const extension = getFileExtension(filename);
  return extension ? VIDEO_EXTENSIONS.includes(extension) : false;
}
