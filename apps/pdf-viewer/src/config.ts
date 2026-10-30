/**
 * Where the sidebar is. Read at run time from `config.json` next to the
 * viewer, which the API serves from its environment in a deployment; the
 * default is the viewer's own origin with the sidebar at `/sidebar/`, the
 * arrangement of the single-image deployment. Nothing in the viewer's URL
 * may choose the sidebar (ADR 0007): a link could otherwise embed a copy of
 * the sidebar on another origin and collect what the user types into it.
 */
export interface ViewerConfig {
  sidebarOrigin: string;
  sidebarPath: string;
}

export const DEFAULT_SIDEBAR_PATH = '/sidebar/';

export async function loadConfig(fetchImpl: typeof fetch = fetch): Promise<ViewerConfig> {
  const defaults: ViewerConfig = {
    sidebarOrigin: window.location.origin,
    sidebarPath: DEFAULT_SIDEBAR_PATH,
  };
  try {
    const url = new URL('config.json', new URL(import.meta.env.BASE_URL, window.location.origin));
    const response = await fetchImpl(url, { cache: 'no-cache' });
    if (!response.ok || !(response.headers.get('content-type') ?? '').includes('json')) {
      return defaults;
    }
    return applyConfig(defaults, (await response.json()) as Partial<ViewerConfig>);
  } catch {
    return defaults;
  }
}

export function applyConfig(defaults: ViewerConfig, runtime: Partial<ViewerConfig>): ViewerConfig {
  const config = { ...defaults };
  if (typeof runtime.sidebarOrigin === 'string' && runtime.sidebarOrigin) {
    try {
      config.sidebarOrigin = new URL(runtime.sidebarOrigin).origin;
    } catch {
      // Keep the default.
    }
  }
  if (typeof runtime.sidebarPath === 'string' && runtime.sidebarPath.startsWith('/')) {
    config.sidebarPath = runtime.sidebarPath;
  }
  return config;
}
