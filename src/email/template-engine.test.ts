import { describe, it, expect } from 'vitest';
import { compileTemplate } from './template-engine.js';

describe('template engine', () => {
  describe('variable interpolation', () => {
    it('replaces {{variable}} with escaped value', () => {
      const html = compileTemplate('Hello {{userName}}!', { appName: 'App', url: '', userName: 'John' });
      expect(html).toBe('Hello John!');
    });

    it('escapes HTML in {{variable}}', () => {
      const html = compileTemplate('{{userName}}', { appName: 'App', url: '', userName: '<script>alert("xss")</script>' });
      expect(html).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });

    it('replaces {{{variable}}} with raw value', () => {
      const html = compileTemplate('{{{content}}}', { appName: 'App', url: '', content: '<b>bold</b>' } as any);
      expect(html).toBe('<b>bold</b>');
    });

    it('supports dotted paths', () => {
      const html = compileTemplate('{{user.name}}', { appName: 'App', url: '', user: { name: 'Jane' } } as any);
      expect(html).toBe('Jane');
    });

    it('replaces missing variables with empty string', () => {
      const html = compileTemplate('Hi {{unknownVar}}!', { appName: 'App', url: '' });
      expect(html).toBe('Hi !');
    });
  });

  describe('{{#if}}', () => {
    it('shows block when variable is truthy', () => {
      const html = compileTemplate('{{#if userName}}Hi {{userName}}{{/if}}', { appName: 'App', url: '', userName: 'John' });
      expect(html).toBe('Hi John');
    });

    it('hides block when variable is falsy', () => {
      const html = compileTemplate('{{#if userName}}Hi {{userName}}{{/if}}Done', { appName: 'App', url: '' });
      expect(html).toBe('Done');
    });

    it('hides block when variable is empty string', () => {
      const html = compileTemplate('{{#if userName}}Hi{{/if}}End', { appName: 'App', url: '', userName: '' });
      expect(html).toBe('End');
    });
  });

  describe('{{#each}}', () => {
    it('loops over array of objects', () => {
      const html = compileTemplate(
        '{{#each items}}<li>{{name}}: {{price}}</li>{{/each}}',
        { appName: 'App', url: '', items: [{ name: 'A', price: '10' }, { name: 'B', price: '20' }] } as any,
      );
      expect(html).toBe('<li>A: 10</li><li>B: 20</li>');
    });

    it('provides {{@index}}', () => {
      const html = compileTemplate(
        '{{#each items}}{{@index}}.{{name}} {{/each}}',
        { appName: 'App', url: '', items: [{ name: 'X' }, { name: 'Y' }] } as any,
      );
      expect(html).toBe('0.X 1.Y ');
    });

    it('handles empty array', () => {
      const html = compileTemplate('{{#each items}}<li>{{name}}</li>{{/each}}', { appName: 'App', url: '', items: [] } as any);
      expect(html).toBe('');
    });

    it('handles missing array', () => {
      const html = compileTemplate('{{#each missing}}<li>{{name}}</li>{{/each}}', { appName: 'App', url: '' });
      expect(html).toBe('');
    });

    it('falls back to parent data for unresolved vars', () => {
      const html = compileTemplate(
        '{{#each items}}{{name}} from {{appName}}|{{/each}}',
        { appName: 'Nuraly', url: '', items: [{ name: 'A' }, { name: 'B' }] } as any,
      );
      expect(html).toBe('A from Nuraly|B from Nuraly|');
    });

    it('supports {{#if}} inside {{#each}}', () => {
      const html = compileTemplate(
        '{{#each items}}{{#if featured}}*{{/if}}{{name}} {{/each}}',
        { appName: 'App', url: '', items: [{ name: 'A', featured: true }, { name: 'B', featured: false }] } as any,
      );
      expect(html).toBe('*A B ');
    });
  });

  describe('{{#button}}', () => {
    it('renders a CTA button', () => {
      const html = compileTemplate('{{#button url="{{url}}" text="Click me"}}', { appName: 'App', url: 'https://example.com' });
      expect(html).toContain('https://example.com');
      expect(html).toContain('Click me');
      expect(html).toContain('#7c3aed');
    });
  });

  describe('{{#layout}}', () => {
    it('wraps content in base email layout', () => {
      const html = compileTemplate('{{#layout}}<p>Hello {{userName}}</p>{{/layout}}', { appName: 'TestApp', url: '', userName: 'Jane' });
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('TestApp');
      expect(html).toContain('<p>Hello Jane</p>');
    });

    it('works without layout', () => {
      const html = compileTemplate('<p>No layout</p>', { appName: 'App', url: '' });
      expect(html).toBe('<p>No layout</p>');
      expect(html).not.toContain('<!DOCTYPE html>');
    });
  });

  describe('real-world email template', () => {
    it('compiles a full order confirmation email', () => {
      const template = `{{#layout}}
<h1>Order confirmed!</h1>
<p>Hi {{userName}}, thanks for your order.</p>
<table>
{{#each items}}
  <tr><td>{{name}}</td><td>{{qty}}</td><td>{{price}}</td></tr>
{{/each}}
</table>
<p>Total: {{total}}</p>
{{#button url="{{url}}" text="View order"}}
{{#if note}}<p>Note: {{note}}</p>{{/if}}
{{/layout}}`;

      const html = compileTemplate(template, {
        appName: 'Nuraly',
        url: 'https://nuraly.io/orders/123',
        userName: 'Aymen',
        items: [
          { name: 'Pro Plan', qty: '1', price: '$49' },
          { name: 'Add-on', qty: '2', price: '$10' },
        ],
        total: '$69',
        note: 'Thanks for being early!',
      } as any);

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Hi Aymen');
      expect(html).toContain('Pro Plan');
      expect(html).toContain('$49');
      expect(html).toContain('Add-on');
      expect(html).toContain('Total: $69');
      expect(html).toContain('View order');
      expect(html).toContain('https://nuraly.io/orders/123');
      expect(html).toContain('Thanks for being early!');
    });
  });
});
