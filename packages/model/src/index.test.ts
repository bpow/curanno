import { describe, expect, it } from 'vitest';
import { TEXT_MODEL_VERSION, WEB_ANNOTATION_CONTEXT } from './index.js';

describe('model package', () => {
  it('exposes the text model version', () => {
    expect(TEXT_MODEL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it('uses the W3C annotation context', () => {
    expect(WEB_ANNOTATION_CONTEXT).toBe('http://www.w3.org/ns/anno.jsonld');
  });
});
