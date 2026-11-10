import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { installFakeApi, json } from '../test/fake-api';
import { useProfilesStore } from './profiles';

const listed = (iri: string, defaultPurpose?: string) => ({
  iri,
  title: iri,
  schema: { type: 'object' },
  builtin: false,
  enabled: true,
  ...(defaultPurpose ? { defaultPurpose } : {}),
});

describe('profiles store', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    installFakeApi(({ url }) =>
      url.pathname === '/x/profiles'
        ? json([
            listed('https://example.org/a/1', 'describing'),
            listed('https://example.org/b/1', 'describing'),
            listed('https://example.org/c/1'),
          ])
        : undefined,
    );
    await useProfilesStore().load();
  });

  it("gives new bodies the profile's default purpose, which profiles may share", () => {
    const profiles = useProfilesStore();
    expect(profiles.purposeOf('https://example.org/a/1')).toBe('describing');
    expect(profiles.purposeOf('https://example.org/b/1')).toBe('describing');
    expect(profiles.purposeOf('https://example.org/c/1')).toBeUndefined();
  });
});
