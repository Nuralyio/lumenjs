import { AstModification } from './ast-modification.js';

/**
 * AST Service — parses TypeScript Lit components and applies modifications
 * to the html`` tagged template literals.
 *
 * Uses ts-morph to locate the render() method's template literal,
 * then applies string-level HTML modifications.
 */
export class AstService {

  /**
   * Apply an AST modification to a TypeScript source file.
   * Returns the modified source string.
   */
  async applyModification(sourceCode: string, modification: AstModification): Promise<string> {
    // Dynamic import — ts-morph is an optional peer dependency.
    // Use a variable to prevent TypeScript from resolving the module at compile time.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let tsMorph: any;
    const moduleName = 'ts-morph';
    try {
      tsMorph = await import(moduleName);
    } catch {
      throw new Error('ts-morph is required for AST modifications. Install it with: npm install ts-morph');
    }

    const Project = tsMorph.Project;
    const SyntaxKind = tsMorph.SyntaxKind;

    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile('temp.ts', sourceCode);

    // Find the render() method
    const renderMethod = sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration)
      .find((m: any) => m.getName() === 'render');

    if (!renderMethod) {
      throw new Error('No render() method found in source file');
    }

    // Find the html tagged template expression inside render()
    const taggedTemplates = renderMethod.getDescendantsOfKind(SyntaxKind.TaggedTemplateExpression);
    const htmlTemplate = taggedTemplates.find((t: any) => t.getTag().getText() === 'html');

    if (!htmlTemplate) {
      throw new Error('No html`` tagged template found in render()');
    }

    const template = htmlTemplate.getTemplate();
    const templateStart = template.getStart() + 1; // skip opening backtick
    const templateEnd = template.getEnd() - 1; // skip closing backtick
    const templateText = sourceCode.substring(templateStart, templateEnd);

    // Calculate the line number where the template starts in the source file
    const templateStartLine = sourceCode.substring(0, templateStart).split('\n').length;

    const modifiedHtml = this.applyHtmlModification(templateText, modification, templateStartLine);

    // Reconstruct the source with the modified template
    const fullText = sourceFile.getFullText();
    let result = fullText.substring(0, templateStart) + modifiedHtml + fullText.substring(templateEnd);

    // For makeTranslatable, ensure `import { t } from '@lumenjs/i18n'` exists
    if (modification.type === 'makeTranslatable') {
      result = this.ensureTImport(result, tsMorph);
    }

    return result;
  }

  private ensureTImport(sourceCode: string, tsMorph: any): string {
    const Project = tsMorph.Project;
    const SyntaxKind = tsMorph.SyntaxKind;

    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile('temp.ts', sourceCode);

    const importDecls = sf.getDescendantsOfKind(SyntaxKind.ImportDeclaration);
    const i18nImport = importDecls.find((d: any) => d.getModuleSpecifierValue() === '@lumenjs/i18n');

    if (i18nImport) {
      const namedImports = i18nImport.getNamedImports();
      const hasT = namedImports.some((n: any) => n.getName() === 't');
      if (!hasT) {
        i18nImport.addNamedImport('t');
        return sf.getFullText();
      }
      return sourceCode; // already has t import
    }

    // No @lumenjs/i18n import — add after last import
    const lastImport = importDecls.length > 0 ? importDecls[importDecls.length - 1] : null;
    if (lastImport) {
      const end = lastImport.getEnd();
      return sourceCode.substring(0, end) + `\nimport { t } from '@lumenjs/i18n';` + sourceCode.substring(end);
    }

    // No imports at all — add at top
    return `import { t } from '@lumenjs/i18n';\n` + sourceCode;
  }

  private applyHtmlModification(html: string, mod: AstModification, templateStartLine: number): string {
    switch (mod.type) {
      case 'setAttribute':
        return this.setAttribute(html, mod.elementSelector, mod.attributeName!, mod.attributeValue!, mod.sourceLine, templateStartLine);
      case 'removeAttribute':
        return this.removeAttribute(html, mod.elementSelector, mod.attributeName!, mod.sourceLine, templateStartLine);
      case 'setTextContent':
        return this.setTextContent(html, mod.elementSelector, mod.html || '', mod.sourceLine, templateStartLine);
      case 'makeTranslatable':
        return this.setTextContent(html, mod.elementSelector, `\${t('${mod.i18nKey}')}`, mod.sourceLine, templateStartLine);
      case 'insertElement':
        return this.insertElement(html, mod.parentSelector || mod.elementSelector, mod.position || 'lastChild', mod.html || '', mod.sourceLine, templateStartLine);
      case 'removeElement':
        return this.removeElement(html, mod.elementSelector, mod.sourceLine, templateStartLine);
      default:
        throw new Error(`Unsupported modification type: ${mod.type}`);
    }
  }

  /**
   * Find an element's open tag in the template HTML.
   * If sourceLine is provided, finds the occurrence at that specific source line.
   * Otherwise falls back to first match by tag/selector.
   */
  private findElement(html: string, selector: string, sourceLine?: number, templateStartLine?: number): { match: RegExpExecArray; tag: string } {
    const { tag, attrFilter } = this.parseSelector(selector);
    const openTagRegex = this.buildOpenTagRegex(tag, attrFilter);

    // If we have a source line, find the occurrence at that line
    if (sourceLine && templateStartLine) {
      const targetLineInTemplate = sourceLine - templateStartLine;
      let m: RegExpExecArray | null;
      const globalRegex = new RegExp(openTagRegex.source, openTagRegex.flags.includes('g') ? openTagRegex.flags : openTagRegex.flags + 'g');
      let fuzzyMatch: RegExpExecArray | null = null;
      while ((m = globalRegex.exec(html)) !== null) {
        const linesBeforeMatch = html.substring(0, m.index).split('\n').length - 1;
        const diff = Math.abs(linesBeforeMatch - targetLineInTemplate);
        if (diff === 0) {
          return { match: m, tag }; // Exact line match — return immediately
        }
        if (diff <= 1 && !fuzzyMatch) {
          fuzzyMatch = m; // Save first ±1 match as fallback
        }
      }
      if (fuzzyMatch) return { match: fuzzyMatch, tag };
      // Fall through to first-match if line-based match fails
    }

    const match = openTagRegex.exec(html);
    if (!match) throw new Error(`Element not found: ${selector}`);
    return { match, tag };
  }

  private setAttribute(html: string, selector: string, attrName: string, attrValue: string, sourceLine?: number, templateStartLine?: number): string {
    const { match } = this.findElement(html, selector, sourceLine, templateStartLine);

    const openTag = match[0];
    const existingAttrRegex = new RegExp(`(\\s)${this.escapeRegex(attrName)}\\s*=\\s*("(?:[^"$]|\\$\\{[^}]*\\})*"|'(?:[^'$]|\\$\\{[^}]*\\})*'|\\$\\{[^}]*\\}|\\S+)`);
    const existingMatch = existingAttrRegex.exec(openTag);

    let newOpenTag: string;
    if (existingMatch) {
      newOpenTag = openTag.replace(existingAttrRegex, `$1${attrName}="${attrValue}"`);
    } else {
      newOpenTag = openTag.replace(/(\/?>)$/, ` ${attrName}="${attrValue}"$1`);
    }

    return html.substring(0, match.index) + newOpenTag + html.substring(match.index + openTag.length);
  }

  private removeAttribute(html: string, selector: string, attrName: string, sourceLine?: number, templateStartLine?: number): string {
    const { match } = this.findElement(html, selector, sourceLine, templateStartLine);

    const openTag = match[0];
    const attrRegex = new RegExp(`\\s+${this.escapeRegex(attrName)}\\s*=\\s*("[^"]*"|'[^']*'|\\S+)`, 'g');
    const newOpenTag = openTag.replace(attrRegex, '');

    return html.substring(0, match.index) + newOpenTag + html.substring(match.index + openTag.length);
  }

  private setTextContent(html: string, selector: string, text: string, sourceLine?: number, templateStartLine?: number): string {
    const { match, tag } = this.findElement(html, selector, sourceLine, templateStartLine);

    const afterOpenTag = match.index + match[0].length;
    const closeTag = `</${tag}>`;
    const closeIndex = html.indexOf(closeTag, afterOpenTag);
    if (closeIndex === -1) throw new Error(`Closing tag not found for: ${tag}`);

    return html.substring(0, afterOpenTag) + text + html.substring(closeIndex);
  }

  private insertElement(html: string, parentSelector: string, position: string, newHtml: string, sourceLine?: number, templateStartLine?: number): string {
    const { match, tag } = this.findElement(html, parentSelector, sourceLine, templateStartLine);

    const closeTag = `</${tag}>`;
    const closeIndex = html.indexOf(closeTag, match.index + match[0].length);
    if (closeIndex === -1) throw new Error(`Closing tag not found for: ${tag}`);

    switch (position) {
      case 'firstChild': {
        const insertAt = match.index + match[0].length;
        return html.substring(0, insertAt) + '\n        ' + newHtml + html.substring(insertAt);
      }
      case 'lastChild': {
        return html.substring(0, closeIndex) + '        ' + newHtml + '\n      ' + html.substring(closeIndex);
      }
      case 'before': {
        return html.substring(0, match.index) + newHtml + '\n      ' + html.substring(match.index);
      }
      case 'after': {
        const afterClose = closeIndex + closeTag.length;
        return html.substring(0, afterClose) + '\n      ' + newHtml + html.substring(afterClose);
      }
      default:
        throw new Error(`Unknown position: ${position}`);
    }
  }

  private removeElement(html: string, selector: string, sourceLine?: number, templateStartLine?: number): string {
    const { match, tag } = this.findElement(html, selector, sourceLine, templateStartLine);

    // Check if self-closing
    if (match[0].endsWith('/>')) {
      return html.substring(0, match.index) + html.substring(match.index + match[0].length);
    }

    const closeTag = `</${tag}>`;
    const closeIndex = html.indexOf(closeTag, match.index + match[0].length);
    if (closeIndex === -1) {
      return html.substring(0, match.index) + html.substring(match.index + match[0].length);
    }

    return html.substring(0, match.index) + html.substring(closeIndex + closeTag.length);
  }

  private parseSelector(selector: string): { tag: string; attrFilter?: { name: string; value: string } } {
    const bracketMatch = selector.match(/^([a-zA-Z][a-zA-Z0-9-]*)\[([a-zA-Z][a-zA-Z0-9-]*)=['"]([^'"]+)['"]\]$/);
    if (bracketMatch) {
      return { tag: bracketMatch[1], attrFilter: { name: bracketMatch[2], value: bracketMatch[3] } };
    }
    return { tag: selector };
  }

  private buildOpenTagRegex(tag: string, attrFilter?: { name: string; value: string }): RegExp {
    const attrContent = '(?:[^>$]|\\$\\{[^}]*\\})*';
    if (attrFilter) {
      return new RegExp(`<${this.escapeRegex(tag)}\\s${attrContent}${this.escapeRegex(attrFilter.name)}\\s*=\\s*["']${this.escapeRegex(attrFilter.value)}["']${attrContent}\\/?>`, 's');
    }
    return new RegExp(`<${this.escapeRegex(tag)}(\\s${attrContent})?\\/?>`, 's');
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
