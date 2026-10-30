/**
 * Configuration the bookmarklet hands the bundle through data attributes
 * on its script element. Only the sidebar's location is configurable:
 * nothing a page could set grants a login or a token (ADR 0007).
 */

export interface GuestConfig {
  sidebarOrigin: string;
  sidebarPath: string;
  open: boolean;
  /** Where the bundle itself was loaded from, for injecting it into same-origin frames. */
  bundleUrl?: string;
}

export const DEFAULT_SIDEBAR_PATH = '/';

/** The configuration on a script element, or an error message. */
export function readConfig(script: Element | null): GuestConfig | string {
  if (!script) return 'guest bundle needs a script element with data-sidebar-origin';
  const origin = script.getAttribute('data-sidebar-origin');
  if (!origin) return 'guest bundle needs data-sidebar-origin on its script element';
  const path = script.getAttribute('data-sidebar-path') || DEFAULT_SIDEBAR_PATH;
  const open = script.getAttribute('data-open') !== 'false';
  const check = validateSidebar(origin, path);
  if (check) return check;
  const src = (script as HTMLScriptElement).src;
  return { sidebarOrigin: origin, sidebarPath: path, open, ...(src ? { bundleUrl: src } : {}) };
}

/** Undefined when the origin is a plain http(s) origin and the path stays on it. */
export function validateSidebar(origin: string, path: string): string | undefined {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return `sidebar origin is not a URL: ${origin}`;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return `sidebar origin must be http(s): ${origin}`;
  }
  if (url.origin !== origin) return `sidebar origin must be an origin without a path: ${origin}`;
  try {
    if (new URL(path, origin).origin !== origin) return `sidebar path leaves the origin: ${path}`;
  } catch {
    return `sidebar path is not valid: ${path}`;
  }
  return undefined;
}
