import fs from 'fs';
import path from 'path';
import { Plugin } from 'vite';

/**
 * Virtual module plugin — serves compiled LumenJS runtime and editor modules.
 */
export function virtualModulesPlugin(runtimeDir: string, editorDir: string): Plugin {
  return {
    name: 'lumenjs-virtual-modules',
    resolveId(id) {
      if (id === '/@lumenjs/app-shell') return '\0lumenjs:app-shell';
      if (id === '/@lumenjs/router') return '\0lumenjs:router';
      if (id === '/@lumenjs/editor-bridge') return '\0lumenjs:editor-bridge';
      if (id === '/@lumenjs/element-annotator') return '\0lumenjs:element-annotator';
    },
    load(id) {
      if (id === '\0lumenjs:app-shell') {
        let code = fs.readFileSync(path.join(runtimeDir, 'app-shell.js'), 'utf-8');
        code = code.replace(/from\s+['"]\.\/router\.js['"]/g, "from '/@lumenjs/router'");
        return code;
      }
      if (id === '\0lumenjs:router') {
        return fs.readFileSync(path.join(runtimeDir, 'router.js'), 'utf-8');
      }
      if (id === '\0lumenjs:editor-bridge') {
        let code = fs.readFileSync(path.join(editorDir, 'editor-bridge.js'), 'utf-8');
        code = code.replace(/from\s+['"]\.\/element-annotator\.js['"]/g, "from '/@lumenjs/element-annotator'");
        return code;
      }
      if (id === '\0lumenjs:element-annotator') {
        return fs.readFileSync(path.join(editorDir, 'element-annotator.js'), 'utf-8');
      }
    }
  };
}
