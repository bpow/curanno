/**
 * The extension's settings, kept in `chrome.storage.sync` and edited on the
 * options page. They say where the deployment is; nothing in them is a
 * credential, since sign-in stays in the sidebar origin (ADR 0019, 0023).
 */
import { validateSidebar } from '@curanno/guest';

export interface Settings {
  /** The sidebar page; its origin is the only one the guest talks to. */
  sidebarUrl: string;
  /** Origin of the API for public counts; empty means the sidebar's origin. */
  apiUrl: string;
  /** The PDF viewer page; empty turns the PDF redirect off. */
  pdfViewerUrl: string;
  /** Look up public annotation counts for every page while the guest is off. */
  publicCounts: boolean;
}

/** The development stack's addresses (README.md). */
export const DEFAULT_SETTINGS: Settings = {
  sidebarUrl: 'http://localhost:3001/sidebar/',
  apiUrl: '',
  pdfViewerUrl: 'http://localhost:5174/pdf/',
  publicCounts: false,
};

export type SettingsProblems = Partial<Record<keyof Settings, string>>;

function httpUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

/** What is wrong with each field, empty when the settings are usable. */
export function validateSettings(settings: Settings): SettingsProblems {
  const problems: SettingsProblems = {};
  const sidebar = httpUrl(settings.sidebarUrl);
  if (!sidebar) {
    problems.sidebarUrl = 'Enter an http or https URL.';
  } else {
    const problem = validateSidebar(sidebar.origin, sidebar.pathname + sidebar.search);
    if (problem) problems.sidebarUrl = problem;
  }
  if (settings.apiUrl) {
    const api = httpUrl(settings.apiUrl);
    if (!api) problems.apiUrl = 'Enter an http or https origin, or leave it empty.';
    else if (api.origin !== settings.apiUrl.replace(/\/$/, '')) {
      problems.apiUrl = 'Enter an origin without a path, such as https://curanno.example.';
    }
  }
  if (settings.pdfViewerUrl && !httpUrl(settings.pdfViewerUrl)) {
    problems.pdfViewerUrl = 'Enter an http or https URL, or leave it empty.';
  }
  return problems;
}

/** Stored values over the defaults, ignoring anything of the wrong type. */
export function mergeSettings(stored: Record<string, unknown>): Settings {
  const merged = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const value = stored[key];
    if (typeof value === typeof DEFAULT_SETTINGS[key]) Object.assign(merged, { [key]: value });
  }
  return merged;
}

export async function loadSettings(): Promise<Settings> {
  return mergeSettings(await chrome.storage.sync.get(null));
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.sync.set(settings);
}

export interface SidebarLocation {
  sidebarOrigin: string;
  sidebarPath: string;
}

export function sidebarLocation(settings: Settings): SidebarLocation {
  const url = new URL(settings.sidebarUrl);
  return { sidebarOrigin: url.origin, sidebarPath: url.pathname + url.search };
}

/** The API base for search; the sidebar's origin when none is set. */
export function apiOrigin(settings: Settings): string {
  return settings.apiUrl ? new URL(settings.apiUrl).origin : new URL(settings.sidebarUrl).origin;
}

/** Origins whose frames never get the content script: the sidebar's and the viewer's. */
export function excludedOrigins(settings: Settings): string[] {
  const origins = [new URL(settings.sidebarUrl).origin];
  if (settings.pdfViewerUrl) origins.push(new URL(settings.pdfViewerUrl).origin);
  return origins;
}

/** Whether a frame's URL is the sidebar page, which gets the sign-in bridge (ADR 0029). */
export function isSidebarUrl(settings: Settings, frameUrl: string | undefined): boolean {
  if (!frameUrl) return false;
  try {
    const sidebar = new URL(settings.sidebarUrl);
    const frame = new URL(frameUrl);
    return frame.origin === sidebar.origin && frame.pathname.startsWith(sidebar.pathname);
  } catch {
    return false;
  }
}
