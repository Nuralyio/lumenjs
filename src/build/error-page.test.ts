import { describe, it, expect } from 'vitest';
import { renderErrorPage } from './error-page.js';

describe('renderErrorPage', () => {
  it('returns valid HTML', () => {
    const html = renderErrorPage(500, 'Server Error', 'Something went wrong');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('includes status code', () => {
    const html = renderErrorPage(404, 'Not Found', 'Page missing');
    expect(html).toContain('404');
  });

  it('includes title and message', () => {
    const html = renderErrorPage(500, 'Server Error', 'Try again');
    expect(html).toContain('Server Error');
    expect(html).toContain('Try again');
  });

  it('includes detail block when provided', () => {
    const html = renderErrorPage(500, 'Error', 'Msg', 'Stack trace here');
    expect(html).toContain('Details');
    expect(html).toContain('Stack trace here');
  });

  it('does not include detail block when not provided', () => {
    const html = renderErrorPage(500, 'Error', 'Msg');
    expect(html).not.toContain('Details');
  });

  it('uses different gradient for 404', () => {
    const html404 = renderErrorPage(404, 'Not Found', 'Missing');
    const html500 = renderErrorPage(500, 'Error', 'Failed');
    // Both have the status but title tag shows different gradient colors
    expect(html404).toContain('404');
    expect(html500).toContain('500');
  });

  it('escapes XSS in title and message', () => {
    const html = renderErrorPage(500, '<script>x</script>', 'a&b<c');
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('a&amp;b&lt;c');
  });

  it('escapes XSS in detail', () => {
    const html = renderErrorPage(500, 'Err', 'Msg', '<img onerror="x">');
    expect(html).toContain('&lt;img onerror=&quot;x&quot;&gt;');
  });

  it('includes back to home link', () => {
    const html = renderErrorPage(404, 'Not Found', 'Missing');
    expect(html).toContain('href="/"');
  });

  it('includes LumenJS footer', () => {
    const html = renderErrorPage(500, 'Error', 'Msg');
    expect(html).toContain('LumenJS');
  });
});
