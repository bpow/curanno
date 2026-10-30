/**
 * Shared setup for the bookmarklet suite. The host pages and the guest
 * bundle come from the corpus servers the Playwright config starts; the
 * sidebar is the built app on the preview server (which sends the
 * `frame-ancestors` policy); the API is answered by routes on the sidebar's
 * origin, with one public annotation on the page and whatever the test
 * creates. A session is seeded into the sidebar's `sessionStorage` the way
 * oidc-client-ts stores one, so the sidebar is signed in without a provider.
 */
import { bookmarkletSource } from '@scale/guest';
import type { BrowserContext, Frame, Page } from '@playwright/test';

export const SIDEBAR_ORIGIN = 'http://localhost:4173';
export const SIDEBAR_PATH = '/sidebar/';
export const SIDEBAR_URL = `${SIDEBAR_ORIGIN}${SIDEBAR_PATH}`;
export const HOST_ORIGIN = 'http://127.0.0.1:4180';
/** A loopback origin the sidebar's `frame-ancestors` policy does not list. */
export const UNLISTED_ORIGIN = 'http://[::1]:4181';
/** The PDF viewer app on its own origin, as deployed (ADR 0021). */
export const VIEWER_ORIGIN = 'http://127.0.0.1:4174';
export const VIEWER_URL = `${VIEWER_ORIGIN}/pdf/`;
export const PAGE_PATH = '/cases/synth-overlap/original.html';
export const BUNDLE_URL = `${HOST_ORIGIN}/guest.js`;
export const API_ORIGIN = 'http://localhost:3000';

/** Things the sidebar holds that must never reach the page (success criterion 6). */
export const SECRETS = {
  token: 'e2e-access-token-5c1e9a7f-must-not-leak',
  body: 'Secret annotation body: the committee voted 7 to 2.',
  tag: 'secret-tag-confidential',
  creator: 'Alice Annotator',
} as const;

export const PUBLIC_ANNOTATION_ID = `${API_ORIGIN}/annotations/11111111-1111-4111-8111-111111111111`;
export const PUBLIC_QUOTE = 'Four members supported it';

const OIDC_USER_KEY = 'oidc.user:http://localhost:8080/realms/annotations-dev:annotations-sidebar';

function annotation(pageUrl: string): Record<string, unknown> {
  return {
    '@context': 'http://www.w3.org/ns/anno.jsonld',
    id: PUBLIC_ANNOTATION_ID,
    type: 'Annotation',
    creator: {
      id: `${API_ORIGIN}/x/users/22222222-2222-4222-8222-222222222222`,
      type: 'Person',
      name: SECRETS.creator,
    },
    created: '2026-10-30T08:00:00Z',
    modified: '2026-10-30T08:00:00Z',
    permissions: ['read'],
    motivation: 'commenting',
    body: [
      { type: 'TextualBody', value: SECRETS.body, purpose: 'commenting' },
      { type: 'TextualBody', value: SECRETS.tag, purpose: 'tagging' },
    ],
    target: {
      type: 'SpecificResource',
      source: pageUrl,
      selector: [{ type: 'TextQuoteSelector', exact: PUBLIC_QUOTE }],
    },
  };
}

export interface ApiCall {
  method: string;
  url: URL;
  authorization: string | undefined;
  body: unknown;
}

export interface StubApi {
  calls: ApiCall[];
  /** Annotations the stub has handed out, by IRI. */
  annotations: Map<string, Record<string, unknown>>;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => ({
  status,
  contentType: 'application/json',
  headers,
  body: JSON.stringify(body),
});

/** Answers the sidebar's API calls on its own origin. */
export async function stubApi(context: BrowserContext, pageUrl: string): Promise<StubApi> {
  const stub: StubApi = { calls: [], annotations: new Map() };
  stub.annotations.set(PUBLIC_ANNOTATION_ID, annotation(pageUrl));
  let counter = 0;
  await context.route(
    (url) =>
      url.origin === SIDEBAR_ORIGIN &&
      (url.pathname.startsWith('/x/') || url.pathname.startsWith('/annotations')),
    async (route, request) => {
      const url = new URL(request.url());
      const text = request.postData();
      const call: ApiCall = {
        method: request.method(),
        url,
        authorization: request.headers()['authorization'],
        body: text ? (JSON.parse(text) as unknown) : undefined,
      };
      stub.calls.push(call);
      const key = `${call.method} ${url.pathname}`;
      switch (key) {
        case 'GET /x/profiles':
          return route.fulfill(json([]));
        case 'GET /x/search': {
          const items = [...stub.annotations.values()].filter((a) => {
            const target = a['target'] as { source?: string };
            return target.source === url.searchParams.get('uri');
          });
          return route.fulfill(json({ total: items.length, items }));
        }
        case 'GET /x/events':
          return route.fulfill({
            status: 200,
            contentType: 'text/event-stream',
            body: ': connected\n\n',
          });
        case 'POST /x/documents': {
          const input = call.body as { uri: string; title?: string; links: unknown[] };
          return route.fulfill(
            json({
              id: '33333333-3333-4333-8333-333333333333',
              ...(input.title ? { title: input.title } : {}),
              uris: input.links,
              created: '2026-10-30T08:00:00Z',
              modified: '2026-10-30T08:00:00Z',
            }),
          );
        }
        case 'POST /annotations/': {
          const id = `${API_ORIGIN}/annotations/44444444-4444-4444-8444-${String(++counter).padStart(12, '0')}`;
          const created = {
            '@context': 'http://www.w3.org/ns/anno.jsonld',
            ...(call.body as Record<string, unknown>),
            id,
            creator: {
              id: `${API_ORIGIN}/x/users/55555555-5555-4555-8555-555555555555`,
              type: 'Person',
              name: 'E2E User',
            },
            created: new Date().toISOString(),
            modified: new Date().toISOString(),
            permissions: ['read', 'update', 'delete', 'share'],
          };
          stub.annotations.set(id, created);
          return route.fulfill(json(created, 201, { etag: '"1"', location: id }));
        }
        default:
          return route.fulfill(
            json({ status: 404, title: 'Not Found', detail: key }, 404, {
              'content-type': 'application/problem+json',
            }),
          );
      }
    },
  );
  return stub;
}

/**
 * Points the viewer at the sidebar under test and the sidebar at the viewer
 * under test, as the API's `config.json` files would in a deployment: the
 * sidebar accepts a document on another origin only from the viewer origin.
 */
export async function stubViewerConfig(context: BrowserContext): Promise<void> {
  await context.route(`${VIEWER_URL}config.json`, (route) =>
    route.fulfill(json({ sidebarOrigin: SIDEBAR_ORIGIN, sidebarPath: SIDEBAR_PATH })),
  );
  await context.route(`${SIDEBAR_URL}config.json`, (route) =>
    route.fulfill(
      json({
        oidcIssuer: 'http://localhost:8080/realms/annotations-dev',
        oidcClientId: 'annotations-sidebar',
        apiUrl: '',
        pdfViewerOrigin: VIEWER_ORIGIN,
      }),
    ),
  );
}

/** Signs the sidebar in: a stored session with `token`, as oidc-client-ts would have left it. */
export async function seedSession(context: BrowserContext, token = SECRETS.token): Promise<void> {
  const user = {
    access_token: token,
    token_type: 'Bearer',
    scope: 'openid profile email',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    profile: { sub: 'e2e-user', name: 'E2E User', preferred_username: 'e2e' },
  };
  await context.addInitScript(
    ({ origin, key, value }) => {
      if (location.origin === origin) sessionStorage.setItem(key, value);
    },
    { origin: SIDEBAR_ORIGIN, key: OIDC_USER_KEY, value: JSON.stringify(user) },
  );
}

/** The script the bookmarklet runs, for the sidebar on the preview server. */
export function injectSource(bundleUrl = BUNDLE_URL): string {
  return bookmarkletSource({ bundleUrl, sidebarOrigin: SIDEBAR_ORIGIN, sidebarPath: SIDEBAR_PATH });
}

/** Injects the guest as the bookmarklet does and returns the sidebar's frame once it has loaded. */
export async function injectGuest(page: Page): Promise<Frame> {
  await page.evaluate(injectSource());
  return sidebarFrame(page);
}

export async function sidebarFrame(page: Page): Promise<Frame> {
  for (let i = 0; i < 200; i++) {
    const frame = page.frames().find((f) => f.url().startsWith(SIDEBAR_URL));
    if (frame) {
      await frame.waitForLoadState();
      return frame;
    }
    await page.waitForTimeout(25);
  }
  throw new Error(`no frame from ${SIDEBAR_ORIGIN}`);
}

/** Selects `text` in the page by its first occurrence in a text node. */
export async function selectText(page: Page, text: string): Promise<void> {
  await page.evaluate((needle) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = (node as Text).data.indexOf(needle);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }
    throw new Error(`text not found: ${needle}`);
  }, text);
}

/** The text of every highlight the guest drew. */
export function highlightedTexts(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...(CSS.highlights.get('scale-annotation') ?? [])].map((r) => (r as Range).toString()),
  );
}

/** The centre of the first highlight, in viewport coordinates. */
export function highlightCentre(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const range = [...(CSS.highlights.get('scale-annotation') ?? [])][0] as Range | undefined;
    if (!range) throw new Error('no highlight');
    const rect = range.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
}
