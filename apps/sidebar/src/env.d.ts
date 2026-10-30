/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin of the API. Empty (the default) means the sidebar's own origin. */
  readonly VITE_API_URL?: string;
  readonly VITE_OIDC_ISSUER?: string;
  readonly VITE_OIDC_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
