/**
 * Kysely table definitions matching apps/api/migrations. Keep the two in
 * step: a migration that changes a column changes the interface here in the
 * same commit. `Generated` marks columns the database fills in on insert.
 */
import type { ColumnType, Generated, JSONColumnType } from 'kysely';
import type {
  DocumentUriRelation,
  AnchoringRepair,
  AnchoringState,
  Body,
  JsonSchema,
  Permission,
  Selector,
} from '@curanno/model';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type OptionalTimestamp = ColumnType<
  Date | null,
  Date | string | null | undefined,
  Date | string | null
>;

export type PrincipalKind = 'user' | 'group' | 'public' | 'authenticated';

export const PUBLIC_PRINCIPAL_ID = '00000000-0000-0000-0000-000000000001';
export const AUTHENTICATED_PRINCIPAL_ID = '00000000-0000-0000-0000-000000000002';

export interface PrincipalsTable {
  id: Generated<string>;
  kind: PrincipalKind;
  created_at: Timestamp;
}

export interface UsersTable {
  principal_id: string;
  issuer: string;
  subject: string;
  display_name: string | null;
  email: string | null;
  is_admin: Generated<boolean>;
  created_at: Timestamp;
  last_login_at: OptionalTimestamp;
}

export interface GroupsTable {
  principal_id: string;
  name: string;
  description: string | null;
  created_by: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export type GroupRole = 'member' | 'admin';

export interface GroupMembershipsTable {
  group_id: string;
  user_id: string;
  role: Generated<GroupRole>;
  added_by: string | null;
  added_at: Timestamp;
}

export interface DocumentsTable {
  id: Generated<string>;
  title: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  title_search: ColumnType<string, never, never>;
}

export interface DocumentUrisTable {
  document_id: string;
  uri: string;
  uri_normalized: string;
  relation: DocumentUriRelation;
  claimant_normalized: string | null;
  created_at: Timestamp;
}

export interface AnnotationsTable {
  id: Generated<string>;
  document_id: string | null;
  parent_id: string | null;
  created_by: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  version: Generated<number>;
  motivation: Generated<string[]>;
  data: JSONColumnType<Record<string, unknown>, string | undefined>;
  deleted_at: OptionalTimestamp;
}

export interface TargetsTable {
  id: Generated<string>;
  annotation_id: string;
  position: number;
  source: string;
  document_id: string | null;
  selectors: JSONColumnType<Selector | Selector[] | null, string | null | undefined>;
  anchoring_state: Generated<AnchoringState>;
  repair: JSONColumnType<AnchoringRepair | null, string | null | undefined>;
  data: JSONColumnType<Record<string, unknown>, string | undefined>;
  quote: ColumnType<string | null, never, never>;
  quote_search: ColumnType<string, never, never>;
}

export interface BodiesTable {
  id: Generated<string>;
  annotation_id: string;
  position: number;
  body: ColumnType<Body, string, string>;
  body_type: ColumnType<string | null, never, never>;
  profile: ColumnType<string | null, never, never>;
  text_value: ColumnType<string | null, never, never>;
  text_search: ColumnType<string, never, never>;
}

export interface AclTable {
  annotation_id: string;
  principal_id: string;
  permission: Permission;
  granted_by: string | null;
  granted_at: Timestamp;
}

export interface BodyProfilesTable {
  iri: string;
  title: string;
  description: string | null;
  schema: JSONColumnType<JsonSchema>;
  builtin: Generated<boolean>;
  enabled: Generated<boolean>;
  created_by: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export type AnnotationEventKind = 'created' | 'updated' | 'deleted';

export interface AnnotationEventsTable {
  id: Generated<number>;
  annotation_id: string;
  document_id: string | null;
  kind: AnnotationEventKind;
  actor_id: string | null;
  occurred_at: Timestamp;
}

export interface SchemaMigrationsTable {
  name: string;
  applied_at: Timestamp;
}

export interface Database {
  principals: PrincipalsTable;
  users: UsersTable;
  groups: GroupsTable;
  group_memberships: GroupMembershipsTable;
  documents: DocumentsTable;
  document_uris: DocumentUrisTable;
  annotations: AnnotationsTable;
  targets: TargetsTable;
  bodies: BodiesTable;
  acl: AclTable;
  body_profiles: BodyProfilesTable;
  annotation_events: AnnotationEventsTable;
  schema_migrations: SchemaMigrationsTable;
}
