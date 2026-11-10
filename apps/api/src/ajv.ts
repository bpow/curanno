/**
 * The Ajv instances the server validates with (ADR 0003, ADR 0011). Request
 * bodies are validated strictly: nothing is coerced or removed, so JSON-LD
 * extension properties reach the handlers unchanged and clients learn about
 * mistakes instead of having them silently fixed. Query strings, path and
 * header parameters arrive as strings and are coerced to the document's
 * types with defaults applied. Body profiles compile on the strict instance.
 */
import { Ajv2020, type Options } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { addAnnotationFormats, addProfileKeywords } from '@curanno/model';

const common: Options = {
  allErrors: true,
  removeAdditional: false,
  addUsedSchema: false,
  allowUnionTypes: true,
  strictTypes: false,
};

export function createStrictAjv(): Ajv2020 {
  return withFormats(new Ajv2020({ ...common, coerceTypes: false, useDefaults: false }));
}

export function createCoercingAjv(): Ajv2020 {
  return withFormats(new Ajv2020({ ...common, coerceTypes: 'array', useDefaults: true }));
}

function withFormats(ajv: Ajv2020): Ajv2020 {
  addFormats.default(ajv);
  return addProfileKeywords(addAnnotationFormats(ajv));
}
