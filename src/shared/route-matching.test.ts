import { describe, it, expect } from 'vitest';
import { matchRoute } from './route-matching.js';
import type { ManifestRoute } from './types.js';

function route(path: string, module = ''): ManifestRoute {
  return { path, module, hasLoader: false };
}

describe('matchRoute', () => {
  it('matches root route /', () => {
    const routes = [route('/')];
    const result = matchRoute(routes, '/');
    expect(result).not.toBeNull();
    expect(result!.route.path).toBe('/');
    expect(result!.params).toEqual({});
  });

  it('matches root route with empty pathname', () => {
    const routes = [route('/')];
    const result = matchRoute(routes, '');
    expect(result).not.toBeNull();
    expect(result!.route.path).toBe('/');
  });

  it('matches static route /about when listed first', () => {
    const routes = [route('/about'), route('/')];
    const result = matchRoute(routes, '/about');
    expect(result).not.toBeNull();
    expect(result!.route.path).toBe('/about');
    expect(result!.params).toEqual({});
  });

  it('matches dynamic :param route', () => {
    const routes = [route('/blog/:slug')];
    const result = matchRoute(routes, '/blog/hello-world');
    expect(result).not.toBeNull();
    expect(result!.params).toEqual({ slug: 'hello-world' });
  });

  it('matches nested dynamic route', () => {
    const routes = [route('/users/:id/posts/:postId')];
    const result = matchRoute(routes, '/users/42/posts/7');
    expect(result).not.toBeNull();
    expect(result!.params).toEqual({ id: '42', postId: '7' });
  });

  it('matches catch-all :...param route', () => {
    const routes = [route('/docs/:...path')];
    const result = matchRoute(routes, '/docs/api/getting-started');
    expect(result).not.toBeNull();
    expect(result!.params).toEqual({ path: 'api/getting-started' });
  });

  it('returns null when no match', () => {
    const routes = [route('/about'), route('/blog/:slug')];
    const result = matchRoute(routes, '/contact');
    expect(result).toBeNull();
  });

  it('prioritizes static over dynamic when ordered first', () => {
    const routes = [route('/blog/featured'), route('/blog/:slug')];
    const result = matchRoute(routes, '/blog/featured');
    expect(result!.route.path).toBe('/blog/featured');
  });

  it('does not match dynamic route with too many segments', () => {
    const routes = [route('/blog/:slug')];
    const result = matchRoute(routes, '/blog/a/b');
    expect(result).toBeNull();
  });

  it('does not match dynamic route with too few segments', () => {
    const routes = [route('/blog/:slug')];
    const result = matchRoute(routes, '/blog');
    expect(result).toBeNull();
  });

  it('does not match catch-all with no segments', () => {
    const routes = [route('/docs/:...path')];
    const result = matchRoute(routes, '/docs');
    expect(result).toBeNull();
  });

  it('root route matches any single-segment path (current behavior)', () => {
    // Note: the root route `/` currently matches any path because the
    // pathname check `pathname === '/' || pathname === ''` is separate from
    // the segment-matching loop which has length 0 segments for '/'.
    const routes = [route('/')];
    const result = matchRoute(routes, '/about');
    // Root route has 0 segments after filtering, so the for loop doesn't run
    // and match stays true. This is a known quirk.
    expect(result).not.toBeNull();
  });
});
