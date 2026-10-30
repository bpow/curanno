/** Entry point of silent-renew.html, loaded in a hidden iframe to renew tokens. */
import { createUserManager } from './user-manager';

void createUserManager().signinSilentCallback();
