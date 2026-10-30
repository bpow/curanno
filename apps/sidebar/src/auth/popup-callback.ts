/**
 * Entry point of popup-callback.html: the popup window the provider returns
 * to after a framed sign-in or sign-out. The authorization code (never a
 * token) goes back to the opener on this same origin, which exchanges it.
 */
import { loadConfig } from '../config';
import { createUserManager } from './user-manager';

await loadConfig();
const manager = createUserManager();
const params = new URLSearchParams(window.location.search);
const isSignin = params.has('code') || params.has('error');
const done = isSignin ? manager.signinPopupCallback() : manager.signoutPopupCallback();
done.catch((err: unknown) => {
  document.body.textContent = `Sign-in failed: ${err instanceof Error ? err.message : String(err)}`;
});
