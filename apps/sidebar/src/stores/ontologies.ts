import type { components } from '@curanno/api-client';
import { defineStore } from 'pinia';
import { shallowRef } from 'vue';
import { useApi } from '../api/client';
import { unwrap } from '../api/problems';

export type Ontology = components['schemas']['Ontology'];

/** The loaded ontology releases, for the attribution their licenses ask for (docs/ontologies.md). */
export const useOntologiesStore = defineStore('ontologies', () => {
  const ontologies = shallowRef<Ontology[]>([]);
  let loading: Promise<void> | undefined;

  /** Loads the list once; a failure leaves it empty and lets a later call try again. */
  function ensureLoaded(): Promise<void> {
    loading ??= (async () => {
      try {
        ontologies.value = unwrap(await useApi().GET('/x/ontologies'));
      } catch {
        loading = undefined;
      }
    })();
    return loading;
  }

  function byName(name: string): Ontology | undefined {
    return ontologies.value.find((o) => o.name === name);
  }

  return { ontologies, ensureLoaded, byName };
});
