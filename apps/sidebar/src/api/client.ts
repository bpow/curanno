import { createApiClient, type ApiClient } from '@curanno/api-client';
import { useAuthStore } from '../auth/store';
import { config } from '../config';

let client: ApiClient | undefined;

/** The one API client (ADR 0002): every request goes through the generated client. */
export function useApi(): ApiClient {
  client ??= createApiClient({ baseUrl: config.apiUrl, token: () => useAuthStore().token() });
  return client;
}

/** Tests install a client over a fake fetch. */
export function setApiClient(next: ApiClient | undefined): void {
  client = next;
}
