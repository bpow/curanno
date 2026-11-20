/**
 * Body profile registry: JSON Schemas registered against profile IRIs and
 * purposes, used to validate structured bodies (docs/body-profiles.md).
 */
export {
  PROFILE_BASE,
  builtinProfiles,
  caseDiseaseProfile,
  caseFamilyProfile,
  caseIndividualProfile,
  casePhenotypesProfile,
  caseTestingProfile,
  caseVariantProfile,
  evidenceExcerptProfile,
  individualProfile,
} from './builtin.js';
export {
  addProfileKeywords,
  isDerived,
  linkedIris,
  linkFieldsOf,
  givesIds,
  idFieldsOf,
  lookupContext,
  lookupFieldsOf,
  needsLookup,
  withLookedUp,
  withUnresolvable,
  type AnnotationLink,
  type SchemaLink,
  type KeywordRegistry,
  type OntologyLookup,
  type FieldLookup,
  type LookupField,
} from './keywords.js';
export {
  ProfileRegistry,
  type BodyProfile,
  type CompiledSchema,
  type SchemaCompiler,
  type ValidationError,
  type ValidationResult,
} from './registry.js';
export {
  LOCAL_PLACEHOLDER,
  checkItems,
  isLocalId,
  localLinks,
  replaceLocalIds,
  type ItemInput,
} from './batch-items.js';
export { summarizeIndividuals, type IndividualSummary, type Summaries } from './summary.js';
