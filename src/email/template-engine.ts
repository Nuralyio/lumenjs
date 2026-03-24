import { renderTemplate, renderButton } from './templates/base.js';
import type { TemplateData } from './types.js';

/** Escape HTML entities */
function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Resolve a dotted path like "user.name" from an object */
function resolve(obj: any, path: string): any {
  let current = obj;
  for (const part of path.split('.')) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

/** Interpolate {{var}} or {{obj.prop}} inside a string */
function interpolate(str: string, data: any, escape: boolean): string {
  return str.replace(/\{\{(\w[\w.]*)\}\}/g, (_m, path: string) => {
    const value = resolve(data, path);
    const s = value != null ? String(value) : '';
    return escape ? escapeHtml(s) : s;
  });
}

/**
 * Compile an HTML template string with Handlebars-like syntax.
 *
 * Variables:
 *   {{variable}}                — HTML-escaped
 *   {{obj.prop}}                — dotted path access
 *   {{{variable}}}              — raw/unescaped
 *
 * Blocks:
 *   {{#if variable}}...{{/if}}  — conditional (truthy check)
 *   {{#each items}}...{{/each}} — loop over array. Inside: {{name}}, {{@index}}
 *
 * Helpers:
 *   {{#button url="..." text="..."}} — renders CTA button
 *   {{#layout}}...{{/layout}}        — wraps content in base email layout
 */
export function compileTemplate(html: string, data: TemplateData): string {
  let result = html;

  // 1. {{#layout}}...{{/layout}}
  const layoutMatch = result.match(/\{\{#layout\}\}([\s\S]*?)\{\{\/layout\}\}/);
  let useLayout = false;
  if (layoutMatch) {
    result = layoutMatch[1];
    useLayout = true;
  }

  // 2. {{#each items}}...{{/each}} (supports nesting)
  result = processEach(result, data);

  // 3. {{#if variable}}...{{/if}} (no nesting for simplicity)
  result = result.replace(
    /\{\{#if\s+([\w.]+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_match, path: string, content: string) => {
      const value = resolve(data, path);
      return value ? content : '';
    },
  );

  // 4. {{#button url="..." text="..."}}
  result = result.replace(
    /\{\{#button\s+url="([^"]*?)"\s+text="([^"]*?)"\s*\}\}/g,
    (_match, url: string, text: string) => {
      return renderButton(interpolate(text, data, false), interpolate(url, data, false));
    },
  );

  // 5. {{{variable}}} — raw
  result = result.replace(
    /\{\{\{([\w.]+)\}\}\}/g,
    (_match, path: string) => {
      const value = resolve(data, path);
      return value != null ? String(value) : '';
    },
  );

  // 6. {{variable}} — escaped
  result = result.replace(
    /\{\{([\w.]+)\}\}/g,
    (_match, path: string) => {
      // Skip @index (already replaced in each loop)
      if (path.startsWith('@')) return '';
      const value = resolve(data, path);
      return value != null ? escapeHtml(String(value)) : '';
    },
  );

  // 7. Wrap in layout
  if (useLayout) {
    result = renderTemplate(data.appName, result);
  }

  return result;
}

/** Process {{#each items}}...{{/each}} blocks, resolving item variables */
function processEach(html: string, data: any): string {
  return html.replace(
    /\{\{#each\s+([\w.]+)\}\}([\s\S]*?)\{\{\/each\}\}/g,
    (_match, path: string, body: string) => {
      const items = resolve(data, path);
      if (!Array.isArray(items)) return '';

      return items.map((item, index) => {
        let row = body;

        // Replace {{@index}}
        row = row.replace(/\{\{@index\}\}/g, String(index));

        // If item is an object, replace {{prop}} with item.prop
        if (item && typeof item === 'object') {
          // Process nested {{#if}} within the loop context
          row = row.replace(
            /\{\{#if\s+([\w.]+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
            (_m, p: string, content: string) => {
              const value = resolve(item, p) ?? resolve(data, p);
              return value ? content : '';
            },
          );

          // Replace {{{prop}}} raw
          row = row.replace(/\{\{\{([\w.]+)\}\}\}/g, (_m, p: string) => {
            const v = resolve(item, p) ?? resolve(data, p);
            return v != null ? String(v) : '';
          });

          // Replace {{prop}} escaped
          row = row.replace(/\{\{([\w.]+)\}\}/g, (_m, p: string) => {
            if (p.startsWith('@')) return '';
            const v = resolve(item, p) ?? resolve(data, p);
            return v != null ? escapeHtml(String(v)) : '';
          });
        } else {
          // Primitive item — replace {{.}} or {{this}}
          row = row.replace(/\{\{\.?\}\}|\{\{this\}\}/g, escapeHtml(String(item)));
        }

        return row;
      }).join('');
    },
  );
}
