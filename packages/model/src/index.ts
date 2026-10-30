/**
 * Shared model package: annotation types and schemas, the text model,
 * document identity rules and the body profile registry. Everything here is
 * free of DOM, server and framework dependencies so that the guest, the
 * sidebar, the server and import tooling share one implementation.
 */
export * from './annotation/index.js';
export * from './text-model/index.js';
export * from './document-identity/index.js';
export * from './profiles/index.js';
export * from './rpc/index.js';
