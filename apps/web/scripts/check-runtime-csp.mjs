/**
 * Checks that a running management site names the identity provider it was
 * started with in its Content-Security-Policy, and that this is the issuer
 * the browser is given. The issuer is set when the server starts, not when
 * the site is built, so CI starts the built image with an issuer other than
 * the default (code review of 2026-10-30, finding 5).
 *
 *   node apps/web/scripts/check-runtime-csp.mjs <site URL> <issuer>
 */
const [base, issuer] = process.argv.slice(2);
if (!base || !issuer) {
  console.error('usage: check-runtime-csp.mjs <site URL> <issuer>');
  process.exit(2);
}

async function get(path) {
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      return await fetch(new URL(path, base));
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

const problems = [];
// The server-rendered landing page and a page rendered in the browser.
for (const path of ['/', '/browse']) {
  const response = await get(path);
  const csp = response.headers.get('content-security-policy') ?? '';
  const directives = new Map(
    csp.split(';').map((d) => {
      const [name = '', ...sources] = d.trim().split(/\s+/);
      return [name, sources];
    }),
  );
  if (csp.includes('{{')) problems.push(`${path}: unfilled placeholder in ${csp}`);
  for (const name of ['connect-src', 'frame-src', 'form-action']) {
    if (!directives.get(name)?.includes(`${issuer}/`)) {
      problems.push(`${path}: ${name} does not allow ${issuer}/ (${csp})`);
    }
  }
  const body = await response.text();
  if (!body.includes(`oidcIssuer:${JSON.stringify(issuer)}`)) {
    problems.push(`${path}: the runtime configuration does not name ${issuer}`);
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(p);
  process.exit(1);
}
console.log(`the policy and the runtime configuration both name ${issuer}`);
