/**
 * Minimal React app for the re-render cases. `?data=N` picks the dataset;
 * `?remount=1` renders the data, then re-renders it with new keys after
 * load so every DOM node is replaced while the text stays the same.
 * `window.__app.render(n, keyPrefix)` lets the highlight trial re-render.
 */
import { createRoot } from 'react-dom/client';
import { dataset, type Issue } from './data.ts';

function App({ issues, keyPrefix }: { issues: Issue[]; keyPrefix: string }) {
  return (
    <main>
      <h1>Issue tracker</h1>
      <p className="toolbar">
        <button type="button">New issue</button>
        <button type="button">Filter</button>
        {issues.length} issues
      </p>
      {issues.map((issue, i) => (
        <article className="issue" key={`${keyPrefix}${i}`} data-issue-id={issue.id}>
          <h2>
            #{issue.id} {issue.title}
          </h2>
          <p className="meta">
            opened by {issue.author} · {issue.state}
          </p>
          <p>
            {issue.pinned && <strong>Pinned. </strong>}
            {issue.body}
          </p>
          {issue.comments.length > 0 && (
            <ul>
              {issue.comments.map((c, j) => (
                <li key={`${keyPrefix}${i}-${j}`}>
                  <strong>{c.author}:</strong> {c.text}
                </li>
              ))}
            </ul>
          )}
        </article>
      ))}
    </main>
  );
}

const params = new URLSearchParams(location.search);
const root = createRoot(document.getElementById('root')!);
let generation = 0;

function render(version: number, keyPrefix = '') {
  root.render(<App issues={dataset(version)} keyPrefix={keyPrefix} />);
}

declare global {
  interface Window {
    __app: { render: (version: number, keyPrefix?: string) => void; rerender: () => void };
  }
}

window.__app = {
  render,
  rerender: () => render(Number(params.get('data') ?? '1'), `g${++generation}-`),
};

document.documentElement.dataset['trialWait'] = '';
render(Number(params.get('data') ?? '1'));
queueMicrotask(() => {
  if (params.get('remount')) window.__app.rerender();
  // React commits synchronously for root.render outside an event, but wait a
  // frame so the runner never races the commit.
  requestAnimationFrame(() => {
    document.documentElement.dataset['trialReady'] = '';
  });
});
