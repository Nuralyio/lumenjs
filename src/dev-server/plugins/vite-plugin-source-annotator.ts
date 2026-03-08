import path from 'path';
import { Plugin } from 'vite';

/**
 * In editor mode, inject data-nk-source attributes into html`` template literals.
 */
export function sourceAnnotatorPlugin(projectDir: string): Plugin {
  return {
    name: 'lumenjs-source-annotator',
    transform(code: string, id: string) {
      if (!id.startsWith(projectDir) || !id.endsWith('.ts')) return;
      if (!code.includes('html`')) return;

      const relativePath = path.relative(projectDir, id);
      const transformed = code.replace(/html`([\s\S]*?)`/g, (match, templateContent: string) => {
        let offset = 0;
        const beforeTemplate = code.substring(0, code.indexOf(match));
        const baseLine = beforeTemplate.split('\n').length;

        const annotated = templateContent.replace(/<([a-z][a-z0-9]*-[a-z0-9-]*)([\s>])/gi, (tagMatch: string, tagName: string, after: string) => {
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
