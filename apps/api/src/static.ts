/**
 * The clients, served by the API process from one image (ADR 0021): the
 * sidebar under `/sidebar/`, the PDF viewer under `/pdf/`, the guest
 * bundle at `/guest.js`, each with its Content-Security-Policy, and a
 * `config.json` for the sidebar and the viewer generated from this
 * server's environment so that one image runs everywhere. When a viewer
 * origin is configured the viewer is served for that host only, so it
 * cannot be opened on the sidebar's origin.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Config } from './config.js';

export interface StaticOptions {
  /** Holds `sidebar/`, `pdf/` and `guest.js`; each is served when present. */
  root: string;
  config: Config;
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

/** The CSP of the sidebar: scripts and styles from itself, the API on its origin, the provider for sign-in. */
export function sidebarPolicy(config: Config): string {
  const issuer = originOf(config.oidc.issuer);
  // The only places document text may go for suggestions (ADR 0032).
  const endpoints = [...new Set(config.extractEndpoints.map((e) => originOf(e.url)))];
  const ancestors = [...config.frameAncestors];
  if (config.pdfViewerOrigin && !ancestors.includes(config.pdfViewerOrigin)) {
    ancestors.push(config.pdfViewerOrigin);
  }
  return [
    "default-src 'self'",
    // Ajv compiles profile schemas to functions at run time (apps/sidebar/README.md).
    "script-src 'self' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    ["connect-src 'self'", issuer, ...endpoints].filter(Boolean).join(' '),
    `frame-src ${issuer || "'none'"}`,
    `form-action 'self' ${issuer}`.trim(),
    "base-uri 'self'",
    "object-src 'none'",
    `frame-ancestors ${ancestors.join(' ')}`,
  ].join('; ');
}

/** The CSP of the viewer: it fetches PDFs from anywhere, runs PDF.js's worker and embeds the sidebar. */
export function viewerPolicy(config: Config): string {
  const sidebar = config.pdfViewerOrigin ? originOf(config.publicUrl) : "'self'";
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    'connect-src *',
    `frame-src ${sidebar}`,
    "base-uri 'self'",
    "object-src 'none'",
    'frame-ancestors *',
  ].join('; ');
}

function sendWith(policy: string) {
  return (_request: unknown, reply: FastifyReply): void => {
    reply.header('content-security-policy', policy);
  };
}

export async function installStatic(app: FastifyInstance, options: StaticOptions): Promise<void> {
  const { root, config } = options;
  const sidebarDir = path.join(root, 'sidebar');
  const viewerDir = path.join(root, 'pdf');
  const guestBundle = path.join(root, 'guest.js');
  const viewerHost = config.pdfViewerOrigin ? new URL(config.pdfViewerOrigin).host : undefined;

  if (existsSync(sidebarDir)) {
    app.get('/sidebar/config.json', async (_request, reply) => {
      reply.header('cache-control', 'no-store');
      return {
        oidcIssuer: config.oidc.issuer,
        oidcClientId: config.oidc.clientId,
        apiUrl: '',
        pdfViewerOrigin: config.pdfViewerOrigin ?? '',
        extractEndpoints: config.extractEndpoints,
      };
    });
    await app.register(async (scope) => {
      scope.addHook('onRequest', (request, reply, done) => {
        sendWith(sidebarPolicy(config))(request, reply);
        done();
      });
      await scope.register(fastifyStatic, {
        root: sidebarDir,
        prefix: '/sidebar/',
        decorateReply: false,
        index: ['index.html'],
      });
    });
  }

  if (existsSync(viewerDir)) {
    const constraints = viewerHost ? { host: viewerHost } : {};
    app.get('/pdf/config.json', { constraints }, async (_request, reply) => {
      reply.header('cache-control', 'no-store');
      return {
        sidebarOrigin: config.pdfViewerOrigin ? originOf(config.publicUrl) : '',
        sidebarPath: '/sidebar/',
      };
    });
    await app.register(async (scope) => {
      scope.addHook('onRequest', (request, reply, done) => {
        sendWith(viewerPolicy(config))(request, reply);
        done();
      });
      await scope.register(fastifyStatic, {
        root: viewerDir,
        prefix: '/pdf/',
        decorateReply: false,
        index: ['index.html'],
        constraints,
      });
    });
  }

  if (existsSync(guestBundle)) {
    // Small and immutable for the life of the process: read once, no directory listing.
    const bundle = readFileSync(guestBundle);
    app.get('/guest.js', async (_request, reply) => {
      reply.header('cache-control', 'public, max-age=300');
      reply.type('text/javascript; charset=utf-8');
      return bundle;
    });
  }
}
