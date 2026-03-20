import { describe, it, expect } from 'vitest';
import { AstService } from './ast-service.js';

let hasTsMorph = false;
try { await import('ts-morph'); hasTsMorph = true; } catch {}

const service = new AstService();

const sampleComponent = `import { html, css, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('page-index')
export class PageIndex extends LitElement {
  static styles = css\`:host { display: block; }\`;

  render() {
    return html\`
      <nr-container>
        <nr-card>
          <h1>Hello World</h1>
          <p>Welcome to LumenJS</p>
          <nr-button variant="primary">Click me</nr-button>
        </nr-card>
      </nr-container>
    \`;
  }
}
`;

describe.skipIf(!hasTsMorph)('AstService', () => {
  describe('setTextContent', () => {
    it('changes text content of an element', async () => {
      const result = await service.applyModification(sampleComponent, {
        type: 'setTextContent',
        elementSelector: 'h1',
        html: 'New Title',
      });
      expect(result).toContain('<h1>New Title</h1>');
      expect(result).not.toContain('Hello World');
    });

    it('changes paragraph text', async () => {
      const result = await service.applyModification(sampleComponent, {
        type: 'setTextContent',
        elementSelector: 'p',
        html: 'Updated paragraph',
      });
      expect(result).toContain('<p>Updated paragraph</p>');
    });
  });

  describe('setAttribute', () => {
    it('adds a new attribute', async () => {
      const result = await service.applyModification(sampleComponent, {
        type: 'setAttribute',
        elementSelector: 'h1',
        attributeName: 'class',
        attributeValue: 'title',
      });
      expect(result).toContain('class="title"');
    });

    it('replaces an existing attribute value', async () => {
      const result = await service.applyModification(sampleComponent, {
        type: 'setAttribute',
        elementSelector: 'nr-button',
        attributeName: 'variant',
        attributeValue: 'secondary',
      });
      expect(result).toContain('variant="secondary"');
      expect(result).not.toContain('variant="primary"');
    });
  });

  describe('removeAttribute', () => {
    it('removes an attribute', async () => {
      const result = await service.applyModification(sampleComponent, {
        type: 'removeAttribute',
        elementSelector: 'nr-button',
        attributeName: 'variant',
      });
      expect(result).not.toContain('variant=');
      expect(result).toContain('<nr-button');
    });
  });

  describe('insertElement', () => {
    it('inserts as lastChild', async () => {
      const result = await service.applyModification(sampleComponent, {
        type: 'insertElement',
        elementSelector: 'nr-card',
        position: 'lastChild',
        html: '<span>New child</span>',
      });
      expect(result).toContain('<span>New child</span>');
      // New child should appear before </nr-card>
      const cardCloseIdx = result.indexOf('</nr-card>');
      const newChildIdx = result.indexOf('<span>New child</span>');
      expect(newChildIdx).toBeLessThan(cardCloseIdx);
    });

    it('inserts as firstChild', async () => {
      const result = await service.applyModification(sampleComponent, {
        type: 'insertElement',
        elementSelector: 'nr-card',
        position: 'firstChild',
        html: '<span>First</span>',
      });
      // firstChild should appear before h1
      const firstIdx = result.indexOf('<span>First</span>');
      const h1Idx = result.indexOf('<h1>');
      expect(firstIdx).toBeLessThan(h1Idx);
    });

    it('inserts after element', async () => {
      const result = await service.applyModification(sampleComponent, {
        type: 'insertElement',
        elementSelector: 'h1',
        position: 'after',
        html: '<h2>Subtitle</h2>',
      });
      const h1CloseIdx = result.indexOf('</h1>');
      const h2Idx = result.indexOf('<h2>Subtitle</h2>');
      expect(h2Idx).toBeGreaterThan(h1CloseIdx);
    });

    it('inserts before element', async () => {
      const result = await service.applyModification(sampleComponent, {
        type: 'insertElement',
        elementSelector: 'h1',
        position: 'before',
        html: '<span>Before</span>',
      });
      const beforeIdx = result.indexOf('<span>Before</span>');
      const h1Idx = result.indexOf('<h1>');
      expect(beforeIdx).toBeLessThan(h1Idx);
    });
  });

  describe('removeElement', () => {
    it('removes an element and its content', async () => {
      const result = await service.applyModification(sampleComponent, {
        type: 'removeElement',
        elementSelector: 'p',
      });
      expect(result).not.toContain('<p>');
      expect(result).not.toContain('Welcome to LumenJS');
      // Other elements remain
      expect(result).toContain('<h1>Hello World</h1>');
    });
  });

  describe('selector with attribute filter', () => {
    it('targets element by attribute selector', async () => {
      const result = await service.applyModification(sampleComponent, {
        type: 'setTextContent',
        elementSelector: "nr-button[variant='primary']",
        html: 'Submit',
      });
      expect(result).toContain('>Submit</nr-button>');
    });
  });

  describe('error cases', () => {
    it('throws if no render() method', async () => {
      const code = `export class Foo { doStuff() { return 1; } }`;
      await expect(service.applyModification(code, {
        type: 'setTextContent',
        elementSelector: 'p',
        html: 'test',
      })).rejects.toThrow('No render() method found');
    });

    it('throws if no html template in render', async () => {
      const code = `export class Foo { render() { return 'hello'; } }`;
      await expect(service.applyModification(code, {
        type: 'setTextContent',
        elementSelector: 'p',
        html: 'test',
      })).rejects.toThrow('No html`` tagged template found');
    });

    it('throws for non-existent element', async () => {
      await expect(service.applyModification(sampleComponent, {
        type: 'setTextContent',
        elementSelector: 'nonexistent-element',
        html: 'test',
      })).rejects.toThrow('Element not found');
    });
  });

  describe('preserves non-template code', () => {
    it('keeps imports, class definition, and styles intact', async () => {
      const result = await service.applyModification(sampleComponent, {
        type: 'setTextContent',
        elementSelector: 'h1',
        html: 'Changed',
      });
      expect(result).toContain("import { html, css, LitElement } from 'lit'");
      expect(result).toContain("@customElement('page-index')");
      expect(result).toContain('static styles = css');
    });
  });
});
