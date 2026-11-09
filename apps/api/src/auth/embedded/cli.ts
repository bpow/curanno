/**
 * Operator commands for the embedded issuer (ADR 0028), run from the built
 * server: the first administrator has to come from somewhere.
 *
 *   node dist/auth/embedded/cli.js create --login you@example.org [--name "Your Name"] [--admin]
 *   node dist/auth/embedded/cli.js set-password --login you@example.org
 *   node dist/auth/embedded/cli.js invite --email someone@example.org [--admin]
 *   node dist/auth/embedded/cli.js rotate-key
 *
 * The password is read from ACCOUNT_PASSWORD, from a pipe, or typed at a
 * prompt that does not echo; never from an argument, which `ps` would show.
 */
import { parseArgs } from 'node:util';
import { loadConfig } from '../../config.js';
import { createDb } from '../../db/index.js';
import { AccountError, createPasswordUser, setPassword } from './accounts.js';
import { createInvite } from './invites.js';
import { rotateSigningKey } from './keys.js';

async function readPassword(): Promise<string> {
  const fromEnv = process.env['ACCOUNT_PASSWORD'];
  if (fromEnv) return fromEnv;
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    let text = '';
    for await (const chunk of stdin) text += String(chunk);
    return text.split('\n')[0] ?? '';
  }
  process.stderr.write('Password: ');
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve) => {
    let typed = '';
    stdin.on('data', function onData(chunk: string) {
      for (const char of chunk) {
        if (char === '\r' || char === '\n' || char === '\u0004') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stderr.write('\n');
          resolve(typed);
          return;
        }
        if (char === '\u0003') process.exit(130);
        typed = char === '\u007f' ? typed.slice(0, -1) : typed + char;
      }
    });
  });
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    login: { type: 'string' },
    name: { type: 'string' },
    email: { type: 'string' },
    admin: { type: 'boolean', default: false },
  },
});

const config = loadConfig();
if (config.auth.mode !== 'embedded' || !config.auth.secret) {
  console.error('These commands are for AUTH_MODE=embedded.');
  process.exit(2);
}
const db = createDb(config.databaseUrl);
let code = 0;
try {
  switch (positionals[0]) {
    case 'create': {
      if (!values.login) throw new AccountError('--login is required');
      const id = await createPasswordUser(db, config.oidc.issuer, {
        login: values.login,
        password: await readPassword(),
        displayName: values.name,
        email: values.email,
        // The operator vouches for the address they type.
        emailVerified: true,
        isAdmin: values.admin,
      });
      console.log(`Created ${values.admin ? 'administrator' : 'user'} ${values.login} (${id}).`);
      break;
    }
    case 'set-password': {
      if (!values.login) throw new AccountError('--login is required');
      if (!(await setPassword(db, values.login, await readPassword()))) {
        throw new AccountError(`No user has the login ${values.login}`);
      }
      console.log(`Changed the password of ${values.login}.`);
      break;
    }
    case 'invite': {
      if (!values.email) throw new AccountError('--email is required');
      const link = await createInvite(db, config.publicUrl, {
        email: values.email,
        isAdmin: values.admin,
      });
      console.log(`Give ${values.email} this link; it works once, for a week:\n${link}`);
      break;
    }
    case 'rotate-key': {
      const kid = await rotateSigningKey(db, config.auth.secret);
      console.log(`New signing key ${kid}. Restart the API so that it signs with it.`);
      break;
    }
    default:
      console.error(
        'Usage: cli.js create|set-password|invite|rotate-key [--login L] [--name N] [--email E] [--admin]',
      );
      code = 2;
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  code = 1;
} finally {
  await db.destroy();
}
process.exit(code);
