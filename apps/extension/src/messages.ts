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
