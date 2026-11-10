/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GAVEL_API_URL?: string;
  readonly VITE_GAVEL_RELEASE_BUILD?: string;
  /** HEAD when `vite build` made a development build; unset on release builds and the dev server. */
  readonly VITE_GAVEL_BUILD_COMMIT?: string;
  /** sha256 of the uncommitted changes at that build, or '' when there were none. */
  readonly VITE_GAVEL_BUILD_DIFF_HASH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
