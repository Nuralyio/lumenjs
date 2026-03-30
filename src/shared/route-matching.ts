import type { ManifestRoute } from './types.js';

export interface MatchResult {
  route: ManifestRoute;
  params: Record<string, string>;
}

function routeSpecificity(route: ManifestRoute): number {
  // Higher score = more specific = checked first.
  // Each static segment adds 2, each dynamic segment adds 1, catch-all adds 0.
  return route.path.replace(/^\//, '').split('/').filter(Boolean).reduce((score, seg) => {
    if (seg.startsWith(':...')) return score + 0;
    if (seg.startsWith(':')) return score + 1;
    return score + 2;
  }, 0);
}

export function matchRoute(routes: ManifestRoute[], pathname: string): MatchResult | null {
  const urlSegments = pathname.replace(/^\//, '').split('/').filter(Boolean);
  const sorted = [...routes].sort((a, b) => routeSpecificity(b) - routeSpecificity(a));

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
