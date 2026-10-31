import { describe, expect, it } from 'vitest';
import { createSessionConsent, foreignSources, originKey, sourcesOf } from './disclosure';

describe('originKey', () => {
  it('compares web origins by host and port, whatever the scheme', () => {
    expect(originKey('https://example.org/a')).toBe('example.org');
    expect(originKey('http://example.org/b?c')).toBe('example.org');
    expect(originKey('https://example.org:8443/')).toBe('example.org:8443');
    expect(originKey('https://www.example.org/')).toBe('www.example.org');
    for (const opaque of ['null', 'urn:x-pdf:abc', 'doi:10.1/x', 'not a url']) {
      expect(originKey(opaque)).toBeNull();
    }
  });
});

describe('foreignSources', () => {
  it('names the origins of targets that are not on the page', () => {
    expect(sourcesOf('https://a.test/x')).toEqual(['https://a.test/x']);
    expect(
      sourcesOf([
        { type: 'SpecificResource', source: 'https://a.test/x' },
        { id: 'https://b.test/y' },
      ] as never),
    ).toEqual(['https://a.test/x', 'https://b.test/y']);

    const target = [
      { type: 'SpecificResource', source: 'http://a.test/one' },
      { type: 'SpecificResource', source: 'https://b.test/two' },
      { type: 'SpecificResource', source: 'urn:x-pdf:abc' },
    ] as never;
    expect(foreignSources(target, 'a.test')).toEqual(['b.test', 'urn:x-pdf:abc']);
    expect(foreignSources('https://a.test/x', 'a.test')).toEqual([]);
    // An opaque page origin matches nothing.
    expect(foreignSources('https://a.test/x', null)).toEqual(['a.test']);
  });
});

describe('createSessionConsent', () => {
  function memoryStorage(): Storage {
    const data = new Map<string, string>();
    return {
      get length() {
        return data.size;
      },
      clear: () => data.clear(),
      getItem: (k) => data.get(k) ?? null,
      key: (i) => [...data.keys()][i] ?? null,
      removeItem: (k) => void data.delete(k),
      setItem: (k, v) => void data.set(k, v),
    };
  }

  it('remembers each page and source pair in storage, and only that pair', () => {
    const storage = memoryStorage();
    const consent = createSessionConsent(storage);
    expect(consent.has('mirror.test', 'publisher.test')).toBe(false);
    consent.add('mirror.test', 'publisher.test');
    expect(consent.has('mirror.test', 'publisher.test')).toBe(true);
    expect(consent.has('publisher.test', 'mirror.test')).toBe(false);
    expect(consent.has('other.test', 'publisher.test')).toBe(false);
    // A sidebar reloaded in the same tab finds it again.
    expect(createSessionConsent(storage).has('mirror.test', 'publisher.test')).toBe(true);
  });

  it('treats unreadable storage as no consent and works without storage', () => {
    const storage = memoryStorage();
    storage.setItem('curanno.disclosure', '{not json');
    expect(createSessionConsent(storage).has('a', 'b')).toBe(false);
    const memory = createSessionConsent(null);
    memory.add('a', 'b');
    expect(memory.has('a', 'b')).toBe(true);
  });
});
