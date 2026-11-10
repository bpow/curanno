/**
 * Imports an ontology release for term lookup (docs/ontologies.md). It needs
 * only DATABASE_URL, and replaces whatever was loaded under the same name.
 *
 *   node dist/ontologies/cli.js import hp path/to/hp.json [--homepage <url>]
 *   node dist/ontologies/cli.js list
 *
 * --homepage is where the attribution sends users, for a release that does
 * not name one (HPO's does not).
 */
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createDb } from '../db/index.js';
import { parseOboGraph } from './obographs.js';
import { importOntology, listOntologies } from './service.js';

const usage =
  'Usage: cli.js import <name> <obographs.json> [--homepage <url>] | cli.js list  (DATABASE_URL must be set)';
const { values, positionals } = parseArgs({
  options: { homepage: { type: 'string' } },
  allowPositionals: true,
});
const [command, name, file] = positionals;
const url = process.env['DATABASE_URL'];
if (!url || !(command === 'list' || (command === 'import' && name && file))) {
  console.error(usage);
  process.exit(2);
}
if (command === 'import' && !/^[a-z][a-z0-9]*$/.test(name as string)) {
  console.error(`The name is the ontology's CURIE prefix in lower case, such as hp, not ${name}`);
  process.exit(2);
}
if (values.homepage !== undefined && !/^https?:\/\//.test(values.homepage)) {
  console.error(`--homepage must be an http or https URL, not ${values.homepage}`);
  process.exit(2);
}

const db = createDb(url);
let code = 0;
try {
  if (command === 'import') {
    const parsed = parseOboGraph(
      JSON.parse(await readFile(file as string, 'utf8')),
      (name as string).toUpperCase(),
    );
    if (parsed.terms.length === 0) throw new Error(`No ${name} terms in ${file}`);
    await importOntology(db, name as string, {
      ...parsed,
      homepage: values.homepage ?? parsed.homepage,
    });
    console.log(`Imported ${parsed.terms.length} terms of ${name} ${parsed.version ?? ''}`.trim());
  } else {
    for (const o of await listOntologies(db)) {
      console.log(
        `${o.name}\t${o.version ?? '-'}\t${o.terms} terms\tloaded ${o.loaded}\t${o.title}\t${o.homepage ?? '-'}`,
      );
    }
  }
} catch (err) {
  console.error((err as Error).message);
  code = 1;
} finally {
  await db.destroy();
}
process.exit(code);
