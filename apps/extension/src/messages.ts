/** What a content script tells the service worker: its frame's anchor count, nothing more. */
export interface AnchorCountMessage {
  type: 'anchor-count';
  count: number;
}

export function isAnchorCountMessage(value: unknown): value is AnchorCountMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Record<string, unknown>;
  return (
    message['type'] === 'anchor-count' &&
    typeof message['count'] === 'number' &&
    Number.isInteger(message['count']) &&
    message['count'] >= 0
  );
}

/** What the sidebar's bridge asks the service worker: run this URL through launchWebAuthFlow. */
export interface WebAuthRequest {
  type: 'web-auth';
  url: string;
}

/** The URL the flow ended on, or why it did not. */
export type WebAuthResult = { url: string } | { error: string };

export function isWebAuthRequest(value: unknown): value is WebAuthRequest {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Record<string, unknown>;
  return message['type'] === 'web-auth' && typeof message['url'] === 'string';
}

export function isWebAuthResult(value: unknown): value is WebAuthResult {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Record<string, unknown>;
  return typeof result['url'] === 'string' || typeof result['error'] === 'string';
}
