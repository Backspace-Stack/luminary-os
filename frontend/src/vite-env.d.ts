/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Bearer token for the backend API. Must match the backend's
   * API_AUTH_TOKEN. Leave unset (the default) to run with the API gate off.
   */
  readonly VITE_API_AUTH_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
