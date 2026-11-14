import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { currentUserIri, forgetCurrentUser } from './current-user';
import { installFakeApi, json, type FakeApi } from './test/fake-api';

let meId: string | undefined;
let api: FakeApi;

beforeEach(() => {
  setActivePinia(createPinia());
  forgetCurrentUser();
  meId = 'u-1';
  api = installFakeApi(({ url }) => {
    if (url.pathname !== '/x/me') return undefined;
    if (!meId) return json({ status: 401, title: 'Unauthorized' }, { status: 401 });
    return json({
      id: meId,
      iri: `https://annotations.test/curanno/x/users/${meId}`,
      isAdmin: false,
      created: '2026-01-01T00:00:00Z',
    });
  });
});

describe('currentUserIri', () => {
  it('is the IRI the server names the user by, asked once per identity', async () => {
    expect(await currentUserIri()).toBe('https://annotations.test/curanno/x/users/u-1');
    await currentUserIri();
    expect(api.calls).toHaveLength(1);
    forgetCurrentUser();
    meId = 'u-2';
    expect(await currentUserIri()).toBe('https://annotations.test/curanno/x/users/u-2');
  });

  it('asks again after a failure', async () => {
    meId = undefined;
    expect(await currentUserIri()).toBeUndefined();
    meId = 'u-3';
    expect(await currentUserIri()).toBe('https://annotations.test/curanno/x/users/u-3');
  });
});
