/**
 * The text-model fixture suite through the guest in Chromium: the normative
 * conformance test (docs/text-model.md, section 12) run against the
 * extraction the guest ships with, with real computed styles.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { TextPositionSelector, TextQuoteSelector } from '@scale/model';
import type { Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUILD_DIR, FIXTURES_DIR, startHarness, type Harness } from './harness.ts';
import type { FixtureResult } from './runtime/fixtures-runtime.ts';

interface Fixture {
  name: string;
  html: string;
  text: string;
  ranges?: Record<string, { quote: TextQuoteSelector; position: TextPositionSelector } | null>;
}

const fixtures = readdirSync(FIXTURES_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(path.join(FIXTURES_DIR, f), 'utf8')) as Fixture);

let h: Harness;
let page: Page;

beforeAll(async () => {
  h = await startHarness();
  page = await h.browser.newPage();
});

afterAll(async () => {
  await h.close();
});

async function runFixture(fixture: Fixture): Promise<FixtureResult> {
  const whole = /^\s*(<!doctype|<html)/i.test(fixture.html);
  const html = whole
    ? fixture.html
    : `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="scope">${fixture.html}</div></body></html>`;
  await page.goto(`${h.host.origin}/blank.html`);
  await page.setContent(html);
  await page.addScriptTag({ path: path.join(BUILD_DIR, 'fixtures-runtime.js') });
  return page.evaluate(([scope, ranges]) => window.__fixtures.run(scope, ranges), [
    whole ? 'body' : '#scope',
    fixture.ranges ?? {},
  ] as const);
}

describe('text model fixtures in Chromium', () => {
  for (const fixture of fixtures) {
    it(fixture.name, async () => {
      const result = await runFixture(fixture);
      expect(result.text).toBe(fixture.text);
      for (const [name, expected] of Object.entries(fixture.ranges ?? {})) {
        const got = result.ranges[name];
        expect(got, name).toBeDefined();
        if (expected === null) {
          expect(got?.described, name).toBeNull();
          continue;
        }
        expect(got?.described, name).toEqual(expected);
        // Each selector alone, and all together, anchor back to the same text.
        for (const text of got?.reanchored ?? []) expect(text, name).toBe(expected.quote.exact);
        expect(got?.anchoredExpected, name).toEqual({
          start: expected.position.start,
          end: expected.position.end,
        });
      }
    });
  }
});
