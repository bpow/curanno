/**
 * Runtime configuration. Defaults match the compose stack and `.env.example`
 * at the repository root; `VITE_*` variables override them at build time.
 * Nothing here may come from the host page (ADR 0007): page-supplied
 * configuration must never choose the issuer, the client or the API.
 */
export const config = {
  apiUrl: import.meta.env.VITE_API_URL ?? '',
  oidc: {
    issuer: import.meta.env.VITE_OIDC_ISSUER ?? 'http://localhost:8080/realms/annotations-dev',
    clientId: import.meta.env.VITE_OIDC_CLIENT_ID ?? 'annotations-sidebar',
  },
} as const;
