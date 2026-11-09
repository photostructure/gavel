/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GAVEL_API_URL?: string;
  readonly VITE_GAVEL_RELEASE_BUILD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
