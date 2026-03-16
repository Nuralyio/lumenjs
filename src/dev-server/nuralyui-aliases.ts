import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const tagToPackage: Record<string, string> = {
  'nr-alert': '@nuralyui/alert',
  'nr-badge': '@nuralyui/badge',
  'nr-breadcrumb': '@nuralyui/breadcrumb',
  'nr-button': '@nuralyui/button',
  'nr-canvas': '@nuralyui/canvas',
  'nr-card': '@nuralyui/card',
  'nr-chatbot': '@nuralyui/chatbot',
  'nr-checkbox': '@nuralyui/checkbox',
  'nr-collapse': '@nuralyui/collapse',
  'nr-color-picker': '@nuralyui/color-picker',
  'nr-datepicker': '@nuralyui/datepicker',
  'nr-divider': '@nuralyui/divider',
  'nr-document': '@nuralyui/document',
  'nr-dropdown': '@nuralyui/dropdown',
  'nr-file-upload': '@nuralyui/file-upload',
  'nr-flex': '@nuralyui/flex',
  'nr-form': '@nuralyui/forms',
  'nr-grid': '@nuralyui/grid',
  'nr-icon': '@nuralyui/icon',
  'nr-image': '@nuralyui/image',
  'nr-input': '@nuralyui/input',
  'nr-label': '@nuralyui/label',
  'nr-layout': '@nuralyui/layout',
  'nr-menu': '@nuralyui/menu',
  'nr-modal': '@nuralyui/modal',
  'nr-panel': '@nuralyui/panel',
  'nr-popconfirm': '@nuralyui/popconfirm',
  'nr-radio': '@nuralyui/radio',
  'nr-select': '@nuralyui/select',
  'nr-skeleton': '@nuralyui/skeleton',
  'nr-slider-input': '@nuralyui/slider-input',
  'nr-table': '@nuralyui/table',
  'nr-tabs': '@nuralyui/tabs',
  'nr-tag': '@nuralyui/tag',
  'nr-textarea': '@nuralyui/textarea',
  'nr-timeline': '@nuralyui/timeline',
  'nr-toast': '@nuralyui/toast',
  'nr-video': '@nuralyui/video',
  'nr-radio-group': '@nuralyui/radio-group',
  'nr-iconpicker': '@nuralyui/iconpicker',
  'nr-container': '@nuralyui/container',
  'nr-code-editor': '@nuralyui/code-editor',
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
 * NuralyUI component alias map — mirrors the studio astro.config.mjs aliases.
 * Points to the component source directories within the studio service.
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
    '@nuralyui/alert': 'alert',
    '@nuralyui/badge': 'badge',
    '@nuralyui/breadcrumb': 'breadcrumb',
    '@nuralyui/button': 'button',
    '@nuralyui/canvas': 'canvas',
    '@nuralyui/card': 'card',
    '@nuralyui/chatbot': 'chatbot',
    '@nuralyui/checkbox': 'checkbox',
    '@nuralyui/collapse': 'collapse',
    '@nuralyui/color-picker': 'colorpicker',
    '@nuralyui/datepicker': 'datepicker',
    '@nuralyui/divider': 'divider',
    '@nuralyui/document': 'document',
    '@nuralyui/dropdown': 'dropdown',
    '@nuralyui/file-upload': 'file-upload',
    '@nuralyui/flex': 'flex',
    '@nuralyui/forms': 'form',
    '@nuralyui/grid': 'grid',
    '@nuralyui/icon': 'icon',
    '@nuralyui/image': 'image',
    '@nuralyui/input': 'input',
    '@nuralyui/label': 'label',
    '@nuralyui/layout': 'layout',
    '@nuralyui/menu': 'menu',
    '@nuralyui/modal': 'modal',
    '@nuralyui/panel': 'panel',
    '@nuralyui/popconfirm': 'popconfirm',
    '@nuralyui/radio': 'radio',
    '@nuralyui/select': 'select',
    '@nuralyui/skeleton': 'skeleton',
    '@nuralyui/slider-input': 'slider-input',
    '@nuralyui/table': 'table',
    '@nuralyui/tabs': 'tabs',
    '@nuralyui/tag': 'tag',
    '@nuralyui/textarea': 'textarea',
    '@nuralyui/timeline': 'timeline',
    '@nuralyui/toast': 'toast',
    '@nuralyui/video': 'video',
    '@nuralyui/radio-group': 'radio-group',
    '@nuralyui/iconpicker': 'iconpicker',
    '@nuralyui/container': 'container',
    '@nuralyui/code-editor': 'code-editor',
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
  const nuralyUIRelPath = 'services/studio/src/features/runtime/components/ui/nuraly-ui';
  // Also check directly inside the project (Docker mounts project at /app/studio)
  const nuralyUIInProject = 'src/features/runtime/components/ui/nuraly-ui';

  const candidates = [
    // Direct path inside project dir (Docker: /app/studio/src/features/...)
    path.join(projectDir, nuralyUIInProject),
    // Walk up from project dir to find the monorepo root containing services/
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
