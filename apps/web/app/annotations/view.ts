/**
 * How the site shows annotations beyond what `@curanno/model` reads from
 * them: excerpts and the body shapes the detail page renders.
 */
import { isStructuredBody, isTextualBody, toArray, type Body } from '@curanno/model';

export function excerpt(text: string, max = 160): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export type BodyView =
  | { kind: 'iri'; iri: string }
  | { kind: 'textual'; value: string; purposes: string[] }
  | { kind: 'structured'; profile: string; json: string }
  | { kind: 'other'; json: string };

/** A body in one of the shapes the detail page renders. */
export function viewBody(body: Body): BodyView {
  if (typeof body === 'string') return { kind: 'iri', iri: body };
  if (isTextualBody(body)) {
    return { kind: 'textual', value: body.value, purposes: toArray(body.purpose) };
  }
  if (isStructuredBody(body)) {
    return { kind: 'structured', profile: body.profile, json: JSON.stringify(body.value, null, 2) };
  }
  return { kind: 'other', json: JSON.stringify(body, null, 2) };
}
