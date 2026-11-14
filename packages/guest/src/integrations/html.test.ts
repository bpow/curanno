// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { HtmlIntegration } from './html.js';

describe('HtmlIntegration.text', () => {
  it("reports the body's normalized text with where its blocks start", async () => {
    document.body.innerHTML = '<h1>Title</h1><p>First <em>para</em>.</p>\n<p>Second.</p>';
    const html = new HtmlIntegration({ document });
    expect(await html.text()).toEqual([{ text: 'TitleFirst para. Second.', blockStarts: [5, 17] }]);
  });

  it('reads the document as it is now', async () => {
    document.body.innerHTML = '<p>Before</p>';
    const html = new HtmlIntegration({ document });
    await html.text();
    document.body.innerHTML = '<p>After</p>';
    expect((await html.text())[0]?.text).toBe('After');
  });
});
