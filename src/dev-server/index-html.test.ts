import { describe, it, expect } from 'vitest';
import { generateIndexHtml } from './index-html.js';

describe('generateIndexHtml', () => {
  it('generates minimal HTML with title', () => {
    const html = generateIndexHtml({ title: 'Test App', editorMode: false });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<title>Test App</title>');
    expect(html).toContain('<nk-app></nk-app>');
    expect(html).toContain('/@lumenjs/app-shell');
  });

  it('includes editor bridge script in editor mode', () => {
    const html = generateIndexHtml({ title: 'Test', editorMode: true });
    expect(html).toContain('/@lumenjs/editor-bridge');
  });

  it('does not include editor bridge when editorMode is false', () => {
    const html = generateIndexHtml({ title: 'Test', editorMode: false });
    expect(html).not.toContain('/@lumenjs/editor-bridge');
  });

  it('includes SSR content with data-nk-ssr attribute', () => {
    const html = generateIndexHtml({
      title: 'Test',
      editorMode: false,
      ssrContent: '<div>server-rendered</div>',
    });
    expect(html).toContain('data-nk-ssr');
    expect(html).toContain('<div>server-rendered</div>');
    expect(html).toContain('lit-element-hydrate-support');
  });

  it('does not include hydrate script without SSR', () => {
    const html = generateIndexHtml({ title: 'Test', editorMode: false });
    expect(html).not.toContain('lit-element-hydrate-support');
  });

  it('includes loader data JSON script for SSR', () => {
    const html = generateIndexHtml({
      title: 'Test',
      editorMode: false,
      ssrContent: '<div>ssr</div>',
      loaderData: { name: 'Alice' },
    });
    expect(html).toContain('__nk_ssr_data__');
    expect(html).toContain('"name"');
  });

  it('includes structured SSR data with layouts', () => {
    const html = generateIndexHtml({
      title: 'Test',
      editorMode: false,
      ssrContent: '<div>ssr</div>',
      loaderData: { page: true },
      layoutsData: [{ loaderPath: '', data: { nav: true } }],
    });
    expect(html).toContain('__nk_ssr_data__');
    expect(html).toContain('"layouts"');
  });

  it('includes i18n JSON script', () => {
    const html = generateIndexHtml({
      title: 'Test',
      editorMode: false,
      locale: 'fr',
      i18nConfig: { locales: ['en', 'fr'], defaultLocale: 'en', prefixDefault: false },
      translations: { hello: 'Bonjour' },
    });
    expect(html).toContain('__nk_i18n__');
    expect(html).toContain('Bonjour');
  });

  it('sets lang attribute from locale', () => {
    const html = generateIndexHtml({
      title: 'Test',
      editorMode: false,
      locale: 'fr',
    });
    expect(html).toContain('lang="fr"');
  });

  it('defaults lang to en', () => {
    const html = generateIndexHtml({ title: 'Test', editorMode: false });
    expect(html).toContain('lang="en"');
  });

  it('escapes XSS in title', () => {
    const html = generateIndexHtml({ title: '<script>alert(1)</script>', editorMode: false });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('includes nuralyui stylesheet when integration present', () => {
    const html = generateIndexHtml({
      title: 'Test',
      editorMode: false,
      integrations: ['nuralyui'],
    });
    expect(html).toContain('nuralyui/themes');
  });

  it('includes tailwind import when integration present', () => {
    const html = generateIndexHtml({
      title: 'Test',
      editorMode: false,
      integrations: ['tailwind'],
    });
    expect(html).toContain('tailwind.css');
  });
});
