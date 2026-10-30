/**
 * The service worker (ADR 0023). It turns the guest on and off per tab,
 * injects the content script into every frame that loads in a tab where
 * the guest is on, sends PDFs opened in such a tab to the viewer, and keeps
 * the badge. Its state lives in `chrome.storage.session`, because the
 * browser stops the worker whenever it is idle.
 */
import { isAnchorCountMessage } from './messages.js';
import {
  ICON_SIZES,
  badgeText,
  isPdfResponse,
  isWebPage,
  publicCountUrl,
  viewerUrlFor,
} from './pages.js';
import { apiOrigin, loadSettings } from './settings.js';

const session = chrome.storage.session;
const onKey = (tabId: number): string => `on:${tabId}`;
const pdfKey = (tabId: number): string => `pdf:${tabId}`;
const countPrefix = (tabId: number): string => `count:${tabId}:`;

function icons(on: boolean): Record<string, string> {
  return Object.fromEntries(ICON_SIZES.map((s) => [s, `icons/${on ? 'on' : 'off'}-${s}.png`]));
}

async function isOn(tabId: number): Promise<boolean> {
  return (await session.get(onKey(tabId)))[onKey(tabId)] === true;
}

async function countKeys(tabId: number, frameId?: number): Promise<string[]> {
  const prefix = countPrefix(tabId);
  const all = await session.get(null);
  return Object.keys(all).filter((k) =>
    frameId === undefined ? k.startsWith(prefix) : k === `${prefix}${frameId}`,
  );
}

async function anchorCount(tabId: number): Promise<number> {
  const prefix = countPrefix(tabId);
  const all = await session.get(null);
  let total = 0;
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(prefix) && typeof value === 'number') total += value;
  }
  return total;
}

async function publicCount(tabId: number): Promise<number | undefined> {
  const settings = await loadSettings();
  if (!settings.publicCounts) return undefined;
  const tab = await chrome.tabs.get(tabId);
  if (!isWebPage(tab.url)) return undefined;
  try {
    const response = await fetch(publicCountUrl(apiOrigin(settings), tab.url), {
      credentials: 'omit',
      cache: 'no-store',
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { total?: unknown };
    return typeof body.total === 'number' ? body.total : undefined;
  } catch {
    return undefined;
  }
}

async function refresh(tabId: number): Promise<void> {
  try {
    const on = await isOn(tabId);
    const count = on ? await anchorCount(tabId) : await publicCount(tabId);
    await chrome.action.setIcon({ tabId, path: icons(on) });
    await chrome.action.setTitle({ tabId, title: `CurAnno: ${on ? 'on' : 'off'}` });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: on ? '#2b6cb0' : '#5f6368' });
    await chrome.action.setBadgeText({ tabId, text: badgeText(count) });
  } catch {
    // The tab closed meanwhile.
  }
}

async function inject(tabId: number, frameIds?: number[]): Promise<void> {
  await chrome.scripting.executeScript({
    target: frameIds ? { tabId, frameIds } : { tabId, allFrames: true },
    files: ['content.js'],
  });
}

async function turnOn(tab: chrome.tabs.Tab): Promise<void> {
  const tabId = tab.id as number;
  const settings = await loadSettings();
  const pdf = (await session.get(pdfKey(tabId)))[pdfKey(tabId)] as string | undefined;
  await session.set({ [onKey(tabId)]: true });
  if (settings.pdfViewerUrl && pdf && pdf === tab.url) {
    await chrome.tabs.update(tabId, { url: viewerUrlFor(settings.pdfViewerUrl, pdf) });
    return;
  }
  try {
    await inject(tabId);
  } catch (err) {
    // A page extensions may not touch, such as the Web Store or a browser page.
    await session.remove(onKey(tabId));
    console.warn('[curanno extension] cannot run on this page:', err);
  }
}

async function turnOff(tabId: number): Promise<void> {
  await session.remove([onKey(tabId), ...(await countKeys(tabId))]);
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => window.__curannoExtension?.stop(),
    });
  } catch {
    // Nothing was injected, or the page has gone.
  }
}

async function toggle(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined) return;
  if (await isOn(tab.id)) await turnOff(tab.id);
  else await turnOn(tab);
  await refresh(tab.id);
}

chrome.action.onClicked.addListener((tab) => void toggle(tab));

chrome.webNavigation.onCommitted.addListener((details) => {
  void (async () => {
    const frameId = details.frameId === 0 ? undefined : details.frameId;
    await session.remove(await countKeys(details.tabId, frameId));
    if (frameId === undefined) await refresh(details.tabId);
  })();
});

chrome.webNavigation.onDOMContentLoaded.addListener((details) => {
  void (async () => {
    if (!(await isOn(details.tabId))) return;
    try {
      await inject(details.tabId, [details.frameId]);
    } catch {
      // A frame extensions may not script, or one that has navigated again.
    }
  })();
});

chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId === 0) void refresh(details.tabId);
});

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const tabId = details.tabId;
    if (!isPdfResponse(details.responseHeaders)) {
      void session.remove(pdfKey(tabId));
      return;
    }
    void (async () => {
      await session.set({ [pdfKey(tabId)]: details.url });
      const settings = await loadSettings();
      if (settings.pdfViewerUrl && (await isOn(tabId))) {
        await chrome.tabs.update(tabId, { url: viewerUrlFor(settings.pdfViewerUrl, details.url) });
      }
    })();
  },
  { urls: ['<all_urls>'], types: ['main_frame'] },
  ['responseHeaders'],
);

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  const tabId = sender.tab?.id;
  if (tabId === undefined || sender.frameId === undefined || !isAnchorCountMessage(message)) {
    return;
  }
  void (async () => {
    if (!(await isOn(tabId))) return;
    await session.set({ [`${countPrefix(tabId)}${sender.frameId}`]: message.count });
    await refresh(tabId);
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    await session.remove([onKey(tabId), pdfKey(tabId), ...(await countKeys(tabId))]);
  })();
});
