// Fails when any production or development dependency carries a license
// outside the allowlist. The allowlist is documented for humans in
// docs/third-party-notices.md; this file is the one CI enforces.
import { execFileSync } from 'node:child_process';

const ALLOWED = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'Unlicense',
  'CC0-1.0',
  'CC-BY-4.0',
  'Python-2.0',
  'BlueOak-1.0.0',
  'MIT-0',
]);

// Packages whose license metadata is missing or non-standard but whose
// actual license has been checked by hand, and copyleft build- or test-time
// tooling admitted by ADR 0022 (nothing we distribute contains it). Keep
// this list short and dated.
const EXCEPTIONS = new Map([
  // ['package-name', 'reason, checked YYYY-MM-DD'],
  ['axe-core', 'MPL-2.0; accessibility tests only, ADR 0022, checked 2026-10-30'],
  ['@axe-core/playwright', 'MPL-2.0; accessibility tests only, ADR 0022, checked 2026-10-30'],
  [
    'lightningcss',
    'MPL-2.0; CSS minifier run at build time by Vite 8, ADR 0022, checked 2026-10-30',
  ],
]);

/** Platform binaries of an excepted package (`lightningcss-darwin-arm64` and the like). */
function excepted(name) {
  if (EXCEPTIONS.has(name)) return true;
  for (const base of EXCEPTIONS.keys()) if (name.startsWith(`${base}-`)) return true;
  return false;
}

function allowedExpression(expr) {
  // Handles plain identifiers and simple "A OR B" / "(A OR B)" expressions.
  const cleaned = expr.replace(/[()]/g, '').trim();
  if (cleaned.includes(' OR ')) return cleaned.split(' OR ').some((e) => ALLOWED.has(e.trim()));
  if (cleaned.includes(' AND ')) return cleaned.split(' AND ').every((e) => ALLOWED.has(e.trim()));
  return ALLOWED.has(cleaned);
}

const raw = execFileSync('pnpm', ['licenses', 'list', '--json', '--long'], { encoding: 'utf8' });
const byLicense = JSON.parse(raw);
const failures = [];
for (const [license, pkgs] of Object.entries(byLicense)) {
  if (allowedExpression(license)) continue;
  for (const pkg of pkgs) {
    if (excepted(pkg.name)) continue;
    failures.push(`${pkg.name}@${pkg.versions?.join(',') ?? '?'}: ${license}`);
  }
}
if (failures.length > 0) {
  console.error('Dependencies with licenses outside the allowlist:');
  for (const f of failures) console.error(`  ${f}`);
  console.error('\nEither replace the dependency or record an exception with a reason.');
  process.exit(1);
}
console.log(
  `License check passed (${Object.keys(byLicense).length} distinct license expressions).`,
);
