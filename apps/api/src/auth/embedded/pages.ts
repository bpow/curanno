/**
 * The few pages the provider itself renders: errors and sign-out. They carry
 * no scripts but the one hashed below, load nothing from elsewhere and say
 * little (ADR 0028).
 */
import { createHash } from 'node:crypto';

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

const STYLE =
  'body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5}';

function page(title: string, body: string, script = ''): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body><main><h1>${escapeHtml(title)}</h1>${body}</main>${script}</body></html>`;
}

export function errorPage(error: string, description: string | undefined): string {
  return page(
    'Sign-in problem',
    `<p>${escapeHtml(description ?? 'The request could not be completed.')}</p><p><small>${escapeHtml(error)}</small></p>`,
  );
}

export function signedOutPage(): string {
  return page('Signed out', '<p>You have been signed out.</p>');
}

const SUBMIT_SCRIPT = 'document.forms[0].submit()';
export const SUBMIT_SCRIPT_HASH = `'sha256-${createHash('sha256').update(SUBMIT_SCRIPT).digest('base64')}'`;

/** Sign-out confirms itself: the form is submitted by script, with a button when scripts are off. */
export function logoutPage(form: string): string {
  const withConfirm = form.replace(
    '</form>',
    '<input type="hidden" name="logout" value="yes"><noscript><button type="submit">Sign out</button></noscript></form>',
  );
  return page('Signing out', withConfirm, `<script>${SUBMIT_SCRIPT}</script>`);
}
