/** Entry point of silent-renew.html, loaded in a hidden iframe to renew tokens. */
import { loadConfig } from '../config';
import { createUserManager } from './user-manager';

await loadConfig();
void createUserManager().signinSilentCallback();
