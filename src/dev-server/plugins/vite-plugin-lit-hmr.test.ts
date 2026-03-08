import { describe, it, expect } from 'vitest';
import path from 'path';
import { litHmrPlugin } from './vite-plugin-lit-hmr.js';

const projectDir = '/project';

function getTransform() {
  const plugin = litHmrPlugin(projectDir);
  return plugin.transform as (code: string, id: string) => { code: string; map: null } | undefined;
}

describe('litHmrPlugin transform', () => {
  const transform = getTransform();

  it('injects HMR code for decorated Lit component', () => {
    const code = `let MyEl = class MyEl extends LitElement {};\nMyEl = __decorateClass([\n  customElement("my-el")\n], MyEl)`;
    const result = transform(code, path.join(projectDir, 'comp.ts'));
    expect(result).toBeDefined();
    expect(result!.code).toContain('import.meta.hot');
    expect(result!.code).toContain('customElements.get("my-el")');
    expect(result!.code).toContain('requestUpdate');
  });

  it('replaces __decorateClass with conditional define', () => {
    const code = `let MyEl = class MyEl extends LitElement {};\nMyEl = __decorateClass([\n  customElement("my-el")\n], MyEl)`;
    const result = transform(code, path.join(projectDir, 'comp.ts'));
    expect(result!.code).toContain('if (!customElements.get("my-el"))');
    expect(result!.code).toContain('customElements.define("my-el", MyEl)');
  });

  it('does not transform non-Lit code', () => {
    const code = `export function helper() { return 42; }`;
    const result = transform(code, path.join(projectDir, 'helper.ts'));
    expect(result).toBeUndefined();
  });

  it('does not transform files outside projectDir', () => {
    const code = `MyEl = __decorateClass([\n  customElement("my-el")\n], MyEl)`;
    const result = transform(code, '/other/comp.ts');
    expect(result).toBeUndefined();
  });

  it('does not transform non-ts files', () => {
    const code = `MyEl = __decorateClass([\n  customElement("my-el")\n], MyEl)`;
    const result = transform(code, path.join(projectDir, 'comp.js'));
    expect(result).toBeUndefined();
  });
});
