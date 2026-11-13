import { describe, expect, it } from 'vitest';
import {
  anchoringOf,
  annotationUuid,
  commentOf,
  creatorOf,
  documentOf,
  parentIri,
  quoteOf,
  sourcesOf,
  tagsOf,
} from './read.js';

const ID = '0b9a4c1e-5d2f-4a8b-9c3d-1e2f3a4b5c6d';
const ANNOTATION = `https://anno.test/annotations/${ID}`;
const USER = `https://anno.test/x/users/${ID}`;

describe('reading annotations', () => {
  it('takes the source of every kind of target', () => {
    expect(sourcesOf('https://a.test/x')).toEqual(['https://a.test/x']);
    expect(
      sourcesOf([
        { type: 'SpecificResource', source: 'https://a.test/x' },
        { type: 'SpecificResource', source: { id: 'https://b.test/y' } },
        { id: 'https://c.test/z' },
        { type: 'Choice', items: [] },
      ]),
    ).toEqual(['https://a.test/x', 'https://b.test/y', 'https://c.test/z']);
  });

  it('tells the document from the annotation replied to', () => {
    const reply = { target: [ANNOTATION, { source: 'https://a.test/x' }] };
    expect(parentIri(reply)).toBe(ANNOTATION);
    expect(annotationUuid(ANNOTATION)).toBe(ID);
    expect(documentOf(reply)).toBe('https://a.test/x');
    expect(parentIri({ target: 'https://a.test/x' })).toBeUndefined();
  });

  it('separates the comment from the tags', () => {
    const annotation = {
      body: [
        { type: 'TextualBody', value: 'tag', purpose: 'tagging' },
        { type: 'TextualBody', value: 'Comment', purpose: ['commenting'] },
      ],
    };
    expect(commentOf(annotation)).toBe('Comment');
    expect(tagsOf(annotation)).toEqual(['tag']);
    expect(commentOf({ bodyValue: 'plain' })).toBe('plain');
  });

  it('finds a quote in a refinement and the stored anchoring state', () => {
    const annotation = {
      target: {
        source: 'https://a.test/x',
        selector: {
          type: 'CssSelector',
          value: 'p',
          refinedBy: { type: 'TextQuoteSelector', exact: 'quoted' },
        },
        anchoring: { state: 'orphaned' },
      },
    };
    expect(quoteOf(annotation)).toBe('quoted');
    expect(anchoringOf(annotation)).toBe('orphaned');
  });

  it('names the creator and recognizes users of this server', () => {
    expect(creatorOf({})).toEqual({ name: 'Unknown' });
    expect(creatorOf({ creator: USER })).toEqual({ userId: ID, name: USER });
    expect(creatorOf({ creator: { id: USER, name: ['Ada', 'A.'] } })).toEqual({
      userId: ID,
      name: 'Ada',
    });
    expect(creatorOf({ creator: { id: 'https://elsewhere.test/me', nickname: 'ada' } })).toEqual({
      name: 'ada',
    });
  });
});
