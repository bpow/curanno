/**
 * Calls to the account routes of the embedded issuer (`/auth/…`, ADR 0028).
 * They answer with problem details on failure; the page shows the detail,
 * which the server words for a person.
 */
export interface Answer<T = Record<string, unknown>> {
  ok: boolean;
  status: number;
  body: T;
  /** What to tell the user when `ok` is false. */
  message: string;
}

export async function call<T = Record<string, unknown>>(
  path: string,
  options: { body?: object; token?: string | undefined; method?: 'GET' | 'POST' } = {},
): Promise<Answer<T>> {
  try {
    const res = await fetch(path, {
      method: options.method ?? (options.body ? 'POST' : 'GET'),
      credentials: 'same-origin',
      headers: {
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    const body = (await res.json().catch(() => ({}))) as T & { detail?: string };
    return {
      ok: res.ok,
      status: res.status,
      body,
      message: res.ok ? '' : (body.detail ?? 'The request failed. Try again.'),
    };
  } catch {
    return {
      ok: false,
      status: 0,
      body: {} as T,
      message: 'The server could not be reached. Try again.',
    };
  }
}

/** The token in a link's query, if it looks like one. */
export function tokenFrom(value: unknown): string | undefined {
  return typeof value === 'string' && /^[\w-]{20,200}$/.test(value) ? value : undefined;
}
