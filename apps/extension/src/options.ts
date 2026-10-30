/** The options page: edits the settings in `chrome.storage.sync`. */
import { loadSettings, saveSettings, validateSettings, type Settings } from './settings.js';

const form = document.getElementById('settings') as HTMLFormElement;
const status = document.getElementById('status') as HTMLElement;
const TEXT_FIELDS = ['sidebarUrl', 'apiUrl', 'pdfViewerUrl'] as const;

function input(name: string): HTMLInputElement {
  return form.elements.namedItem(name) as HTMLInputElement;
}

function read(): Settings {
  return {
    sidebarUrl: input('sidebarUrl').value.trim(),
    apiUrl: input('apiUrl').value.trim(),
    pdfViewerUrl: input('pdfViewerUrl').value.trim(),
    publicCounts: input('publicCounts').checked,
  };
}

async function load(): Promise<void> {
  const settings = await loadSettings();
  for (const name of TEXT_FIELDS) input(name).value = settings[name];
  input('publicCounts').checked = settings.publicCounts;
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const settings = read();
  const problems = validateSettings(settings);
  for (const name of TEXT_FIELDS) {
    const problem = problems[name] ?? '';
    (document.getElementById(`${name}-error`) as HTMLElement).textContent = problem;
    input(name).setAttribute('aria-invalid', problem ? 'true' : 'false');
  }
  const first = TEXT_FIELDS.find((name) => problems[name]);
  if (first) {
    input(first).focus();
    status.textContent = '';
    return;
  }
  void saveSettings(settings).then(() => {
    status.textContent = 'Saved. Tabs where the guest is on pick this up when they next load.';
  });
});

void load();
