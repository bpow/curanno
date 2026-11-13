/**
 * Errors as the API reports them: RFC 9457 problem details, which
 * openapi-fetch hands back as the parsed `error` of a response. Network
 * failures become a problem with status 0 so that one shape reaches the UI.
 */
import type { Problem } from './schema.js';

export class ApiError extends Error {
  constructor(readonly problem: Problem) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
  }
}

function isProblem(value: unknown): value is Problem {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Problem).title === 'string' &&
    typeof (value as Problem).status === 'number'
  );
}

export function problemFrom(error: unknown, response?: Response): Problem {
  if (isProblem(error)) return error;
  const status = response?.status ?? 0;
  const detail = typeof error === 'string' && error ? error : undefined;
  return {
    status,
    title: status === 0 ? 'Network error' : response?.statusText || `Request failed (${status})`,
    ...(detail !== undefined ? { detail } : {}),
  };
}

/** The problem behind any error thrown while calling the API. */
export function toProblem(err: unknown): Problem {
  if (err instanceof ApiError) return err.problem;
  return {
    status: 0,
    title: 'Network error',
    detail: err instanceof Error ? err.message : String(err),
  };
}

interface Result<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

/** The data of a successful call; throws an ApiError otherwise. */
export function unwrap<T>(result: Result<T>): T {
  if (result.error !== undefined || !result.response.ok) {
    throw new ApiError(problemFrom(result.error, result.response));
  }
  return result.data as T;
}
