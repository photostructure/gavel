import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

import { readBuildInfo } from './dev/build-info.js';

const apiTarget = process.env.VITE_GAVEL_API_URL || 'http://localhost:4966';

// About shows which checkout a development build came from. The dev server
// skips this because its modules change after startup.
function buildInfoDefines(command: 'build' | 'serve') {
  if (command !== 'build' || process.env.VITE_GAVEL_RELEASE_BUILD === 'true') return {};
  const { commit, diffHash } = readBuildInfo(__dirname);
  return {
    'import.meta.env.VITE_GAVEL_BUILD_COMMIT': JSON.stringify(commit),
    'import.meta.env.VITE_GAVEL_BUILD_DIFF_HASH': JSON.stringify(diffHash ?? ''),
  };
}

export default defineConfig(({ command }) => ({
  plugins: [react()],
  root: 'src/client',
  publicDir: '../../public',
  define: buildInfoDefines(command),
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@/types': resolve(__dirname, 'src/types'),
    },
  },
  css: {
    postcss: './postcss.config.js',
  },
  server: {
    port: 5173,
    open: process.env.GAVEL_VITE_OPEN_PATH ?? false,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
}));
