/** The few cookie operations the embedded issuer's own routes need. */
import type { FastifyReply, FastifyRequest } from 'fastify';

export function readCookie(request: FastifyRequest, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name)
      return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

export function setCookie(
  reply: FastifyReply,
  name: string,
  value: string,
  options: { secure: boolean; maxAgeSeconds: number },
): void {
  reply.header(
    'set-cookie',
    `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${options.maxAgeSeconds}; HttpOnly; SameSite=Lax${options.secure ? '; Secure' : ''}`,
  );
}
