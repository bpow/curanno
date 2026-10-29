# 0011. Bind routes to the OpenAPI document with fastify-openapi-glue

- Status: Accepted
- Date: 2026-10-29

## Context

ADR 0002 makes the hand-written OpenAPI document the contract and requires the server to bind its routes to it. Two mechanisms were open: the `fastify-openapi-glue` plugin, which registers one route per operation and maps `operationId` to a handler, or our own loader that dereferences the document and calls `fastify.route()` with the operation's schemas.

The Phase 0 spike in `apps/api/spike/` built both against the same toy document and sent the same seven requests through each. Results were identical line for line: path parameter and body validation returned 400 with Fastify's standard error shape, response schemas were enforced (a handler returning an invalid body produced a 500 rather than leaking it), and the route tables matched. The manual binding needed about 60 lines, and would have grown to cover query and header coercion, security schemes and content-type variants.

The spike also showed that both bindings accepted a body with an extra property even though the schema said `additionalProperties: false`. Fastify configures Ajv with `removeAdditional: true`, which strips unknown properties instead of rejecting them. For JSON-LD annotations, where extension properties are legitimate and must round-trip, silently removing fields would corrupt data.

## Decision

Use `fastify-openapi-glue`. Configure Fastify's Ajv with `removeAdditional: false` and `coerceTypes: false` for JSON bodies, and keep `additionalProperties` unconstrained on annotation schemas so unknown JSON-LD properties pass through. Register a content-type parser for `application/ld+json`, which the W3C protocol uses, before the plugin.

## Consequences

- One small dependency with a single primary maintainer. The spike's manual binding stays in the repository as a documented fallback, so replacing the plugin is a day's work rather than a redesign.
- Handlers are looked up by `operationId`, so every operation in the document needs a stable, unique `operationId`. This is a reasonable constraint and the contract tests check it.
- Disabling `removeAdditional` means request schemas must be explicit about what is permitted; validation errors surface to clients instead of being hidden.
- Security handlers for OIDC bearer tokens map onto the plugin's `securityHandlers` option, keyed by the document's security scheme names.

## References

- Spike: `apps/api/spike/` (`pnpm spike:glue`, `pnpm spike:manual`)
- [ADR 0002](0002-openapi-contract.md), [ADR 0003](0003-fastify-server.md)
