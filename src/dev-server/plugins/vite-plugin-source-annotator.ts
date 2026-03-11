import fs from 'fs';
import path from 'path';
import { Plugin } from 'vite';

/**
 * In editor mode, inject data-nk-source attributes into html`` template literals.
 * Annotates both custom elements (tags with hyphens) and standard HTML elements
 * so the editor overlay can map any visible element back to source code.
 *
 * Line numbers are computed from the original file on disk (not the `code`
 * parameter) so SSR and client transforms produce identical attribute values,
 * avoiding Lit hydration mismatches.
 */
export function sourceAnnotatorPlugin(projectDir: string): Plugin {
  // Tags that get data-nk-source for click-to-select
  const sourceTags = 'section|div|nav|header|footer|main|article|aside|form|ul|ol|table|h[1-6]|p|span|a|label|li|button|img|pre|code|blockquote';

  return {
    name: 'lumenjs-source-annotator',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      if (!id.startsWith(projectDir) || !id.endsWith('.ts')) return;
      if (!code.includes('html`')) return;

      const relativePath = path.relative(projectDir, id);

      // Read the original file from disk to compute stable line numbers.
      // The `code` parameter may differ between SSR and client transforms
      // (e.g. decorator transforms change line count), but the original
      // file is always the same, so line numbers will be consistent.
      let originalCode: string;
      try {
        originalCode = fs.readFileSync(id, 'utf-8');
      } catch {
        originalCode = code;
      }

      const transformed = code.replace(/html`([\s\S]*?)`/g, (match, templateContent: string) => {
        // Find the template content in the original file to get the true base line.
        // The template content is identical in both original and transformed code.
        const templateIdx = originalCode.indexOf(templateContent);
        const baseLine = templateIdx !== -1
          ? originalCode.substring(0, templateIdx).split('\n').length
          : code.substring(0, code.indexOf(match)).split('\n').length;

        let offset = 0;

        // Annotate custom elements (tags with hyphens)
        const annotated = templateContent.replace(/<([a-z][a-z0-9]*-[a-z0-9-]*)([\s>])/gi, (tagMatch: string, tagName: string, after: string) => {
          const beforeTag = templateContent.substring(0, templateContent.indexOf(tagMatch, offset));
          const lineInTemplate = beforeTag.split('\n').length - 1;
          offset = templateContent.indexOf(tagMatch, offset) + tagMatch.length;
          const line = baseLine + lineInTemplate;
          return `<${tagName} data-nk-source="${relativePath}:${line}"${after}`;
        });

        // Annotate standard HTML elements for source mapping
        offset = 0;
        const sourcePattern = new RegExp(`<(${sourceTags})(\\s[^>]*)?>`, 'gi');
        const sourceAnnotated = annotated.replace(sourcePattern, (tagMatch: string, tagName: string, restAttrs: string) => {
          const attrStr = restAttrs || '';
          // Skip if already has data-nk-source
          if (attrStr.includes('data-nk-source')) return tagMatch;
          const beforeTag = annotated.substring(0, annotated.indexOf(tagMatch, offset));
          const lineInTemplate = beforeTag.split('\n').length - 1;
          offset = annotated.indexOf(tagMatch, offset) + tagMatch.length;
          const line = baseLine + lineInTemplate;
          return `<${tagName} data-nk-source="${relativePath}:${line}"${attrStr}>`;
        });

        const dynamicAnnotated = sourceAnnotated.replace(
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
