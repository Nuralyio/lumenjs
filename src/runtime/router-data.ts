import { getI18nConfig, getLocale } from './i18n.js';

const PREFETCH_TTL = 30_000; // 30 seconds
const MAX_PREFETCH_CACHE_SIZE = 50;
const prefetchCache = new Map<string, { data: any; timestamp: number }>();
const inflightRequests = new Map<string, Promise<any>>();

// Periodic sweep of expired prefetch entries (every 60s)
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of prefetchCache) {
      if (now - entry.timestamp > PREFETCH_TTL) prefetchCache.delete(key);
    }
  }, 60_000);
}

export function getCachedLoaderData(key: string): any | undefined {
  const entry = prefetchCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.timestamp > PREFETCH_TTL) {
    prefetchCache.delete(key);
    return undefined;
  }
  return entry.data;
}

function setCachedLoaderData(key: string, data: any): void {
  // Evict oldest entry if cache is full
  if (prefetchCache.size >= MAX_PREFETCH_CACHE_SIZE) {
    const firstKey = prefetchCache.keys().next().value;
    if (firstKey) prefetchCache.delete(firstKey);
  }
  prefetchCache.set(key, { data, timestamp: Date.now() });
}

export async function prefetchLoaderData(pathname: string, params: Record<string, string>): Promise<any> {
  const cacheKey = `page:${pathname}`;
  const cached = getCachedLoaderData(cacheKey);
  if (cached !== undefined) return cached;
  const data = await fetchLoaderDataRaw(pathname, params);
  setCachedLoaderData(cacheKey, data);
  return data;
}

export async function prefetchLayoutLoaderData(dir: string, params: Record<string, string> = {}): Promise<any> {
  const cacheKey = `layout:${dir}:${JSON.stringify(params)}`;
  const cached = getCachedLoaderData(cacheKey);
  if (cached !== undefined) return cached;
  const data = await fetchLayoutLoaderDataRaw(dir, params);
  setCachedLoaderData(cacheKey, data);
  return data;
}

export async function fetchLoaderData(pathname: string, params: Record<string, string>): Promise<any> {
  const cacheKey = `page:${pathname}`;
  const cached = getCachedLoaderData(cacheKey);
  if (cached !== undefined) {
    prefetchCache.delete(cacheKey);
    return cached;
  }
  return fetchLoaderDataRaw(pathname, params);
}

async function fetchLoaderDataRaw(pathname: string, params: Record<string, string>): Promise<any> {
  const url = new URL(`/__nk_loader${pathname}`, location.origin);
  if (Object.keys(params).length > 0) {
    url.searchParams.set('__params', JSON.stringify(params));
  }
  const config = getI18nConfig();
  if (config) {
    url.searchParams.set('__locale', getLocale());
  }
  const key = url.toString();
  const inflight = inflightRequests.get(key);
  if (inflight) return inflight;
  const promise = fetch(key)
    .then(async (res) => {
      if (!res.ok) throw new Error(`Loader returned ${res.status}`);
      const data = await res.json();
      return data?.__nk_no_loader ? undefined : data;
    })
    .finally(() => inflightRequests.delete(key));
  inflightRequests.set(key, promise);
  return promise;
}

export async function fetchLayoutLoaderData(dir: string, params: Record<string, string> = {}): Promise<any> {
  const cacheKey = `layout:${dir}:${JSON.stringify(params)}`;
  const cached = getCachedLoaderData(cacheKey);
  if (cached !== undefined) {
    prefetchCache.delete(cacheKey);
    return cached;
  }
  return fetchLayoutLoaderDataRaw(dir, params);
}

async function fetchLayoutLoaderDataRaw(dir: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(`/__nk_loader/__layout/`, location.origin);
  url.searchParams.set('__dir', dir);
  if (Object.keys(params).length > 0) {
    url.searchParams.set('__params', JSON.stringify(params));
  }
  const config = getI18nConfig();
  if (config) {
    url.searchParams.set('__locale', getLocale());
  }
  const key = url.toString();
  const inflight = inflightRequests.get(key);
  if (inflight) return inflight;
  const promise = fetch(key)
    .then(async (res) => {
      if (!res.ok) throw new Error(`Layout loader returned ${res.status}`);
      const data = await res.json();
      return data?.__nk_no_loader ? undefined : data;
    })
    .finally(() => inflightRequests.delete(key));
  inflightRequests.set(key, promise);
  return promise;
}

export async function fetchComponentLoaderData(file: string): Promise<any> {
  const url = new URL(`/__nk_loader/__component/`, location.origin);
  url.searchParams.set('__file', file);
  const config = getI18nConfig();
  if (config) {
    url.searchParams.set('__locale', getLocale());
  }
  const key = url.toString();
  const inflight = inflightRequests.get(key);
  if (inflight) return inflight;
  const promise = fetch(key)
    .then(async (res) => {
      if (!res.ok) throw new Error(`Component loader returned ${res.status}`);
      const data = await res.json();
      return data?.__nk_no_loader ? undefined : data;
    })
    .finally(() => inflightRequests.delete(key));
  inflightRequests.set(key, promise);
  return promise;
}

export function connectSubscribe(pathname: string, params: Record<string, string>): EventSource {
  const url = new URL(`/__nk_subscribe${pathname}`, location.origin);
  if (Object.keys(params).length > 0) {
    url.searchParams.set('__params', JSON.stringify(params));
  }
  const config = getI18nConfig();
  if (config) {
    url.searchParams.set('__locale', getLocale());
  }
  return new EventSource(url.toString());
}

export function connectLayoutSubscribe(dir: string, params: Record<string, string> = {}): EventSource {
  const url = new URL('/__nk_subscribe/__layout/', location.origin);
  url.searchParams.set('__dir', dir);
  if (Object.keys(params).length > 0) {
    url.searchParams.set('__params', JSON.stringify(params));
  }
  const config = getI18nConfig();
  if (config) {
    url.searchParams.set('__locale', getLocale());
  }
  return new EventSource(url.toString());
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function render404(pathname: string): string {
  const safe = escapeHtml(pathname);
  return `<div style="display:flex;align-items:center;justify-content:center;min-height:80vh;font-family:system-ui,-apple-system,sans-serif;padding:2rem">
  <div style="text-align:center;max-width:400px">
    <div style="font-size:5rem;font-weight:200;letter-spacing:-2px;color:#cbd5e1;line-height:1">404</div>
    <div style="width:32px;height:2px;background:#e2e8f0;border-radius:1px;margin:1.25rem auto"></div>
    <h1 style="font-size:1rem;font-weight:500;color:#334155;margin:1.25rem 0 .5rem">Page not found</h1>
    <p style="color:#94a3b8;font-size:.8125rem;line-height:1.5;margin:0 0 2rem"><code style="background:#f8fafc;padding:.125rem .375rem;border-radius:3px;font-size:.75rem;color:#64748b;border:1px solid #f1f5f9">${safe}</code> doesn't exist</p>
    <a href="/" style="display:inline-flex;align-items:center;gap:.375rem;padding:.4375rem 1rem;background:#f8fafc;color:#475569;border:1px solid #e2e8f0;border-radius:6px;font-size:.8125rem;font-weight:400;text-decoration:none;transition:all .15s">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
      Back to home
    </a>
  </div>
</div>`;
}
