/**
 * The bookmarklet: a `javascript:` URL that injects the guest bundle once
 * and toggles the sidebar on later clicks. Everything the bundle needs is
 * in data attributes on the script element it creates.
 */
import { DEFAULT_SIDEBAR_PATH, validateSidebar } from './config.js';

export interface BookmarkletOptions {
  /** Where the built bundle is served from. */
  bundleUrl: string;
  sidebarOrigin: string;
  sidebarPath?: string;
}

/** The name of the global the bundle installs; a second click finds it and toggles. */
export const GUEST_GLOBAL = '__scaleGuest';

export function bookmarkletSource(options: BookmarkletOptions): string {
  const path = options.sidebarPath ?? DEFAULT_SIDEBAR_PATH;
  const problem = validateSidebar(options.sidebarOrigin, path);
  if (problem) throw new Error(problem);
  const bundle = new URL(options.bundleUrl).href;
  return [
    '(function(){',
    `var g=window.${GUEST_GLOBAL};if(g){g.toggleSidebar();return;}`,
    "var s=document.createElement('script');",
    `s.src=${JSON.stringify(bundle)};`,
    `s.setAttribute('data-sidebar-origin',${JSON.stringify(options.sidebarOrigin)});`,
    `s.setAttribute('data-sidebar-path',${JSON.stringify(path)});`,
    '(document.body||document.documentElement).appendChild(s);',
    '})()',
  ].join('');
}

export function bookmarkletUrl(options: BookmarkletOptions): string {
  return 'javascript:' + encodeURIComponent(bookmarkletSource(options));
}
