# 0003. Fastify as the server framework, with Ajv for all validation

**Status:** Accepted

**Date:** 2026-10-29

## Context

The server must be built on a mainstream framework (requirement 4) and implement an API defined by a hand-written OpenAPI document (ADR 0002). It also needs to validate structured annotation bodies against JSON Schemas registered per body profile. Candidates among Node frameworks were NestJS, Fastify, Hono and AdonisJS, with Nitro as a standalone server also considered.

NestJS offers the most structure and the largest hiring pool but adds dependency injection and decorator ceremony that a spec-bound API server does not need. Hono is lightweight but younger. AdonisJS has a small community. Nitro is not widely used as a standalone API server.

## Decision

The server is built on Fastify. Routes are bound to the OpenAPI document so that its schemas become Fastify's request and response schemas. Fastify's built-in Ajv instance validates requests and responses, and the same Ajv instance validates structured bodies against the body profile registry. One JSON Schema toolchain therefore covers the API contract, request handling and body profiles.

## Consequences

- Validation is consistent and fast, and schema errors are reported in one format whether they come from the protocol layer or a body profile.
- Fastify's plugin system keeps optional pieces, such as a Hypothesis-compatible layer, in separate packages.
- Fastify imposes little structure, so module layout, error handling conventions and dependency wiring are ours to define and document.
- Ajv's handling of OpenAPI-specific keywords and of JSON Schema draft differences needs attention; the spike in Phase 0 and the contract tests in Phase 3 must cover this.
- Contributors used to NestJS or Django will find fewer conventions to lean on.

## References

- [Analysis note: Server](../web-annotation-replacement.md#1-server)
- ADR 0002
