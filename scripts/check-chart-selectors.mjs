// Fails when a selector in the rendered Helm chart matches pods of a workload
// other than its own: a Deployment's or StatefulSet's selector must match only
// its own pods, and a Service's only one workload's. Kubernetes cannot change a
// workload's selector after it is created, so an overlap is caught here rather
// than after it ships.
//
//   helm template ci deploy/helm/curanno ... | yq -o=json -I=0 'select(.kind != null)' | node scripts/check-chart-selectors.mjs
import { readFileSync } from 'node:fs';

const docs = readFileSync(0, 'utf8')
  .split('\n')
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line));

const podLabels = (doc) =>
  doc.kind === 'CronJob'
    ? doc.spec?.jobTemplate?.spec?.template?.metadata?.labels
    : doc.spec?.template?.metadata?.labels;

const workloads = docs
  .filter((d) => ['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob'].includes(d.kind))
  .map((d) => ({ id: `${d.kind}/${d.metadata.name}`, labels: podLabels(d) ?? {} }));

const matches = (selector, labels) =>
  Object.entries(selector).every(([key, value]) => labels[key] === value);

const problems = [];
for (const doc of docs) {
  const id = `${doc.kind}/${doc.metadata.name}`;
  const controller = ['Deployment', 'StatefulSet', 'DaemonSet'].includes(doc.kind);
  if (!controller && !(doc.kind === 'Service' && doc.spec?.selector)) continue;
  const selector = controller ? doc.spec?.selector?.matchLabels : doc.spec.selector;
  if (!selector || Object.keys(selector).length === 0) {
    problems.push(`${id} has an empty selector`);
    continue;
  }
  const matched = workloads.filter((w) => matches(selector, w.labels)).map((w) => w.id);
  if (matched.length === 0) problems.push(`${id} selects no pods`);
  else if (controller ? matched.some((w) => w !== id) : matched.length > 1)
    problems.push(`${id} selects pods of ${matched.join(', ')}`);
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`${workloads.length} workloads, no overlapping selectors`);
