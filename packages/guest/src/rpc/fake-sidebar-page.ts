/**
 * The page that hosts the fake sidebar inside the guest's iframe, for the
 * dev placeholder and the browser tests. It performs the sidebar's half of
 * the handshake, shows the conversation, and offers the few actions a
 * sidebar takes. It also keeps pretend secrets in its own DOM and storage,
 * which the isolation test checks never reach the host page.
 */
import { framesBelow, isFrameOf, type AnchorRequest, type GuestMessage } from '@curanno/model';
import { FAKE_SECRETS, FakeSidebar } from './fake-sidebar.js';

declare global {
  interface Window {
    __fakeSidebar: FakeSidebar;
  }
}

const annotations: AnchorRequest[] = [];
let guestOrigin: string | undefined;
let counter = 0;

const log = document.createElement('pre');
log.id = 'log';
const status = document.createElement('p');
status.id = 'status';
status.textContent = 'Waiting for a guest…';
const list = document.createElement('ul');
list.id = 'annotations';
const secret = document.createElement('p');
secret.id = 'secret';
secret.textContent = FAKE_SECRETS.body;
try {
  localStorage.setItem('token', FAKE_SECRETS.token);
} catch {
  // Storage can be unavailable; the token is a stand-in anyway.
}

const sidebar = new FakeSidebar({ onMessage: show });
window.__fakeSidebar = sidebar;

function show(message: GuestMessage): void {
  const line = JSON.stringify(message);
  log.textContent = `${log.textContent ?? ''}${line.length > 300 ? line.slice(0, 300) + '…' : line}\n`;
  log.scrollTop = log.scrollHeight;
  if (message.type === 'selection.changed') {
    annotate.disabled = message.selection === null;
  }
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

const annotate = button('Annotate selection', () => {
  const selection = sidebar.selection;
  if (!selection) return;
  const id = `urn:fake:${++counter}`;
  const request: AnchorRequest = { id, target: selection.target };
  annotations.push(request);
  sidebar.clearSelection();
  sidebar.anchor([request]);
  const item = document.createElement('li');
  item.textContent = `${id} “${selection.quote.slice(0, 40)}” `;
  item.append(
    button('focus', () => sidebar.focus([id])),
    button('scroll', () => sidebar.scrollTo(id)),
    button('remove', () => {
      sidebar.unanchor([id]);
      item.remove();
    }),
  );
  list.appendChild(item);
});
annotate.disabled = true;

document.body.append(
  status,
  annotate,
  button('Unfocus', () => sidebar.focus([])),
  button('Close sidebar', () => sidebar.send({ type: 'sidebar.close' })),
  list,
  log,
  secret,
);

// As the real sidebar: the parent's guest and those of the top page's other frames (ADR 0024).
const top = window.top;
const servesFrames = top !== null && window.parent === top;
window.addEventListener('message', (event) => {
  const fromPage = servesFrames && event.source !== window && isFrameOf(event.source, top);
  if (event.source !== window.parent && !fromPage) return;
  const port = event.ports[0];
  if (!FakeSidebar.isConnect(event.data) || !port) return;
  guestOrigin = event.origin;
  sidebar.attach(port);
  status.textContent = `Connected to a guest at ${guestOrigin}`;
});
window.parent.postMessage(sidebar.readyMessage(), '*');
const announce = (): void => {
  if (!servesFrames) return;
  for (const frame of framesBelow(top)) {
    try {
      frame.postMessage(sidebar.readyMessage(), '*');
    } catch {
      // Mid-navigation; the next round reaches it.
    }
  }
};
announce();
setInterval(announce, 1000);
