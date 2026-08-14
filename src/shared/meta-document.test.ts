import { describe, it, expect } from 'vitest';
import { applyMetaToDocument, resolvePageMeta } from './meta.js';

const DOC = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Site</title>
  <meta name="description" content="the site as a whole">
  <meta property="og:title" content="Site">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://example.com/">
</head>
<body><nk-app></nk-app></body>
</html>`;

describe('resolvePageMeta', () => {
  it('reads an object export', async () => {
    expect(await resolvePageMeta({ meta: { title: 'A' } }, {})).toEqual({ title: 'A' });
  });

  it('calls a function export with the same context the client uses', async () => {
    const meta = await resolvePageMeta(
      { meta: (c) => ({ title: `${(c.data as any).name} in ${c.params!.id}` }) },
      { data: { name: 'A' }, params: { id: '7' } }
    );
    expect(meta?.title).toBe('A in 7');
  });

  it('awaits an async export', async () => {
    expect((await resolvePageMeta({ meta: async () => ({ title: 'later' }) }, {}))?.title)
      .toBe('later');
  });

  it('answers null when there is no meta', async () => {
    expect(await resolvePageMeta({}, {})).toBeNull();
    expect(await resolvePageMeta(null, {})).toBeNull();
  });

  it('swallows a meta that throws, because the page still has to be served', async () => {
    expect(await resolvePageMeta({ meta: () => { throw new Error('no'); } }, {})).toBeNull();
  });
});

describe('applyMetaToDocument', () => {
  it('replaces the title, suffixed the way the client suffixes it', () => {
    const out = applyMetaToDocument(DOC, { title: 'A page' }, { siteTitle: 'Site' });
    expect(out).toContain('<title>A page | Site</title>');
    expect(out).not.toContain('<title>Site</title>');
  });

  it('leaves a document alone when there is nothing to say', () => {
    expect(applyMetaToDocument(DOC, null)).toBe(DOC);
  });

  it('does not guess at a document with no head', () => {
    expect(applyMetaToDocument('<p>hi</p>', { title: 'x' })).toBe('<p>hi</p>');
  });

  it('leaves exactly one description', () => {
    const out = applyMetaToDocument(DOC, { description: 'this page only' });
    expect((out.match(/name="description"/g) ?? []).length).toBe(1);
    expect(out).not.toContain('the site as a whole');
  });

  it('leaves exactly one og:type and one og:title', () => {
    const out = applyMetaToDocument(DOC, { title: 'A', type: 'article' });
    expect((out.match(/property="og:type"/g) ?? []).length).toBe(1);
    expect((out.match(/property="og:title"/g) ?? []).length).toBe(1);
    expect(out).toContain('content="article"');
  });

  it('leaves exactly one canonical and one og:url', () => {
    const out = applyMetaToDocument(DOC, { canonical: 'https://example.com/docs' },
      { url: 'https://example.com/docs' });
    expect((out.match(/rel="canonical"/g) ?? []).length).toBe(1);
    expect((out.match(/property="og:url"/g) ?? []).length).toBe(1);
    expect(out).toContain('https://example.com/docs');
    expect(out).not.toContain('content="https://example.com/"');
  });

  it('keeps the document’s own description when the page states none', () => {
    expect(applyMetaToDocument(DOC, { title: 'A' })).toContain('the site as a whole');
  });

  it('escapes what it writes', () => {
    const out = applyMetaToDocument(DOC, { title: 'Fish & <chips>' }, { siteTitle: 'S' });
    expect(out).toContain('&amp;');
    expect(out).not.toContain('<chips>');
  });

  it('keeps the rest of the document intact', () => {
    const out = applyMetaToDocument(DOC, { title: 'A', description: 'B' }, { siteTitle: 'S' });
    expect(out).toContain('<meta charset="UTF-8" />');
    expect(out).toContain('<nk-app></nk-app>');
    expect(out).toContain('</html>');
    expect((out.match(/<\/head>/g) ?? []).length).toBe(1);
  });
});

describe('the site title stamp', () => {
  it('is written whenever a page title replaces the document’s', () => {
    const out = applyMetaToDocument(DOC, { title: 'A page' }, { siteTitle: 'Site' });
    expect(out).toContain('<meta name="nk-site-title" content="Site">');
    expect(out).toContain('<title>A page | Site</title>');
  });

  it('is not written when the page states no title', () => {
    const out = applyMetaToDocument(DOC, { description: 'only a description' },
      { siteTitle: 'Site' });
    expect(out).not.toContain('nk-site-title');
  });

  it('is never duplicated across two passes', () => {
    const once = applyMetaToDocument(DOC, { title: 'A' }, { siteTitle: 'Site' });
    const twice = applyMetaToDocument(once, { title: 'B' }, { siteTitle: 'Site' });
    expect((twice.match(/nk-site-title/g) ?? []).length).toBe(1);
    expect(twice).toContain('<title>B | Site</title>');
  });
});
