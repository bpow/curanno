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

/** A string property of a JSON body, within bounds; anything else is a bad request. */
export function field(body: unknown, name: string, max: number, min = 1): string {
  const value = (body as Record<string, unknown> | null | undefined)?.[name];
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    throw badRequest(`${name} is required`);
  }
  return value;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emailField(body: unknown, name = 'email'): string {
  const value = field(body, name, 320).trim();
  if (!EMAIL.test(value)) throw badRequest(`${name} is not an email address`);
  return value;
}
