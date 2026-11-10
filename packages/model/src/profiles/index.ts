/**
 * Body profile registry: JSON Schemas registered against profile IRIs and
 * purposes, used to validate structured bodies (docs/body-profiles.md).
 */
export {
  PROFILE_BASE,
  builtinProfiles,
  caseIndividualProfile,
  evidenceExcerptProfile,
} from './builtin.js';
export {
  ProfileRegistry,
  isStructuredBody,
  isTextualBody,
  type BodyProfile,
  type CompiledSchema,
  type SchemaCompiler,
  type ValidationError,
  type ValidationResult,
} from './registry.js';
