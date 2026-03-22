import path from 'path';
import fs from 'fs';
import { Plugin } from 'vite';

/**
 * In editor mode, inject data-nk-source attributes into html`` template literals.
 * Reads the original source file from disk to compute correct line numbers,
 * since Vite's transform hook receives esbuild-compiled code with shifted lines.
 */
export function sourceAnnotatorPlugin(projectDir: string): Plugin {
  return {
    name: 'lumenjs-source-annotator',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      if (!id.startsWith(projectDir) || !id.endsWith('.ts')) return;
      if (!code.includes('html`')) return;

      // Read the original source to get correct line numbers
      let originalSource: string;
      try {
        originalSource = fs.readFileSync(id, 'utf-8');
      } catch {
        originalSource = code;
      }
      const relativePath = path.relative(projectDir, id);

      // Build ordered list of html` base lines from original source
      const originalBaseLines: number[] = [];
      const origRegex = /html`/g;
      let origMatch;
      while ((origMatch = origRegex.exec(originalSource)) !== null) {
        const before = originalSource.substring(0, origMatch.index + 5); // include 'html`'
        originalBaseLines.push(before.split('\n').length);
      }

      let templateIndex = 0;
      const transformed = code.replace(/html`([\s\S]*?)`/g, (match, templateContent: string) => {
        let offset = 0;

        // Use original source line for this Nth html` template
        const baseLine = originalBaseLines[templateIndex] ?? code.substring(0, code.indexOf(match)).split('\n').length;
        templateIndex++;

        // Annotate both custom elements (tags with hyphens) and standard HTML elements
        const annotated = templateContent.replace(/<((?:[a-z][a-z0-9]*-[a-z0-9-]*)|(?:div|section|article|aside|main|nav|header|footer|h[1-6]|p|span|a|ul|ol|li|button|form|input|textarea|select|label|img|table|tr|td|th|thead|tbody))([\s>])/gi, (tagMatch: string, tagName: string, after: string) => {
          const beforeTag = templateContent.substring(0, templateContent.indexOf(tagMatch, offset));
          const lineInTemplate = beforeTag.split('\n').length - 1;
          offset = templateContent.indexOf(tagMatch, offset) + tagMatch.length;
          const line = baseLine + lineInTemplate;
          return `<${tagName} data-nk-source="${relativePath}:${line}"${after}`;
        });
        const dynamicAnnotated = annotated.replace(
          /<(h[1-6]|p|span|a|label|li|button|div)(\s[^>]*)?>([^<]*\$\{[^<]*)<\//gi,
          (m, tag, attrs, content) => {
            const attrStr = attrs || '';
            if (attrStr.includes('data-nk-dynamic')) return m;
            const escaped = content.trim().replace(/"/g, '&quot;').replace(/\$\{/g, '__NK_EXPR__');
            return `<${tag}${attrStr} data-nk-dynamic="${escaped}">${content}</`;
          }
        );
        // Detect t('key') calls inside template expressions and add data-nk-i18n-key
        const i18nAnnotated = dynamicAnnotated.replace(
          /<(h[1-6]|p|span|a|label|li|button|div)(\s[^>]*)?>([^<]*\$\{t\(['"]([^'"]+)['"]\)\}[^<]*)<\//gi,
          (m, tag, attrs, content, key) => {
            const attrStr = attrs || '';
            if (attrStr.includes('data-nk-i18n-key')) return m;
            return `<${tag}${attrStr} data-nk-i18n-key="${key}">${content}</`;
          }
        );
        return 'html`' + i18nAnnotated + '`';
      });
      if (transformed !== code) {
        return { code: transformed, map: null };
      }
    }
  };
}
