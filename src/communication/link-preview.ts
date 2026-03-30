import crypto from 'node:crypto';

function isPrivateUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);

    // Only allow http/https schemes
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;

    const hostname = parsed.hostname.toLowerCase();

    // Loopback and unspecified addresses
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '0.0.0.0') return true;

    // Single-label hostnames (no dots)
    if (!hostname.includes('.')) return true;

    // Cloud metadata endpoints
    if (hostname === 'metadata.google.internal' || hostname === 'metadata.internal') return true;

    // IPv6 addresses — block all private/reserved ranges
    if (hostname.startsWith('[')) {
      const ipv6 = hostname.slice(1, -1).toLowerCase();
      if (ipv6 === '::1' || ipv6 === '::' || ipv6.startsWith('fe80:') || ipv6.startsWith('fd') || ipv6.startsWith('fc')) return true;
      return true; // Block all bracketed IPv6 for safety
    }

    // IPv4 private ranges
    const parts = hostname.split('.').map(Number);
    if (parts.length === 4 && parts.every(n => !isNaN(n))) {
      if (parts[0] === 10) return true;
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
      if (parts[0] === 192 && parts[1] === 168) return true;
      if (parts[0] === 169 && parts[1] === 254) return true; // link-local + cloud metadata
      if (parts[0] === 0) return true;
      if (parts[0] === 127) return true; // full loopback range
    }

    return false;
  } catch {
    return true;
  }
}

interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  domain: string;
}

interface Db {
  get<T = any>(sql: string, ...params: any[]): Promise<T | undefined>;
  run(sql: string, ...params: any[]): Promise<any>;
}

/**
 * Fetch Open Graph metadata from a URL and cache it.
 */
export async function fetchLinkPreview(url: string, db?: Db): Promise<LinkPreview | null> {
  if (isPrivateUrl(url)) return null;
  const urlHash = crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);

  // Check cache
  if (db) {
    const cached = await db.get<any>('SELECT * FROM link_previews WHERE url_hash = ?', urlHash);
    if (cached) {
      return { url: cached.url, title: cached.title, description: cached.description, image: cached.image, domain: cached.domain };
    }
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, {
      headers: { 'User-Agent': 'LumenJS LinkPreview/1.0' },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeout);

    // Re-check final URL after redirects to prevent SSRF via redirect
    if (res.url && res.url !== url && isPrivateUrl(res.url)) return null;

    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return null;

    const html = await res.text();
    const domain = new URL(url).hostname;

    const title = extractMeta(html, 'og:title') || extractTag(html, 'title');
    const description = extractMeta(html, 'og:description') || extractMeta(html, 'description');
    const image = extractMeta(html, 'og:image');

    const preview: LinkPreview = { url, title, description, image, domain };

    // Cache
    if (db) {
      await db.run(
        'INSERT OR REPLACE INTO link_previews (url_hash, url, title, description, image, domain) VALUES (?, ?, ?, ?, ?, ?)',
        urlHash, url, title, description, image, domain,
      );
    }

    return preview;
  } catch {
    return null;
  }
}

/** Extract URLs from message text */
export function extractUrls(text: string): string[] {
  const regex = /https?:\/\/[^\s<>"')\]]+/g;
  const matches = text.match(regex);
  return matches ? [...new Set(matches)].slice(0, 3) : [];
}

function extractMeta(html: string, name: string): string | null {
  // Match <meta property="og:title" content="..."> or <meta name="description" content="...">
  const regex = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i');
  const match = html.match(regex);
  if (match) return match[1];
  // Try reversed order: content before property
  const regex2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["']`, 'i');
  const match2 = html.match(regex2);
  return match2 ? match2[1] : null;
}

function extractTag(html: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, 'i');
  const match = html.match(regex);
  return match ? match[1].trim() : null;
}
