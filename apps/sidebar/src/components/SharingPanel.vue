<script setup lang="ts">
import {
  type AclEntry,
  type PrincipalRef,
  toProblem,
  unwrap,
  type Problem,
} from '@curanno/api-client';
import type { Permission } from '@curanno/model';
import { onMounted, ref } from 'vue';
import { useApi } from '../api/client';
import AclEditor from './AclEditor.vue';
import ProblemAlert from './ProblemAlert.vue';

const props = defineProps<{
  /** The annotation's identifier (the path parameter, not the IRI). */
  annotationId: string;
  /** The creator's user id; the creator keeps every permission. */
  creatorId?: string | undefined;
}>();

const api = useApi();
const entries = ref<AclEntry[]>([]);
const problem = ref<Problem>();
const busy = ref(false);

async function load(): Promise<void> {
  busy.value = true;
  try {
    entries.value = unwrap(
      await api.GET('/x/annotations/{id}/acl', { params: { path: { id: props.annotationId } } }),
    );
    problem.value = undefined;
  } catch (err) {
    problem.value = toProblem(err);
  } finally {
    busy.value = false;
  }
}

async function toggle(principal: PrincipalRef, permission: Permission, grant: boolean) {
  busy.value = true;
  try {
    if (grant) {
      const entry = unwrap(
        await api.POST('/x/annotations/{id}/acl', {
          params: { path: { id: props.annotationId } },
          body: { principal: principal.id, permission },
        }),
      );
      entries.value = [...entries.value, entry];
    } else {
      unwrap(
        await api.DELETE('/x/annotations/{id}/acl/{principalId}/{permission}', {
          params: { path: { id: props.annotationId, principalId: principal.id, permission } },
        }),
      );
      entries.value = entries.value.filter(
        (e) => !(e.principal.id === principal.id && e.permission === permission),
      );
    }
    problem.value = undefined;
  } catch (err) {
    problem.value = toProblem(err);
  } finally {
    busy.value = false;
  }
}

onMounted(() => void load());
</script>

<template>
  <section class="sharing" aria-label="Sharing">
    <AclEditor :entries="entries" :locked-id="creatorId" :busy="busy" @toggle="toggle" />
    <ProblemAlert :problem="problem" />
  </section>
</template>

<style scoped>
.sharing {
  margin: 0.4rem 0;
  padding: 0.5rem;
  border: 1px solid var(--border);
  border-radius: 4px;
  display: grid;
  gap: 0.5rem;
}
</style>
