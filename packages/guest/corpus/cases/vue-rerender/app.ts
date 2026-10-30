/**
 * Vue counterpart of the React re-render case, rendering the same data
 * through the same page structure. See react-rerender/app.tsx.
 */
import { createApp, h, nextTick, ref, type VNode } from 'vue';
import { dataset, type Issue } from '../react-rerender/data.ts';

const params = new URLSearchParams(location.search);
const version = ref(Number(params.get('data') ?? '1'));
const keyPrefix = ref('');
let generation = 0;

function issueNode(issue: Issue, i: number): VNode {
  const children: VNode[] = [
    h('h2', `#${issue.id} ${issue.title}`),
    h('p', { class: 'meta' }, `opened by ${issue.author} · ${issue.state}`),
    h('p', issue.pinned ? [h('strong', 'Pinned. '), issue.body] : [issue.body]),
  ];
  if (issue.comments.length > 0) {
    children.push(
      h(
        'ul',
        issue.comments.map((c, j) =>
          h('li', { key: `${keyPrefix.value}${i}-${j}` }, [
            h('strong', `${c.author}:`),
            ` ${c.text}`,
          ]),
        ),
      ),
    );
  }
  return h(
    'article',
    { class: 'issue', key: `${keyPrefix.value}${i}`, 'data-issue-id': issue.id },
    children,
  );
}

const app = createApp({
  setup() {
    return () => {
      const issues = dataset(version.value);
      return h('main', [
        h('h1', 'Issue tracker'),
        h('p', { class: 'toolbar' }, [
          h('button', { type: 'button' }, 'New issue'),
          h('button', { type: 'button' }, 'Filter'),
          `${issues.length} issues`,
        ]),
        ...issues.map(issueNode),
      ]);
    };
  },
});

declare global {
  interface Window {
    __app: { render: (version: number, keyPrefix?: string) => void; rerender: () => void };
  }
}

window.__app = {
  render: (v, prefix = '') => {
    version.value = v;
    keyPrefix.value = prefix;
  },
  rerender: () => {
    keyPrefix.value = `g${++generation}-`;
  },
};

document.documentElement.dataset['trialWait'] = '';
app.mount('#root');
if (params.get('remount')) window.__app.rerender();
void nextTick(() => {
  document.documentElement.dataset['trialReady'] = '';
});
