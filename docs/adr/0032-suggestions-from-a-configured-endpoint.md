# 0032. Annotation suggestions come from an OpenAI-compatible endpoint the deployment configures

**Status:** Accepted

**Date:** 2026-11-13

## Context

Curators want a language model to read the open document and suggest annotations: a quote, plus a structured body for a registered profile ([docs/extraction-plan.md](../extraction-plan.md)). Some documents and some deployments must not send their text to a third party, so the model has to be able to run on the curator's own machine. Others might later use a hosted model.

The options considered for where the model is called from:

- **The API calls the model**, as a proxy under `/x/`. A server-side key would be easy to hold. But every document's text would pass through the deployment, and a local model on the curator's machine could not be used at all.
- **A desktop shell (Tauri) or a native helper** calls the model. That brings native code, another sign-in path, a different web engine per platform, and no access to the browser's institutional sessions.
- **The sidebar calls the model directly.** The guest already has the document's text, and the sidebar can reach an endpoint on the curator's machine. Chosen.

The options considered for the protocol:

- **Ollama's native API.** It only covers Ollama.
- **The OpenAI chat completions API with `response_format: json_schema`.** Ollama, llama.cpp's server, vLLM and LM Studio serve it, and so do most hosted providers. Chosen.

## Decision

- `@curanno/extract` (`packages/extract`) is the pipeline. It turns scope texts and a profile into suggestions: it chunks the text, builds the prompt and the output schema, calls the endpoint, anchors each quote, resolves ontology labels and validates each value. It depends only on `@curanno/model`, so it runs in the sidebar and in a Node CLI alike.
- The endpoint is an OpenAI-compatible `POST {url}/v1/chat/completions`, called with `fetch` and no SDK. No credential is sent.
- The operator lists the endpoints in `EXTRACT_ENDPOINTS`, a JSON array of `{label, url, models?}`. The list reaches the sidebar through `config.json`, and each endpoint's origin is added to the sidebar's `connect-src`. That makes the CSP the enforcement point: the sidebar cannot send text to an endpoint the operator did not list. An empty list turns the feature off.
- `EXTRACT_LOCAL_ONLY=true` makes the server refuse to start when an endpoint's host is not loopback (`localhost`, `127.0.0.1`, `[::1]`). This lets a deployment guarantee that document text stays on the curator's machine.
- A quote counts only if it occurs verbatim in the scope's text, after whitespace and typographic punctuation are folded. Fuzzy matching is not used: a quote the model changed is one we cannot vouch for.
- Suggestions live only in the sidebar's memory until the curator accepts one, and that becomes an ordinary annotation the curator creates.

## Consequences

- An https sidebar fetching `http://localhost` depends on browsers treating loopback as potentially trustworthy, and on Chromium's Local Network Access permission. This was not tested in Safari or behind the permission prompt when this ADR was written (plan, step 1). If a browser blocks it, the fallback is to send the request through the extension's service worker (ADR 0029).
- Ollama only answers cross-origin requests from origins listed in `OLLAMA_ORIGINS`, so users have to set it to the sidebar's origin. The user guide gives the command.
- A hosted endpoint that needs credentials is not supported yet (plan, section 7).
- Page text goes to the model, so prompt injection is expected. It is bounded because the model has no tools, its output must anchor as verbatim quotes and validate against the profile, and a person reviews every suggestion before anything is saved.

## References

- [docs/extraction-plan.md](../extraction-plan.md)
- ADR 0007, ADR 0016, ADR 0019, ADR 0031
- [OpenAI chat completions, structured outputs](https://platform.openai.com/docs/guides/structured-outputs); [Ollama OpenAI compatibility](https://github.com/ollama/ollama/blob/main/docs/openai.md)
