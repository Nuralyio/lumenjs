import fs from 'fs';
import path from 'path';
import { Plugin } from 'vite';

/**
 * Virtual module plugin — serves compiled LumenJS runtime and editor modules.
 * Rewrites relative imports between split sub-modules to virtual module paths.
 *
 * i18n is resolved via resolve.alias (physical file) rather than as a virtual
 * module, because Vite's import-analysis rejects bare @-prefixed specifiers
 * that go through the virtual module path.
 */
export function virtualModulesPlugin(runtimeDir: string, editorDir: string): Plugin {
  const runtimeModules: Record<string, string> = {
    'app-shell': 'app-shell.js',
    'router': 'router.js',
    'router-data': 'router-data.js',
    'router-hydration': 'router-hydration.js',
    'nk-island': 'nk-island.js',
    'i18n': 'i18n.js',
  };

  // Modules resolved via resolve.alias instead of virtual module.
  // They still appear in the map so relative import rewrites work.
  const aliasedModules = new Set(['i18n']);

  const editorModules: Record<string, string> = {
    'editor-bridge': 'editor-bridge.js',
    'element-annotator': 'element-annotator.js',
    'click-select': 'click-select.js',
    'hover-detect': 'hover-detect.js',
    'inline-text-edit': 'inline-text-edit.js',
    'editor-api-client': 'editor-api-client.js',
    'standalone-overlay': 'standalone-overlay.js',
    'property-registry': 'property-registry.js',
    'properties-panel': 'properties-panel.js',
    'i18n-key-gen': 'i18n-key-gen.js',
    'ai-chat-panel': 'ai-chat-panel.js',
    'ai-project-panel': 'ai-project-panel.js',
  };

  function rewriteRelativeImports(code: string, modules: Record<string, string>): string {
    for (const name of Object.keys(modules)) {
      const file = modules[name];
      // Aliased modules use @lumenjs/name (resolved by Vite alias).
      // Virtual modules use /@lumenjs/name (resolved by this plugin).
      const prefix = aliasedModules.has(name) ? '@lumenjs' : '/@lumenjs';
      code = code.replace(
        new RegExp(`from\\s+['"]\\.\\/${file.replace('.', '\\.')}['"]`, 'g'),
        `from '${prefix}/${name}'`
      );
    }
    return code;
  }

  return {
    name: 'lumenjs-virtual-modules',
    enforce: 'pre' as const,
    configureServer(server) {
      // Disable 304 caching for virtual modules so restarted server always sends fresh code
      server.middlewares.use((req, _res, next) => {
        if (req.url?.includes('__x00__lumenjs:') || req.url?.includes('@lumenjs/')) {
          // Remove If-None-Match / If-Modified-Since so Vite won't respond 304
          delete req.headers['if-none-match'];
          delete req.headers['if-modified-since'];
        }
        next();
      });
    },
    resolveId(id) {
      const match = id.match(/^\/@lumenjs\/(.+)$/);
      if (!match) return;
      const name = match[1];
      // Skip aliased modules — they're resolved via resolve.alias
      if (aliasedModules.has(name)) return;
      if (runtimeModules[name] || editorModules[name]) {
        return `\0lumenjs:${name}`;
      }
    },
    load(id) {
      if (!id.startsWith('\0lumenjs:')) return;
      const name = id.slice('\0lumenjs:'.length);

      if (runtimeModules[name]) {
        const code = fs.readFileSync(path.join(runtimeDir, runtimeModules[name]), 'utf-8');
        return rewriteRelativeImports(code, runtimeModules);
      }
      if (editorModules[name]) {
        const code = fs.readFileSync(path.join(editorDir, editorModules[name]), 'utf-8');
        return rewriteRelativeImports(code, editorModules);
      }
    }
  };
}
