import fs from 'fs';
import path from 'path';

/**
 * File service for the editor — scoped to a single project directory.
 * Provides safe file CRUD with path-traversal protection.
 */
export class EditorFileService {
  constructor(private projectDir: string) {}

  listFiles(): string[] {
    if (!fs.existsSync(this.projectDir)) return [];
    const results: string[] = [];
    this.walkDir(this.projectDir, results);
    return results;
  }

  readFile(filePath: string): string {
    const resolved = this.resolveSafe(filePath);
    return fs.readFileSync(resolved, 'utf-8');
  }

  writeFile(filePath: string, content: string): void {
    const resolved = this.resolveSafe(filePath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, content);
  }

  private walkDir(dir: string, results: string[]) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const relative = path.relative(this.projectDir, full);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== '.git' && entry.name !== '.lumenjs') {
          this.walkDir(full, results);
        }
      } else {
        results.push(relative);
      }
    }
  }

  /**
   * Resolve a file path within the project, preventing path traversal.
   */
  private resolveSafe(filePath: string): string {
    const resolved = path.resolve(this.projectDir, filePath);
    if (!resolved.startsWith(this.projectDir + path.sep) && resolved !== this.projectDir) {
      throw new Error('Path traversal detected');
    }
    return resolved;
  }
}
