import crypto from 'node:crypto';

interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  domain: string;
}

interface Db {
  get<T = any>(sql: string, ...params: any[]): T | undefined;
  run(sql: string, ...params: any[]): any;
}

/**
 * Fetch Open Graph metadata from a URL and cache it.
 */
export async function fetchLinkPreview(url: string, db?: Db): Promise<LinkPreview | null> {
  const urlHash = crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);

  // Check cache
  if (db) {
    const cached = db.get<any>('SELECT * FROM link_previews WHERE url_hash = ?', urlHash);
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
      db.run(
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
