import { onMounted, ref, shallowRef, watch, type WatchSource } from 'vue';
import { problemFrom, toProblem, type Problem } from '../api/problems';

interface Result<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

/**
 * One API read for a page or component: runs on mount and again whenever a
 * source changes, exposing the data, the problem the API reported, and a
 * pending flag. Later runs win over earlier ones that are still in flight.
 */
export function useRequest<T>(request: () => Promise<Result<T>>, sources: WatchSource[] = []) {
  const data = shallowRef<T | null>(null);
  const problem = ref<Problem | null>(null);
  const pending = ref(false);
  let latest = 0;

  async function run(): Promise<void> {
    const id = ++latest;
    pending.value = true;
    problem.value = null;
    try {
      const result = await request();
      if (id !== latest) return;
      if (result.error !== undefined || !result.response.ok) {
        problem.value = problemFrom(result.error, result.response);
        data.value = null;
      } else {
        data.value = result.data as T;
      }
    } catch (err) {
      if (id === latest) problem.value = toProblem(err);
    } finally {
      if (id === latest) pending.value = false;
    }
  }

  onMounted(run);
  if (sources.length > 0) watch(sources, () => void run());
  return { data, problem, pending, run };
}

/** Runs one write and reports its problem, if any, for forms and buttons. */
export function useAction() {
  const problem = ref<Problem | null>(null);
  const busy = ref(false);
  async function perform<T>(request: () => Promise<Result<T>>): Promise<T | undefined> {
    busy.value = true;
    problem.value = null;
    try {
      const result = await request();
      if (result.error !== undefined || !result.response.ok) {
        problem.value = problemFrom(result.error, result.response);
        return undefined;
      }
      return result.data;
    } catch (err) {
      problem.value = toProblem(err);
      return undefined;
    } finally {
      busy.value = false;
    }
  }
  return { problem, busy, perform };
}
