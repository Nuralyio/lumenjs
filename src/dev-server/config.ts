import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import type { SecurityHeadersConfig } from '../shared/security-headers.js';
import type { RateLimitConfig } from '../shared/rate-limit.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface I18nConfig {
  locales: string[];
  defaultLocale: string;
  prefixDefault: boolean;
}

export type PrefetchStrategy = 'hover' | 'viewport' | 'none';

export interface ProjectConfig {
  title: string;
  integrations: string[];
  i18n?: I18nConfig;
  db?: { path?: string };
  prefetch: PrefetchStrategy;
  prerender?: boolean;
  /** App version for health check. Default: reads from package.json. */
  version?: string;
  /** Security headers config. Applied in production. */
  securityHeaders?: SecurityHeadersConfig;
  /** Rate limiting config. Applied in production. */
  rateLimit?: RateLimitConfig;
}

/**
 * Reads the project config from lumenjs.config.ts.
 */
export function readProjectConfig(projectDir: string): ProjectConfig {
  let title = 'LumenJS App';
  let integrations: string[] = [];
  let prefetch: PrefetchStrategy = 'viewport';
  let prerender: boolean | undefined;
  let i18n: I18nConfig | undefined;
  let securityHeaders: { contentSecurityPolicy?: string } | undefined;

  const configPath = path.join(projectDir, 'lumenjs.config.ts');
  if (fs.existsSync(configPath)) {
    try {
      // Read the config file once and parse all fields from the same content
      const configContent = fs.readFileSync(configPath, 'utf-8');

      const titleMatch = configContent.match(/title\s*:\s*['"]([^'"]+)['"]/);
      if (titleMatch) title = titleMatch[1];

      const intMatch = configContent.match(/integrations\s*:\s*\[([^\]]*)\]/);
      if (intMatch) {
        integrations = intMatch[1]
          .split(',')
          .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
          .filter(Boolean);
      }

      const prefetchMatch = configContent.match(/prefetch\s*:\s*['"]([^'"]+)['"]/);
      if (prefetchMatch) {
        const val = prefetchMatch[1];
        if (val === 'hover' || val === 'viewport' || val === 'none') {
          prefetch = val as PrefetchStrategy;
        }
      }

      const prerenderMatch = configContent.match(/prerender\s*:\s*(true|false)/);
      if (prerenderMatch) {
        prerender = prerenderMatch[1] === 'true';
      }

      const secHeadersMatch = configContent.match(/securityHeaders\s*:\s*\{([\s\S]*?)\}/);
      if (secHeadersMatch) {
        const block = secHeadersMatch[1];
        const cspMatch = block.match(/contentSecurityPolicy\s*:\s*['"`]([^'"`]+)['"`]/);
        if (cspMatch) securityHeaders = { contentSecurityPolicy: cspMatch[1] };
      }

      const i18nMatch = configContent.match(/i18n\s*:\s*\{([\s\S]*?)\}/);
      if (i18nMatch) {
        const block = i18nMatch[1];
        const localesMatch = block.match(/locales\s*:\s*\[([^\]]*)\]/);
        const defaultMatch = block.match(/defaultLocale\s*:\s*['"]([^'"]+)['"]/);
        const prefixMatch = block.match(/prefixDefault\s*:\s*(true|false)/);
        if (localesMatch && defaultMatch) {
          const locales = localesMatch[1]
            .split(',')
            .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean);
          i18n = {
            locales,
            defaultLocale: defaultMatch[1],
            prefixDefault: prefixMatch ? prefixMatch[1] === 'true' : false,
          };
        }
      }
    } catch { /* use defaults */ }
  }

  // Read version from project's package.json
  let version: string | undefined;
  const pkgPath = path.join(projectDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      version = pkg.version;
    } catch { /* ignore */ }
  }

  return { title, integrations, prefetch, version, ...(i18n ? { i18n } : {}), ...(prerender ? { prerender } : {}), ...(securityHeaders ? { securityHeaders } : {}) };
}

/**
 * Reads the project title from lumenjs.config.ts (or returns default).
 * @deprecated Use readProjectConfig() instead.
 */
export function readProjectTitle(projectDir: string): string {
  return readProjectConfig(projectDir).title;
}

/**
 * Returns the path to lumenjs's own node_modules.
 */
export function getLumenJSNodeModules(): string {
  return path.resolve(__dirname, '../../node_modules');
}

/**
 * Returns paths to lumenjs's compiled dist/ runtime and editor directories.
 */
export function getLumenJSDirs(): { distDir: string; runtimeDir: string; editorDir: string } {
  const lumenRoot = path.resolve(__dirname, '../..');
  const distDir = path.join(lumenRoot, 'dist');
  return {
    distDir,
    runtimeDir: path.join(distDir, 'runtime'),
    editorDir: path.join(distDir, 'editor'),
  };
}
