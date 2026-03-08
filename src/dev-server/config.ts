import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ProjectConfig {
  title: string;
  integrations: string[];
}

/**
 * Reads the project config from lumenjs.config.ts.
 */
export function readProjectConfig(projectDir: string): ProjectConfig {
  let title = 'LumenJS App';
  let integrations: string[] = [];
  const configPath = path.join(projectDir, 'lumenjs.config.ts');
  if (fs.existsSync(configPath)) {
    try {
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
    } catch { /* use defaults */ }
  }
  return { title, integrations };
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
