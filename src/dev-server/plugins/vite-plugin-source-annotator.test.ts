import { describe, it, expect } from 'vitest';
import path from 'path';
import { sourceAnnotatorPlugin } from './vite-plugin-source-annotator.js';

const projectDir = '/project';

function getTransform() {
  const plugin = sourceAnnotatorPlugin(projectDir);
  return plugin.transform as (code: string, id: string) => { code: string; map: null } | undefined;
}

describe('sourceAnnotatorPlugin transform', () => {
  const transform = getTransform();

  it('adds data-nk-source to custom element tags in html templates', () => {
    const code = "const t = html`<my-component >hello</my-component>`;";
    const result = transform(code, path.join(projectDir, 'pages/index.ts'));
    expect(result).toBeDefined();
    expect(result!.code).toContain('data-nk-source="pages/index.ts:');
  });

  it('annotates multiple custom elements', () => {
    const code = "const t = html`<nr-button >Click</nr-button><nr-icon >x</nr-icon>`;";
    const result = transform(code, path.join(projectDir, 'pages/index.ts'));
    expect(result!.code).toMatch(/data-nk-source.*data-nk-source/);
  });

  it('does not transform files without html`', () => {
    const code = "export function helper() { return 42; }";
    const result = transform(code, path.join(projectDir, 'utils.ts'));
    expect(result).toBeUndefined();
  });

  it('does not transform files outside projectDir', () => {
    const code = "const t = html`<my-el >hi</my-el>`;";
    const result = transform(code, '/other/file.ts');
    expect(result).toBeUndefined();
  });

  it('does not transform non-ts files', () => {
    const code = "const t = html`<my-el >hi</my-el>`;";
    const result = transform(code, path.join(projectDir, 'file.js'));
    expect(result).toBeUndefined();
  });

  it('adds data-nk-dynamic for template expressions in standard elements', () => {
    const code = "const t = html`<p>${this.name}</p>`;";
    const result = transform(code, path.join(projectDir, 'pages/index.ts'));
    expect(result).toBeDefined();
    expect(result!.code).toContain('data-nk-dynamic');
  });

  it('adds data-nk-i18n-key for t() calls', () => {
    const code = "const t2 = html`<span>${t('hello.world')}</span>`;";
    const result = transform(code, path.join(projectDir, 'pages/index.ts'));
    expect(result).toBeDefined();
    expect(result!.code).toContain('data-nk-i18n-key="hello.world"');
  });
});
