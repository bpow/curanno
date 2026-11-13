/** Checks shared by the routes the embedded issuer adds beside the API. */
import type { FastifyRequest } from 'fastify';
import { badRequest, forbidden } from '../../problems.js';

/** A cross-site page cannot make the user's browser act on the issuer's behalf. */
export function requireSameOrigin(request: FastifyRequest, origin: string): void {
  const from = request.headers.origin;
  const site = request.headers['sec-fetch-site'];
  if ((from !== undefined && from !== origin) || (site !== undefined && site !== 'same-origin')) {
    throw forbidden('Cross-site requests are not accepted here');
  }
}

/** The schema of a string property of a JSON body, within bounds. */
export const text = (max: number, min = 1) =>
  ({ type: 'string', minLength: min, maxLength: max }) as const;

/** An address, which the handler trims; anything shaped like one is accepted, as mail decides the rest. */
export const EMAIL = {
  ...text(320),
  pattern: String.raw`^\s*[^\s@]+@[^\s@]+\.[^\s@]+\s*$`,
} as const;

type Property = ReturnType<typeof text> | typeof EMAIL;

/**
 * Route options that validate a JSON body with the server's Ajv. A failure is
 * attached to the request rather than answered, so that the handler's other
 * refusals (cross-site, not signed in, over a limit) keep coming first and
 * `body` can word it for the person reading the account page.
 */
export function accepts<P extends Record<string, Property>>(
  properties: P,
  required: (keyof P & string)[] = Object.keys(properties),
) {
  return {
    attachValidation: true,
    schema: { body: { type: 'object', properties, required } },
  } as const;
}

interface Issue {
  instancePath: string;
  keyword: string;
  params: { missingProperty?: string; limit?: number; pattern?: string };
}

/** What is wrong with the property, as the person filling in the form would put it. */
function complaint(issue: Issue): string {
  switch (issue.keyword) {
    case 'maxLength':
      return `must be at most ${issue.params.limit} characters`;
    case 'pattern':
      return issue.params.pattern === EMAIL.pattern
        ? 'is not an email address'
        : 'is not in the expected form';
    default:
      return 'is required';
  }
}

/** The validated body of a route declared with `accepts`; a bad request when it did not validate. */
export function body<T>(request: FastifyRequest): T {
  const failed = request.validationError;
  if (failed) {
    const issue = (failed.validation as Issue[])[0];
    const name = issue?.params.missingProperty ?? issue?.instancePath.slice(1);
    if (!issue || !name) throw badRequest('A JSON object is required');
    throw badRequest(`${name} ${complaint(issue)}`);
  }
  return request.body as T;
}
