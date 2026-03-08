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
export function getNuralyUIAliases(nuralyUIPath: string, nuralyCommonPath: string): Record<string, string> {
  return {
    '@nuralyui/alert': path.join(nuralyUIPath, 'alert'),
    '@nuralyui/badge': path.join(nuralyUIPath, 'badge'),
    '@nuralyui/breadcrumb': path.join(nuralyUIPath, 'breadcrumb'),
    '@nuralyui/button': path.join(nuralyUIPath, 'button'),
    '@nuralyui/canvas': path.join(nuralyUIPath, 'canvas'),
    '@nuralyui/card': path.join(nuralyUIPath, 'card'),
    '@nuralyui/chatbot': path.join(nuralyUIPath, 'chatbot'),
    '@nuralyui/checkbox': path.join(nuralyUIPath, 'checkbox'),
    '@nuralyui/collapse': path.join(nuralyUIPath, 'collapse'),
    '@nuralyui/color-picker': path.join(nuralyUIPath, 'colorpicker'),
    '@nuralyui/datepicker': path.join(nuralyUIPath, 'datepicker'),
    '@nuralyui/divider': path.join(nuralyUIPath, 'divider'),
    '@nuralyui/document': path.join(nuralyUIPath, 'document'),
    '@nuralyui/dropdown': path.join(nuralyUIPath, 'dropdown'),
    '@nuralyui/file-upload': path.join(nuralyUIPath, 'file-upload'),
    '@nuralyui/flex': path.join(nuralyUIPath, 'flex'),
    '@nuralyui/forms': path.join(nuralyUIPath, 'form'),
    '@nuralyui/grid': path.join(nuralyUIPath, 'grid'),
    '@nuralyui/icon': path.join(nuralyUIPath, 'icon'),
    '@nuralyui/image': path.join(nuralyUIPath, 'image'),
    '@nuralyui/input': path.join(nuralyUIPath, 'input'),
    '@nuralyui/label': path.join(nuralyUIPath, 'label'),
    '@nuralyui/layout': path.join(nuralyUIPath, 'layout'),
    '@nuralyui/menu': path.join(nuralyUIPath, 'menu'),
    '@nuralyui/modal': path.join(nuralyUIPath, 'modal'),
    '@nuralyui/panel': path.join(nuralyUIPath, 'panel'),
    '@nuralyui/popconfirm': path.join(nuralyUIPath, 'popconfirm'),
    '@nuralyui/radio': path.join(nuralyUIPath, 'radio'),
    '@nuralyui/select': path.join(nuralyUIPath, 'select'),
    '@nuralyui/skeleton': path.join(nuralyUIPath, 'skeleton'),
    '@nuralyui/slider-input': path.join(nuralyUIPath, 'slider-input'),
    '@nuralyui/table': path.join(nuralyUIPath, 'table'),
    '@nuralyui/tabs': path.join(nuralyUIPath, 'tabs'),
    '@nuralyui/tag': path.join(nuralyUIPath, 'tag'),
    '@nuralyui/textarea': path.join(nuralyUIPath, 'textarea'),
    '@nuralyui/timeline': path.join(nuralyUIPath, 'timeline'),
    '@nuralyui/toast': path.join(nuralyUIPath, 'toast'),
    '@nuralyui/video': path.join(nuralyUIPath, 'video'),
    '@nuralyui/radio-group': path.join(nuralyUIPath, 'radio-group'),
    '@nuralyui/iconpicker': path.join(nuralyUIPath, 'iconpicker'),
    '@nuralyui/container': path.join(nuralyUIPath, 'container'),
    '@nuralyui/code-editor': path.join(nuralyUIPath, 'code-editor'),
    '@nuralyui/common/controllers': path.join(nuralyCommonPath, 'controllers.ts'),
    '@nuralyui/common/mixins': path.join(nuralyCommonPath, 'mixins.ts'),
    '@nuralyui/common/utils': path.join(nuralyCommonPath, 'utils.ts'),
    '@nuralyui/common/themes': path.join(nuralyCommonPath, 'themes.ts'),
    '@nuralyui/common': path.join(nuralyCommonPath, 'index.ts'),
  };
}

/**
 * Resolves the NuralyUI source path. Checks:
 * 1. Sibling to the lumenjs lib (in-repo development)
 * 2. Under the studio service path (Docker context)
 */
export function resolveNuralyUIPaths(projectDir: string): { componentsPath: string; commonPath: string } | null {
  const candidates = [
    // In-repo: libs/lumenjs → services/studio/...
    path.resolve(__dirname, '../../..', 'services/studio/src/features/runtime/components/ui/nuraly-ui'),
    // Docker: /home/node/app/libs/lumenjs → studio mounted
    path.resolve('/home/node/app/services/studio/src/features/runtime/components/ui/nuraly-ui'),
    // Fallback: check NURALYUI_PATH env
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
