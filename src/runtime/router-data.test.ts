import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render404, fetchComponentLoaderData } from './router-data.js';

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

describe('fetchComponentLoaderData', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Mock location for Node.js test env
    (globalThis as any).location = { origin: 'http://localhost:3000' };
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    delete (globalThis as any).location;
  });

  it('fetches from /__nk_loader/__component/ with __file param', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ users: [1, 2, 3] }),
    } as Response);

    const data = await fetchComponentLoaderData('components/user-list.ts');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = new URL(fetchSpy.mock.calls[0][0] as string);
    expect(url.pathname).toBe('/__nk_loader/__component/');
    expect(url.searchParams.get('__file')).toBe('components/user-list.ts');
    expect(data).toEqual({ users: [1, 2, 3] });
  });

  it('returns undefined when server returns __nk_no_loader', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ __nk_no_loader: true }),
    } as Response);

    const data = await fetchComponentLoaderData('components/no-loader.ts');
    expect(data).toBeUndefined();
  });

  it('throws on non-ok response', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'fail' }),
    } as Response);

    await expect(fetchComponentLoaderData('components/broken.ts')).rejects.toThrow('Component loader returned 500');
  });

  it('deduplicates concurrent requests for the same file', async () => {
    let resolvePromise: (v: any) => void;
    const pending = new Promise(resolve => { resolvePromise = resolve; });
    fetchSpy.mockReturnValue(pending as any);

    const p1 = fetchComponentLoaderData('components/dedup.ts');
    const p2 = fetchComponentLoaderData('components/dedup.ts');

    // Only one fetch call should have been made
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    resolvePromise!({
      ok: true,
      json: async () => ({ val: 42 }),
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual({ val: 42 });
    expect(r2).toEqual({ val: 42 });
  });
});
