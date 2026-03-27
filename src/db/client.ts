/**
 * Public-facing DB module for user loaders and API routes.
 * Auto-detects project directory from process.env or cwd.
 */
import { getProjectDir, setProjectDir } from './context.js';
import { useDb as _useDb, LumenDb } from './index.js';

export { LumenDb, waitForSeed } from './index.js';

export function useDb(): LumenDb {
  try {
    getProjectDir();
  } catch {
    // Auto-set from env or cwd
    const dir = process.env.LUMENJS_PROJECT_DIR || process.cwd();
    setProjectDir(dir);
  }
  return _useDb();
}
