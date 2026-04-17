import type { ManifestRoute } from './types.js';

export interface MatchResult {
  route: ManifestRoute;
  params: Record<string, string>;
}

/**
 * Per-segment route specificity score. Higher = more specific = checked first.
 * Static segment: 2, prefixed-dynamic (e.g. `@:name`): 2, pure dynamic (`:name`): 1, catch-all: 0.
 *
 * Exported so build-time route generation (vite-plugin-routes) and client-side
 * router can use the exact same ordering as the server-side matcher, preventing
 * SSR/CSR hydration mismatches when routes have overlapping match patterns.
 */
export function routeSpecificity(path: string): number {
  return path.replace(/^\//, '').split('/').filter(Boolean).reduce((score, seg) => {
    if (seg.startsWith(':...')) return score + 0;
    if (seg.startsWith(':')) return score + 1;
    return score + 2;
  }, 0);
}

// Parse a segment like "@:username" or "user-:id" into its literal prefix and param name.
// Returns null if the segment is a pure literal or malformed.
function parsePrefixedParam(seg: string): { prefix: string; name: string } | null {
  const idx = seg.indexOf(':');
  if (idx <= 0) return null;
  const prefix = seg.slice(0, idx);
  const name = seg.slice(idx + 1);
  if (!name || name.includes(':')) return null;
  return { prefix, name };
}

export function matchRoute(routes: ManifestRoute[], pathname: string): MatchResult | null {
  const urlSegments = pathname.replace(/^\//, '').split('/').filter(Boolean);
  const sorted = [...routes].sort((a, b) => routeSpecificity(b.path) - routeSpecificity(a.path));

  for (const route of sorted) {
    const routeSegments = route.path.replace(/^\//, '').split('/').filter(Boolean);

    // Handle root route
    if (route.path === '/' && (pathname === '/' || pathname === '')) {
      return { route, params: {} };
    }

    // Non-root routes with no segments can't match a non-empty pathname
    if (routeSegments.length === 0 && urlSegments.length > 0) continue;

    const params: Record<string, string> = {};
    let match = true;

    for (let i = 0; i < routeSegments.length; i++) {
      const seg = routeSegments[i];
      if (seg.startsWith(':...')) {
        // Catch-all: capture remaining URL segments
        if (i < urlSegments.length) {
          params[seg.slice(4)] = urlSegments.slice(i).join('/');
        } else {
          match = false;
        }
        break;
      } else if (seg.startsWith(':')) {
        if (i >= urlSegments.length) { match = false; break; }
        params[seg.slice(1)] = urlSegments[i];
      } else if (i < urlSegments.length && seg.includes(':')) {
        const prefixed = parsePrefixedParam(seg);
        if (!prefixed) { match = false; break; }
        const urlSeg = urlSegments[i];
        if (!urlSeg.startsWith(prefixed.prefix) || urlSeg.length === prefixed.prefix.length) {
          match = false;
          break;
        }
        params[prefixed.name] = urlSeg.slice(prefixed.prefix.length);
      } else if (i >= urlSegments.length || seg !== urlSegments[i]) {
        match = false;
        break;
      }
      // For non-catch-all routes, lengths must match
      if (i === routeSegments.length - 1 && routeSegments.length !== urlSegments.length) {
        match = false;
      }
    }

    if (match) {
      return { route, params };
    }
  }

  return null;
}
