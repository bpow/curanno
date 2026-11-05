/**
 * Creates (or brings up to date) the Zitadel project and the public client
 * the sidebar and the management site sign in as, and with --dev-users the
 * development users alice and bob. Idempotent: run it after every
 * `compose up`, or against a deployed instance with its own token.
 *
 * Zitadel generates client ids, so the id is printed and, with --write-env,
 * written there as OIDC_ISSUER and OIDC_CLIENT_ID. The compose stack writes
 * deploy/zitadel/.bootstrap/oidc.env, which development falls back to. In a
 * cluster, --write-configmap stores the two in a ConfigMap of the pod's
 * namespace through its service account (the curanno chart's hook Job).
 *
 *   node deploy/zitadel/provision.ts --dev-users --write-env .env
 *   node deploy/zitadel/provision.ts --issuer https://idp.example \
 *     --pat-file admin.pat --origin https://annotations.example
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    issuer: { type: 'string', default: 'http://localhost:8080' },
    'pat-file': {
      type: 'string',
      default: new URL('.bootstrap/admin.pat', import.meta.url).pathname,
    },
    // Where the API serves the sidebar (/sidebar/) and the site runs (/).
    origin: { type: 'string', multiple: true },
    'dev-users': { type: 'boolean', default: false },
    'write-env': { type: 'string' },
    'write-configmap': { type: 'string' },
  },
});

const DEV_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
];
const origins = args.origin ?? DEV_ORIGINS;
const issuer = args.issuer.replace(/\/$/, '');
const token = readFileSync(args['pat-file'], 'utf8').trim();

const PROJECT_ID = 'annotations';
const APPLICATION_ID = 'annotations-web';

/**
 * One Connect-protocol call. A create of something that exists, or an update
 * that changes nothing, is not an error here; the error code for either
 * varies by resource, so the message is matched.
 */
async function call(method: string, body: object): Promise<Record<string, unknown>> {
  const res = await fetch(`${issuer}/${method}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown> & { message?: string };
  if (res.ok) return json;
  const message = json.message ?? '';
  if (/AlreadyExist/.test(message)) return { alreadyExists: true };
  if (/No ?Changes?/i.test(message)) return {};
  throw new Error(`${method}: ${res.status} ${JSON.stringify(json)}`);
}

// Every redirect URI is exact: Zitadel has no wildcards.
const redirectUris = origins.flatMap((o) => [
  `${o}/sidebar/`,
  `${o}/sidebar/popup-callback.html`,
  `${o}/sidebar/silent-renew.html`,
  `${o}/auth/callback`,
]);
const postLogoutRedirectUris = origins.flatMap((o) => [
  `${o}/sidebar/`,
  `${o}/sidebar/popup-callback.html`,
  `${o}/`,
]);
const oidcConfiguration = {
  redirectUris,
  postLogoutRedirectUris,
  responseTypes: ['OIDC_RESPONSE_TYPE_CODE'],
  grantTypes: ['OIDC_GRANT_TYPE_AUTHORIZATION_CODE', 'OIDC_GRANT_TYPE_REFRESH_TOKEN'],
  applicationType: 'OIDC_APP_TYPE_USER_AGENT',
  authMethodType: 'OIDC_AUTH_METHOD_TYPE_NONE',
  // The API verifies access tokens locally against the JWKS (ADR 0005).
  accessTokenType: 'OIDC_TOKEN_TYPE_JWT',
  // Plain-http redirect URIs; only for local origins.
  developmentMode: origins.some((o) => o.startsWith('http:')),
};

const me = (await (
  await fetch(`${issuer}/oidc/v1/userinfo`, {
    headers: { authorization: `Bearer ${token}` },
  })
).json()) as { sub: string };
const { user } = (await call('zitadel.user.v2.UserService/GetUserByID', { userId: me.sub })) as {
  user: { details: { resourceOwner: string } };
};
const organizationId = user.details.resourceOwner;

await call('zitadel.project.v2.ProjectService/CreateProject', {
  organizationId,
  projectId: PROJECT_ID,
  name: 'Annotations',
});

const created = await call('zitadel.application.v2.ApplicationService/CreateApplication', {
  projectId: PROJECT_ID,
  applicationId: APPLICATION_ID,
  name: 'Annotations (sidebar and management site)',
  oidcConfiguration,
});
if (created['alreadyExists']) {
  await call('zitadel.application.v2.ApplicationService/UpdateApplication', {
    projectId: PROJECT_ID,
    applicationId: APPLICATION_ID,
    oidcConfiguration,
  });
}
const { application } = (await call('zitadel.application.v2.ApplicationService/GetApplication', {
  applicationId: APPLICATION_ID,
})) as { application: { oidcConfiguration: { clientId: string } } };
const clientId = application.oidcConfiguration.clientId;

if (args['dev-users']) {
  const users = [
    { username: 'alice', givenName: 'Alice', familyName: 'Annotator' },
    { username: 'bob', givenName: 'Bob', familyName: 'Reviewer' },
  ];
  for (const u of users) {
    await call('zitadel.user.v2.UserService/AddHumanUser', {
      userId: u.username,
      organization: { orgId: organizationId },
      username: u.username,
      profile: { givenName: u.givenName, familyName: u.familyName },
      email: { email: `${u.username}@example.test`, isVerified: true },
      password: { password: u.username, changeRequired: false },
    });
  }
}

const settings = { OIDC_ISSUER: issuer, OIDC_CLIENT_ID: clientId };
for (const [key, value] of Object.entries(settings)) console.log(`${key}=${value}`);

const envFile = args['write-env'];
if (envFile) {
  let text = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
  for (const [key, value] of Object.entries(settings)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    text = pattern.test(text)
      ? text.replace(pattern, line)
      : `${text.replace(/\n?$/, '\n')}${line}\n`;
  }
  writeFileSync(envFile, text.replace(/^\n/, ''));
  console.log(`wrote ${Object.keys(settings).join(' and ')} to ${envFile}`);
}

const configMap = args['write-configmap'];
if (configMap) {
  // The API server's CA comes from NODE_EXTRA_CA_CERTS, set by the Job.
  const account = '/var/run/secrets/kubernetes.io/serviceaccount';
  const namespace = readFileSync(`${account}/namespace`, 'utf8').trim();
  const url = new URL(
    `https://kubernetes.default.svc/api/v1/namespaces/${namespace}/configmaps/${configMap}`,
  );
  url.search = new URLSearchParams({ fieldManager: 'zitadel-provision', force: 'true' }).toString();
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${readFileSync(`${account}/token`, 'utf8').trim()}`,
      'content-type': 'application/apply-patch+yaml',
    },
    body: JSON.stringify({
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: { name: configMap },
      data: settings,
    }),
  });
  if (!res.ok) throw new Error(`ConfigMap ${configMap}: ${res.status} ${await res.text()}`);
  console.log(`wrote ${Object.keys(settings).join(' and ')} to ConfigMap ${configMap}`);
}
