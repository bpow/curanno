/**
 * TypeScript types for the W3C Web Annotation Data Model
 * (https://www.w3.org/TR/annotation-model/) as serialised in JSON-LD with
 * the standard context, plus this platform's two extensions: structured
 * bodies validated against a registered profile, and anchoring state on
 * targets (ADR 0010). Property names follow the W3C JSON-LD serialisation
 * exactly so that documents round-trip without renaming.
 */

export const WEB_ANNOTATION_CONTEXT = 'http://www.w3.org/ns/anno.jsonld';

/**
 * Namespace of the extension terms (`StructuredBody`, `profile`,
 * `anchoring`, `permissions`). The host name is provisional, like the
 * project name; the terms are fixed so that annotations from different
 * deployments share a vocabulary. The context document that defines them is
 * served by each deployment at `/x/context.jsonld` (`context.ts`).
 */
export const EXTENSION_NAMESPACE = 'https://curanno.example/ns/anno#';

export type JsonLdContextValue = string | Record<string, unknown>;
export type JsonLdContext = JsonLdContextValue | JsonLdContextValue[];

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** One or many, as JSON-LD allows for most properties. */
export type OneOrMany<T> = T | T[];

export const MOTIVATIONS = [
  'assessing',
  'bookmarking',
  'classifying',
  'commenting',
  'describing',
  'editing',
  'highlighting',
  'identifying',
  'linking',
  'moderating',
  'questioning',
  'replying',
  'tagging',
] as const;

export type StandardMotivation = (typeof MOTIVATIONS)[number];
/** A standard motivation or an IRI naming an extension motivation. */
export type Motivation = StandardMotivation | (string & {});
/** Body purposes draw from the same vocabulary as motivations. */
export type Purpose = Motivation;

export type AgentType = 'Person' | 'Organization' | 'Software';

export interface Agent {
  id?: string;
  type?: OneOrMany<AgentType>;
  name?: OneOrMany<string>;
  nickname?: string;
  email?: OneOrMany<string>;
  email_sha1?: OneOrMany<string>;
  homepage?: OneOrMany<string>;
}

export type ResourceClass = 'Dataset' | 'Image' | 'Video' | 'Sound' | 'Text';
export type TextDirection = 'ltr' | 'rtl' | 'auto';

/** A body or target identified by IRI, with optional description. */
export interface ExternalResource {
  id: string;
  type?: OneOrMany<ResourceClass | (string & {})>;
  format?: OneOrMany<string>;
  language?: OneOrMany<string>;
  processingLanguage?: string;
  textDirection?: TextDirection;
  accessibility?: OneOrMany<string>;
  rights?: OneOrMany<string>;
  canonical?: string;
  via?: OneOrMany<string>;
}

// ---------------------------------------------------------------------------
// Selectors

export interface TextQuoteSelector {
  type: 'TextQuoteSelector';
  exact: string;
  prefix?: string;
  suffix?: string;
  refinedBy?: OneOrMany<Selector>;
}

/** Offsets count Unicode code points of the scope's normalized text (ADR 0012). */
export interface TextPositionSelector {
  type: 'TextPositionSelector';
  start: number;
  end: number;
  refinedBy?: OneOrMany<Selector>;
}

export interface FragmentSelector {
  type: 'FragmentSelector';
  value: string;
  conformsTo?: string;
  refinedBy?: OneOrMany<Selector>;
}

export interface CssSelector {
  type: 'CssSelector';
  value: string;
  refinedBy?: OneOrMany<Selector>;
}

export interface XPathSelector {
  type: 'XPathSelector';
  value: string;
  refinedBy?: OneOrMany<Selector>;
}

export interface DataPositionSelector {
  type: 'DataPositionSelector';
  start: number;
  end: number;
  refinedBy?: OneOrMany<Selector>;
}

export interface SvgSelector {
  type: 'SvgSelector';
  id?: string;
  value?: string;
  refinedBy?: OneOrMany<Selector>;
}

export interface RangeSelector {
  type: 'RangeSelector';
  startSelector: Selector;
  endSelector: Selector;
  refinedBy?: OneOrMany<Selector>;
}

export type Selector =
  | TextQuoteSelector
  | TextPositionSelector
  | FragmentSelector
  | CssSelector
  | XPathSelector
  | DataPositionSelector
  | SvgSelector
  | RangeSelector;

export type SelectorType = Selector['type'];

// ---------------------------------------------------------------------------
// States and specific resources

export interface TimeState {
  type: 'TimeState';
  sourceDate?: OneOrMany<string>;
  sourceDateStart?: string;
  sourceDateEnd?: string;
  cached?: OneOrMany<string>;
  refinedBy?: OneOrMany<State>;
}

export interface HttpRequestState {
  type: 'HttpRequestState';
  value: string;
  refinedBy?: OneOrMany<State>;
}

export type State = TimeState | HttpRequestState;

export interface SpecificResource {
  id?: string;
  type?: 'SpecificResource';
  source: string | ExternalResource;
  selector?: OneOrMany<Selector>;
  state?: OneOrMany<State>;
  styleClass?: OneOrMany<string>;
  renderedVia?: OneOrMany<string | Agent>;
  scope?: OneOrMany<string>;
  purpose?: OneOrMany<Purpose>;
}

// ---------------------------------------------------------------------------
// Anchoring extension (ADR 0010)

export const ANCHORING_STATES = ['anchored', 'orphaned', 'ambiguous', 'repaired'] as const;
export type AnchoringState = (typeof ANCHORING_STATES)[number];

/**
 * A user's correction of an orphaned or ambiguous anchor. The selectors in
 * `selector` describe where the annotation now anchors; the target's own
 * `selector` keeps the originals and is never rewritten.
 */
export interface AnchoringRepair {
  selector: OneOrMany<Selector>;
  creator?: string | Agent;
  created: string;
}

export interface Anchoring {
  state: AnchoringState;
  repair?: AnchoringRepair;
}

/** A target as this platform stores it: a SpecificResource with anchoring state. */
export interface AnchoredTarget extends SpecificResource {
  anchoring?: Anchoring;
}

// ---------------------------------------------------------------------------
// Bodies

export interface TextualBody {
  type: 'TextualBody';
  value: string;
  id?: string;
  format?: string;
  language?: OneOrMany<string>;
  processingLanguage?: string;
  textDirection?: TextDirection;
  purpose?: OneOrMany<Purpose>;
  creator?: OneOrMany<string | Agent>;
  created?: string;
  modified?: string;
}

/**
 * Extension: an embedded JSON value validated against the JSON Schema that
 * the body profile registry maps `profile` to (see docs/body-profiles.md).
 */
export interface StructuredBody {
  type: 'StructuredBody';
  profile: string;
  value: JsonValue;
  id?: string;
  purpose?: OneOrMany<Purpose>;
  creator?: OneOrMany<string | Agent>;
  created?: string;
  modified?: string;
}

export interface Choice<T> {
  type: 'Choice';
  items: T[];
}

export type Body =
  string | ExternalResource | TextualBody | StructuredBody | SpecificResource | Choice<Body>;

export type Target = string | ExternalResource | AnchoredTarget | Choice<Target>;

// ---------------------------------------------------------------------------
// Annotation

export const PERMISSIONS = ['read', 'update', 'delete', 'share'] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Properties a client controls on an annotation. */
export interface AnnotationProperties {
  type: 'Annotation' | ['Annotation', ...string[]];
  body?: OneOrMany<Body>;
  bodyValue?: string;
  target: OneOrMany<Target>;
  motivation?: OneOrMany<Motivation>;
  generator?: string | Agent;
  generated?: string;
  audience?: OneOrMany<string | Record<string, unknown>>;
  rights?: OneOrMany<string>;
  canonical?: string;
  via?: OneOrMany<string>;
  stylesheet?: string | { type: 'CssStylesheet'; value?: string; id?: string };
  /** JSON-LD extension properties round-trip unchanged (ADR 0011). */
  [extension: string]: unknown;
}

/** An annotation as the server returns it. */
export interface Annotation extends AnnotationProperties {
  '@context': JsonLdContext;
  id: string;
  creator?: string | Agent;
  created?: string;
  modified?: string;
  /**
   * Extension, server-populated on responses: the permissions the caller
   * holds on this annotation. Ignored on input.
   */
  permissions?: Permission[];
  /**
   * Extension, server-populated on responses: whether anyone, signed in or
   * not, may read this annotation. Ignored on input.
   */
  public?: boolean;
}

/**
 * An annotation as a client sends it to be created or replaced. `id`,
 * `creator`, `created` and `modified` are assigned by the server; a client
 * may send them but they are ignored. `@context` defaults to the W3C context.
 */
export interface AnnotationInput extends AnnotationProperties {
  '@context'?: JsonLdContext;
}
