import type { Body, BodyProfile, Motivation, ValidationError } from '@scale/model';
import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';
import { useApi } from '../api/client';
import { toProblem, unwrap, type Problem } from '../api/problems';
import { createRegistry, toModelProfile } from '../profiles/schema';

export const useProfilesStore = defineStore('profiles', () => {
  const profiles = shallowRef<BodyProfile[]>([]);
  const registry = shallowRef(createRegistry([]));
  const problem = ref<Problem>();
  const loaded = ref(false);

  async function load(): Promise<void> {
    try {
      const data = unwrap(await useApi().GET('/x/profiles'));
      profiles.value = data.filter((p) => p.enabled).map(toModelProfile);
      registry.value = createRegistry(profiles.value);
      problem.value = undefined;
      loaded.value = true;
    } catch (err) {
      problem.value = toProblem(err);
    }
  }

  function byIri(iri: string): BodyProfile | undefined {
    return registry.value.get(iri);
  }

  /** Validation errors for one body; empty when it is valid or no profile applies. */
  function validate(body: Body): ValidationError[] {
    const result = registry.value.validate(body);
    return result && !result.ok ? result.errors : [];
  }

  function purposeOf(iri: string): Motivation | undefined {
    return byIri(iri)?.purposes?.[0];
  }

  return { profiles, registry, problem, loaded, load, byIri, validate, purposeOf };
});
