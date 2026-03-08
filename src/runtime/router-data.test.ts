import { describe, it, expect } from 'vitest';
import { render404 } from './router-data.js';

describe('render404', () => {
  it('returns HTML with 404 text', () => {
    const html = render404('/missing');
    expect(html).toContain('404');
    expect(html).toContain('Page not found');
  });

  it('includes the pathname', () => {
    const html = render404('/some/page');
    expect(html).toContain('/some/page');
  });

  it('includes a back to home link', () => {
    const html = render404('/x');
    expect(html).toContain('href="/"');
    expect(html).toContain('Back to home');
  });
});
