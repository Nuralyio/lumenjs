import { describe, it, expect } from 'vitest';
import path from 'path';
import { tagToPackage, implicitDeps, getNuralyUIAliases } from './nuralyui-aliases.js';

describe('tagToPackage', () => {
  it('maps nr-button to @nuralyui/button', () => {
    expect(tagToPackage['nr-button']).toBe('@nuralyui/button');
  });

  it('maps nr-icon to @nuralyui/icon', () => {
    expect(tagToPackage['nr-icon']).toBe('@nuralyui/icon');
  });

  it('maps nr-table to @nuralyui/table', () => {
    expect(tagToPackage['nr-table']).toBe('@nuralyui/table');
  });

  it('has entries for all known tags', () => {
    const tags = Object.keys(tagToPackage);
    expect(tags.length).toBeGreaterThan(30);
    expect(tags.every(t => t.startsWith('nr-'))).toBe(true);
  });
});

describe('implicitDeps', () => {
  it('nr-button depends on nr-icon', () => {
    expect(implicitDeps['nr-button']).toContain('nr-icon');
  });

  it('nr-table depends on nr-icon and nr-checkbox', () => {
    expect(implicitDeps['nr-table']).toContain('nr-icon');
    expect(implicitDeps['nr-table']).toContain('nr-checkbox');
  });

  it('nr-popconfirm depends on nr-icon and nr-button', () => {
    expect(implicitDeps['nr-popconfirm']).toContain('nr-icon');
    expect(implicitDeps['nr-popconfirm']).toContain('nr-button');
  });
});

describe('getNuralyUIAliases', () => {
  it('returns alias map with all component packages', () => {
    const aliases = getNuralyUIAliases('/ui/components', '/ui/common');
    expect(aliases['@nuralyui/button']).toBe(path.join('/ui/components', 'button'));
    expect(aliases['@nuralyui/icon']).toBe(path.join('/ui/components', 'icon'));
  });

  it('includes common package aliases', () => {
    const aliases = getNuralyUIAliases('/ui/components', '/ui/common');
    expect(aliases['@nuralyui/common']).toBe(path.join('/ui/common', 'index.ts'));
    expect(aliases['@nuralyui/common/controllers']).toBe(path.join('/ui/common', 'controllers.ts'));
    expect(aliases['@nuralyui/common/mixins']).toBe(path.join('/ui/common', 'mixins.ts'));
  });

  it('maps color-picker to colorpicker directory', () => {
    const aliases = getNuralyUIAliases('/ui/components', '/ui/common');
    expect(aliases['@nuralyui/color-picker']).toBe(path.join('/ui/components', 'colorpicker'));
  });

  it('maps forms to form directory', () => {
    const aliases = getNuralyUIAliases('/ui/components', '/ui/common');
    expect(aliases['@nuralyui/forms']).toBe(path.join('/ui/components', 'form'));
  });
});
