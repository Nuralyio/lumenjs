import { Plugin } from 'vite';
import { tagToPackage, implicitDeps } from '../nuralyui-aliases.js';

/**
 * Auto-import NuralyUI components based on nr-* tags used in html`` templates.
 */
export function autoImportPlugin(projectDir: string): Plugin {
  return {
    name: 'lumenjs-auto-import',
    transform(code: string, id: string) {
      if (!id.startsWith(projectDir) || !id.endsWith('.ts')) return;
      if (!code.includes('html`')) return;

      // Only treat a package as "already imported" when it appears in an
      // actual ES import statement. Bare occurrences in strings (e.g. doc
      // snippets shown via <code-block>import '...'</code-block>) must not
      // suppress auto-import.
      const isImported = (pkg: string): boolean => {
        const escaped = pkg.replace(/[/.\-]/g, '\\$&');
        return new RegExp(`(?:^|\\n)\\s*import\\b[^'"\\n]*['"]${escaped}['"]`, 'm').test(code);
      };

      const directTags = new Set<string>();
      const depTags = new Set<string>();
      for (const [tag] of Object.entries(tagToPackage)) {
        if (code.includes(`<${tag}`) && !isImported(tagToPackage[tag])) {
          directTags.add(tag);
          const deps = implicitDeps[tag];
          if (deps) {
            for (const dep of deps) {
              depTags.add(dep);
            }
          }
        }
      }

      // Import dependencies BEFORE the components that need them.
      // ES module side effects (customElements.define) run in source order,
      // so nr-icon must be registered before nr-button upgrades SSR elements.
      const imports: string[] = [];
      for (const tag of depTags) {
        const pkg = tagToPackage[tag];
        if (pkg && !directTags.has(tag) && !isImported(pkg)) {
          imports.push(`import '${pkg}';`);
        }
      }
      for (const tag of directTags) {
        const pkg = tagToPackage[tag];
        if (pkg && !isImported(pkg)) {
          imports.push(`import '${pkg}';`);
        }
      }
      if (imports.length === 0) return;

      return { code: imports.join('\n') + '\n' + code, map: null };
    }
  };
}
