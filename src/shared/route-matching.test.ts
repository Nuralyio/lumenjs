import { describe, it, expect } from 'vitest';
import { matchRoute, routeSpecificity } from './route-matching.js';
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

  it('root route does not match other paths', () => {
    const routes = [route('/')];
    const result = matchRoute(routes, '/about');
    expect(result).toBeNull();
  });

  describe('prefixed dynamic segments', () => {
    it('matches /@:username against /@aymen', () => {
      const routes = [route('/@:username')];
      const result = matchRoute(routes, '/@aymen');
      expect(result).not.toBeNull();
      expect(result!.params).toEqual({ username: 'aymen' });
    });

    it('captures param value including underscores and digits', () => {
      const routes = [route('/@:username')];
      const result = matchRoute(routes, '/@user_42');
      expect(result!.params).toEqual({ username: 'user_42' });
    });

    it('rejects prefixed route when prefix is missing', () => {
      const routes = [route('/@:username')];
      const result = matchRoute(routes, '/aymen');
      expect(result).toBeNull();
    });

    it('rejects prefixed route when param value is empty', () => {
      const routes = [route('/@:username')];
      const result = matchRoute(routes, '/@');
      expect(result).toBeNull();
    });

    it('matches nested prefixed route /@:username/followers', () => {
      const routes = [route('/@:username/followers')];
      const result = matchRoute(routes, '/@aymen/followers');
      expect(result).not.toBeNull();
      expect(result!.params).toEqual({ username: 'aymen' });
    });

    it('supports non-@ literal prefixes like user-:id', () => {
      const routes = [route('/user-:id')];
      const result = matchRoute(routes, '/user-42');
      expect(result!.params).toEqual({ id: '42' });
    });

    it('prefixed route beats pure dynamic at the same segment', () => {
      const routes = [route('/:slug'), route('/@:username')];
      const result = matchRoute(routes, '/@aymen');
      expect(result!.route.path).toBe('/@:username');
      expect(result!.params).toEqual({ username: 'aymen' });
    });

    it('pure dynamic still matches non-prefixed URLs when both routes exist', () => {
      const routes = [route('/:slug'), route('/@:username')];
      const result = matchRoute(routes, '/about');
      expect(result!.route.path).toBe('/:slug');
      expect(result!.params).toEqual({ slug: 'about' });
    });

    it('routeSpecificity scores prefixed dynamic higher than pure dynamic', () => {
      expect(routeSpecificity('/@:username')).toBeGreaterThan(routeSpecificity('/:slug'));
    });
  });
});
