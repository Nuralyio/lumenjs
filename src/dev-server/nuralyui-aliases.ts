import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const tagToPackage: Record<string, string> = {
  'nr-alert': '@nuraly/lumenui/alert',
  'nr-badge': '@nuraly/lumenui/badge',
  'nr-breadcrumb': '@nuraly/lumenui/breadcrumb',
  'nr-button': '@nuraly/lumenui/button',
  'nr-canvas': '@nuraly/lumenui/canvas',
  'nr-card': '@nuraly/lumenui/card',
  'nr-chatbot': '@nuraly/lumenui/chatbot',
  'nr-checkbox': '@nuraly/lumenui/checkbox',
  'nr-collapse': '@nuraly/lumenui/collapse',
  'nr-color-picker': '@nuraly/lumenui/color-picker',
  'nr-datepicker': '@nuraly/lumenui/datepicker',
  'nr-divider': '@nuraly/lumenui/divider',
  'nr-document': '@nuraly/lumenui/document',
  'nr-dropdown': '@nuraly/lumenui/dropdown',
  'nr-file-upload': '@nuraly/lumenui/file-upload',
  'nr-flex': '@nuraly/lumenui/flex',
  'nr-form': '@nuraly/lumenui/form',
  'nr-grid': '@nuraly/lumenui/grid',
  'nr-icon': '@nuraly/lumenui/icon',
  'nr-image': '@nuraly/lumenui/image',
  'nr-input': '@nuraly/lumenui/input',
  'nr-label': '@nuraly/lumenui/label',
  'nr-layout': '@nuraly/lumenui/layout',
  'nr-menu': '@nuraly/lumenui/menu',
  'nr-modal': '@nuraly/lumenui/modal',
  'nr-panel': '@nuraly/lumenui/panel',
  'nr-popconfirm': '@nuraly/lumenui/popconfirm',
  'nr-radio': '@nuraly/lumenui/radio',
  'nr-select': '@nuraly/lumenui/select',
  'nr-skeleton': '@nuraly/lumenui/skeleton',
  'nr-slider-input': '@nuraly/lumenui/slider-input',
  'nr-table': '@nuraly/lumenui/table',
  'nr-tabs': '@nuraly/lumenui/tabs',
  'nr-tag': '@nuraly/lumenui/tag',
  'nr-textarea': '@nuraly/lumenui/textarea',
  'nr-timeline': '@nuraly/lumenui/timeline',
  'nr-toast': '@nuraly/lumenui/toast',
  'nr-video': '@nuraly/lumenui/video',
  'nr-radio-group': '@nuraly/lumenui/radio-group',
  'nr-iconpicker': '@nuraly/lumenui/iconpicker',
  'nr-container': '@nuraly/lumenui/container',
  'nr-code-editor': '@nuraly/lumenui/code-editor',
};

export const implicitDeps: Record<string, string[]> = {
  'nr-button': ['nr-icon'],
  'nr-alert': ['nr-icon'],
  'nr-breadcrumb': ['nr-icon'],
  'nr-dropdown': ['nr-icon'],
  'nr-modal': ['nr-icon'],
  'nr-popconfirm': ['nr-icon', 'nr-button'],
  'nr-select': ['nr-icon'],
  'nr-datepicker': ['nr-icon'],
  'nr-file-upload': ['nr-icon', 'nr-button'],
  'nr-collapse': ['nr-icon'],
  'nr-menu': ['nr-icon'],
  'nr-tabs': ['nr-icon'],
  'nr-toast': ['nr-icon'],
  'nr-input': ['nr-icon'],
  'nr-textarea': ['nr-icon'],
  'nr-table': ['nr-icon', 'nr-checkbox'],
  'nr-iconpicker': ['nr-icon'],
};

/**
 * NuralyUI component alias map.
 * Maps @nuraly/lumenui/* imports to component source directories.
 */
/**
 * Resolve a component directory to its entry file.
 * Prefers index.ts, falls back to <dirname>.component.ts.
 */
function resolveComponentEntry(dirPath: string): string {
  const indexPath = path.join(dirPath, 'index.ts');
  if (fs.existsSync(indexPath)) return indexPath;
  const name = path.basename(dirPath);
  const componentPath = path.join(dirPath, `${name}.component.ts`);
  if (fs.existsSync(componentPath)) return componentPath;
  return dirPath;
}

export function getNuralyUIAliases(nuralyUIPath: string, nuralyCommonPath: string): Record<string, string> {
  const componentNames: Record<string, string> = {
    '@nuraly/lumenui/alert': 'alert',
    '@nuraly/lumenui/badge': 'badge',
    '@nuraly/lumenui/breadcrumb': 'breadcrumb',
    '@nuraly/lumenui/button': 'button',
    '@nuraly/lumenui/canvas': 'canvas',
    '@nuraly/lumenui/card': 'card',
    '@nuraly/lumenui/chatbot': 'chatbot',
    '@nuraly/lumenui/checkbox': 'checkbox',
    '@nuraly/lumenui/collapse': 'collapse',
    '@nuraly/lumenui/color-picker': 'colorpicker',
    '@nuraly/lumenui/datepicker': 'datepicker',
    '@nuraly/lumenui/divider': 'divider',
    '@nuraly/lumenui/document': 'document',
    '@nuraly/lumenui/dropdown': 'dropdown',
    '@nuraly/lumenui/file-upload': 'file-upload',
    '@nuraly/lumenui/flex': 'flex',
    '@nuraly/lumenui/form': 'form',
    '@nuraly/lumenui/grid': 'grid',
    '@nuraly/lumenui/icon': 'icon',
    '@nuraly/lumenui/image': 'image',
    '@nuraly/lumenui/input': 'input',
    '@nuraly/lumenui/label': 'label',
    '@nuraly/lumenui/layout': 'layout',
    '@nuraly/lumenui/menu': 'menu',
    '@nuraly/lumenui/modal': 'modal',
    '@nuraly/lumenui/panel': 'panel',
    '@nuraly/lumenui/popconfirm': 'popconfirm',
    '@nuraly/lumenui/radio': 'radio',
    '@nuraly/lumenui/select': 'select',
    '@nuraly/lumenui/skeleton': 'skeleton',
    '@nuraly/lumenui/slider-input': 'slider-input',
    '@nuraly/lumenui/table': 'table',
    '@nuraly/lumenui/tabs': 'tabs',
    '@nuraly/lumenui/tag': 'tag',
    '@nuraly/lumenui/textarea': 'textarea',
    '@nuraly/lumenui/timeline': 'timeline',
    '@nuraly/lumenui/toast': 'toast',
    '@nuraly/lumenui/video': 'video',
    '@nuraly/lumenui/radio-group': 'radio-group',
    '@nuraly/lumenui/iconpicker': 'iconpicker',
    '@nuraly/lumenui/container': 'container',
    '@nuraly/lumenui/code-editor': 'code-editor',
  };

  const aliases: Record<string, string> = {};
  for (const [pkg, dir] of Object.entries(componentNames)) {
    aliases[pkg] = resolveComponentEntry(path.join(nuralyUIPath, dir));
  }

  aliases['@nuralyui/common/controllers'] = path.join(nuralyCommonPath, 'controllers.ts');
  aliases['@nuralyui/common/mixins'] = path.join(nuralyCommonPath, 'mixins.ts');
  aliases['@nuralyui/common/utils'] = path.join(nuralyCommonPath, 'utils.ts');
  aliases['@nuralyui/common/themes'] = path.join(nuralyCommonPath, 'themes.ts');
  aliases['@nuralyui/common'] = path.join(nuralyCommonPath, 'index.ts');

  return aliases;
}

/**
 * Resolves the NuralyUI source path dynamically.
 * Walks up from the project directory looking for the nuraly-ui package,
 * then falls back to well-known paths and environment variable.
 */
export function resolveNuralyUIPaths(projectDir: string): { componentsPath: string; commonPath: string } | null {
  const nuralyUIRelPath = 'libs/nuraly-ui';

  const candidates = [
    // Walk up from project dir to find the monorepo root containing libs/
    findMonorepoRoot(projectDir, nuralyUIRelPath),
    // Relative to lumenjs lib (in-repo: libs/lumenjs → repo root)
    path.resolve(__dirname, '../../..', nuralyUIRelPath),
    // NURALYUI_PATH env override
    process.env.NURALYUI_PATH || '',
  ];

  for (const base of candidates) {
    if (!base) continue;
    const componentsPath = path.join(base, 'src/components');
    const commonPath = path.join(base, 'packages/common/src');
    if (fs.existsSync(componentsPath)) {
      return { componentsPath, commonPath };
    }
  }
  return null;
}

/**
 * Walk up from a directory looking for a monorepo root that contains the given relative path.
 */
function findMonorepoRoot(startDir: string, relPath: string): string {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;

  while (dir !== root) {
    const candidate = path.join(dir, relPath);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    dir = path.dirname(dir);
  }
  return '';
}
