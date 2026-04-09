import { describe, it, expect } from 'vitest';
import path from 'path';
import { autoDefinePlugin } from './vite-plugin-auto-define.js';

const pagesDir = '/project/pages';

function getTransform() {
  const plugin = autoDefinePlugin(pagesDir);
  return plugin.transform as (code: string, id: string) => { code: string; map: null } | undefined;
}

describe('autoDefinePlugin transform', () => {
  const transform = getTransform();

  it('appends customElements.define for page file', () => {
    const code = `import { LitElement, html } from 'lit';\nexport class PageIndex extends LitElement {\n  render() { return html\`<h1>Hi</h1>\`; }\n}`;
    const result = transform(code, path.join(pagesDir, 'index.ts'));
    expect(result).toBeDefined();
    expect(result!.code).toContain("customElements.define('page-index', PageIndex)");
  });

  it('derives correct tag for nested page', () => {
    const code = `export class BlogPost extends LitElement {}`;
    const result = transform(code, path.join(pagesDir, 'blog/post.ts'));
    expect(result!.code).toContain("customElements.define('page-blog-post', BlogPost)");
  });

  it('handles layout file with layout-root tag', () => {
    const code = `export class RootLayout extends LitElement {}`;
    const result = transform(code, path.join(pagesDir, '_layout.ts'));
    expect(result!.code).toContain("customElements.define('layout-root', RootLayout)");
  });

  it('handles nested layout', () => {
    const code = `export class DashLayout extends LitElement {}`;
    const result = transform(code, path.join(pagesDir, 'dashboard/_layout.ts'));
    expect(result!.code).toContain("customElements.define('layout-dashboard', DashLayout)");
  });

  it('skips file with @customElement decorator', () => {
    const code = `@customElement('my-page')\nexport class MyPage extends LitElement {}`;
    const result = transform(code, path.join(pagesDir, 'index.ts'));
    expect(result).toBeUndefined();
  });

  it('skips file without LitElement extension', () => {
    const code = `export class MyHelper { static run() {} }`;
    const result = transform(code, path.join(pagesDir, 'index.ts'));
    expect(result).toBeUndefined();
  });

  it('skips files starting with _ that are not _layout', () => {
    const code = `export class Helper extends LitElement {}`;
    const result = transform(code, path.join(pagesDir, '_utils.ts'));
    expect(result).toBeUndefined();
  });

  it('skips files outside pagesDir', () => {
    const code = `export class Comp extends LitElement {}`;
    const result = transform(code, '/other/dir/comp.ts');
    expect(result).toBeUndefined();
  });

  it('skips non-ts files', () => {
    const code = `export class Comp extends LitElement {}`;
    const result = transform(code, path.join(pagesDir, 'index.js'));
    expect(result).toBeUndefined();
  });

  it('matches when Vite normalizes Windows backslashes to forward slashes', () => {
    // Simulate Windows: pagesDir has backslashes, but Vite normalizes id to forward slashes
    const winPlugin = autoDefinePlugin('C:\\project\\pages');
    const winTransform = winPlugin.transform as (code: string, id: string) => { code: string; map: null } | undefined;
    const code = `export class PageIndex extends LitElement {}`;
    const result = winTransform(code, 'C:/project/pages/index.ts');
    expect(result).toBeDefined();
    expect(result!.code).toContain("customElements.define('page-index', PageIndex)");
  });

  it('skips if already has customElements.define for same tag', () => {
    const code = `export class PageIndex extends LitElement {}\ncustomElements.define('page-index', PageIndex);`;
    const result = transform(code, path.join(pagesDir, 'index.ts'));
    expect(result).toBeUndefined();
  });
});
