/**
 * Errors as RFC 9457 problem details, which the OpenAPI document promises
 * for every error response. Handlers throw a Problem; the error handler
 * installed by server.ts turns it, and Fastify's own validation and
 * content-type errors, into `application/problem+json`.
 */
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export interface ValidationIssue {
  instancePath?: string;
  message: string;
}

export interface ProblemBody {
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: ValidationIssue[];
}

export class Problem extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly detail?: string,
    readonly errors?: ValidationIssue[],
    readonly headers: Record<string, string> = {},
  ) {
    super(detail ?? title);
    this.name = 'Problem';
  }

  toJSON(): ProblemBody {
    return {
      title: this.title,
      status: this.status,
      ...(this.detail !== undefined ? { detail: this.detail } : {}),
      ...(this.errors !== undefined ? { errors: this.errors } : {}),
    };
  }
}

export const badRequest = (detail: string, errors?: ValidationIssue[]): Problem =>
  new Problem(400, 'Bad Request', detail, errors);
export const unauthorized = (detail: string): Problem =>
  new Problem(401, 'Unauthorized', detail, undefined, {
    'www-authenticate': 'Bearer realm="curanno"',
  });
export const forbidden = (detail: string): Problem => new Problem(403, 'Forbidden', detail);
export const notFound = (detail = 'No such resource'): Problem =>
  new Problem(404, 'Not Found', detail);
export const gone = (detail = 'The annotation was deleted'): Problem =>
  new Problem(410, 'Gone', detail);
export const conflict = (detail: string): Problem => new Problem(409, 'Conflict', detail);
export const preconditionFailed = (detail = 'If-Match does not match the current ETag'): Problem =>
  new Problem(412, 'Precondition Failed', detail);
export const preconditionRequired = (detail = 'If-Match is required'): Problem =>
  new Problem(428, 'Precondition Required', detail);
export const unprocessable = (detail: string, errors?: ValidationIssue[]): Problem =>
  new Problem(422, 'Unprocessable Content', detail, errors);
export const serviceUnavailable = (detail: string): Problem =>
  new Problem(503, 'Service Unavailable', detail);

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  404: 'Not Found',
  406: 'Not Acceptable',
  413: 'Content Too Large',
  415: 'Unsupported Media Type',
  500: 'Internal Server Error',
};

type ValidationError = FastifyError & {
  validation?: { instancePath: string; keyword: string; message?: string; params: unknown }[];
  validationContext?: string;
};

function fromFastifyError(err: ValidationError): Problem {
  if (err.validation) {
    const missingIfMatch =
      err.validationContext === 'headers' &&
      err.validation.some(
        (v) =>
          v.keyword === 'required' &&
          (v.params as { missingProperty?: string }).missingProperty === 'if-match',
      );
    if (missingIfMatch) return preconditionRequired();
    return badRequest(
      `${err.validationContext ?? 'request'} failed validation`,
      err.validation.map((v) => ({
        instancePath: v.instancePath,
        message: v.message ?? 'invalid',
      })),
    );
  }
  const status = err.statusCode ?? 500;
  if (status === 401) return unauthorized(err.message);
  return new Problem(status, TITLES[status] ?? err.name ?? 'Error', err.message);
}

export function installProblemHandlers(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | Problem, request, reply) => {
    const problem = err instanceof Problem ? err : fromFastifyError(err);
    if (problem.status >= 500) request.log.error({ err }, 'request failed');
    void sendProblem(reply, problem, request);
  });
  app.setNotFoundHandler((request, reply) => {
    void sendProblem(reply, notFound(`No route for ${request.method} ${request.url}`), request);
  });
}

export function sendProblem(
  reply: FastifyReply,
  problem: Problem,
  request?: FastifyRequest,
): FastifyReply {
  reply.headers(problem.headers);
  const body = problem.toJSON();
  if (problem.status >= 500 && request) {
    // Never leak internals: the log has the detail.
    delete body.detail;
    delete body.errors;
  }
  return reply.code(problem.status).type('application/problem+json').send(body);
}
