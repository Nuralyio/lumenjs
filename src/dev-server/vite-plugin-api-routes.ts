import { Plugin, ViteDevServer } from 'vite';
import path from 'path';
import fs from 'fs';

/**
 * LumenJS API Routes plugin.
 *
 * Convention:
 *   api/users.ts        → GET/POST/PUT/DELETE /api/users
 *   api/users/[id].ts   → GET/POST/PUT/DELETE /api/users/:id
 *
 * Handler file exports named functions for each HTTP method:
 *
 *   export async function GET(req: NkRequest) {
 *     return { users: ['Alice', 'Bob'] };
 *   }
 *
 *   export async function POST(req: NkRequest) {
 *     const body = req.body;
 *     return { created: true };
 *   }
 *
 * Return value is JSON-serialized automatically.
 * Throw to return an error: throw { status: 404, message: 'Not found' }
 */
export function lumenApiRoutesPlugin(apiDir: string, projectDir?: string): Plugin {
  return {
    name: 'lumenjs-api-routes',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/') || !req.method) {
          return next();
        }

        // Parse URL and query string
        const [pathname, queryString] = req.url.split('?');
        const query: Record<string, string> = {};
        if (queryString) {
          for (const pair of queryString.split('&')) {
            const [key, val] = pair.split('=');
            query[decodeURIComponent(key)] = decodeURIComponent(val || '');
          }
        }

        // Map /api/foo/bar → api/foo/bar.ts
        const routePath = pathname.replace(/^\//, '');
        const filePath = findApiFile(apiDir, routePath);
        if (!filePath) {
          return next();
        }

        try {
          // Use Vite's ssrLoadModule for HMR support
          const mod = await server.ssrLoadModule(filePath);
          const handler = mod[req.method];

          if (!handler || typeof handler !== 'function') {
            res.statusCode = 405;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: `Method ${req.method} not allowed` }));
            return;
          }

          // Parse request body for non-GET methods
          let body: any = undefined;
          let files: NkUploadedFile[] = [];
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            const contentType = req.headers['content-type'] || '';
            if (contentType.includes('multipart/form-data')) {
              const parsed = await parseMultipart(req, contentType);
              body = parsed.fields;
              files = parsed.files;
            } else {
              body = await readBody(req);
            }
          }

          const nkRequest = {
            method: req.method,
            url: pathname,
            query,
            params: extractParams(apiDir, routePath, filePath),
            body,
            files,
            headers: req.headers,
            projectDir: projectDir || path.dirname(apiDir),
          };

          const result = await handler(nkRequest);

          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
        } catch (err: any) {
          const status = err?.status || 500;
          const message = err?.message || 'Internal server error';
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: message }));
        }
      });
    },
  };
}

/**
 * Find the .ts/.js file for a given API route path.
 * Supports dynamic segments: api/users/[id].ts matches api/users/123
 */
function findApiFile(apiDir: string, routePath: string): string | null {
  // routePath = "api/foo/bar" → look for apiDir/foo/bar.ts
  const relative = routePath.replace(/^api\/?/, '');
  const segments = relative ? relative.split('/') : ['index'];

  // Try exact match first
  const exactPath = path.join(apiDir, ...segments);
  for (const ext of ['.ts', '.js']) {
    if (fs.existsSync(exactPath + ext)) {
      return exactPath + ext;
    }
  }

  // Try index file in directory
  const indexPath = path.join(apiDir, ...segments, 'index');
  for (const ext of ['.ts', '.js']) {
    if (fs.existsSync(indexPath + ext)) {
      return indexPath + ext;
    }
  }

  // Try dynamic segments: walk directories, match [param] patterns
  return findDynamicFile(apiDir, segments);
}

function findDynamicFile(baseDir: string, segments: string[]): string | null {
  if (segments.length === 0) return null;
  if (!fs.existsSync(baseDir)) return null;

  const [current, ...rest] = segments;
  const entries = fs.readdirSync(baseDir, { withFileTypes: true });

  if (rest.length === 0) {
    // Last segment — look for matching file
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const name = entry.name.replace(/\.(ts|js)$/, '');
      if (name === current || /^\[.+\]$/.test(name)) {
        return path.join(baseDir, entry.name);
      }
    }
    return null;
  }

  // More segments — look for matching directory
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === current || /^\[.+\]$/.test(entry.name)) {
      const result = findDynamicFile(path.join(baseDir, entry.name), rest);
      if (result) return result;
    }
  }

  return null;
}

/**
 * Extract dynamic params by comparing the URL segments with the file path segments.
 */
function extractParams(apiDir: string, routePath: string, filePath: string): Record<string, string> {
  const params: Record<string, string> = {};
  const urlSegments = routePath.replace(/^api\/?/, '').split('/').filter(Boolean);
  const fileRelative = path.relative(apiDir, filePath).replace(/\.(ts|js)$/, '');
  const fileSegments = fileRelative.split(path.sep);

  for (let i = 0; i < fileSegments.length && i < urlSegments.length; i++) {
    const match = fileSegments[i].match(/^\[(.+)\]$/);
    if (match) {
      params[match[1]] = urlSegments[i];
    }
  }

  return params;
}

function readBody(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
    req.on('end', () => {
      if (!data) return resolve(undefined);
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve(data);
      }
    });
    req.on('error', reject);
  });
}

interface NkUploadedFile {
  fieldName: string;
  fileName: string;
  contentType: string;
  data: Buffer;
  size: number;
}

function readRawBody(req: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Parse multipart/form-data without external dependencies.
 * Handles both file fields and text fields.
 */
async function parseMultipart(req: any, contentType: string): Promise<{ fields: Record<string, string>; files: NkUploadedFile[] }> {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^\s;]+))/);
  if (!boundaryMatch) {
    return { fields: {}, files: [] };
  }
  const boundary = boundaryMatch[1] || boundaryMatch[2];
  const raw = await readRawBody(req);

  const fields: Record<string, string> = {};
  const files: NkUploadedFile[] = [];

  const delimiter = Buffer.from(`--${boundary}`);
  const end = Buffer.from(`--${boundary}--`);

  // Split body by boundary
  let start = bufferIndexOf(raw, delimiter, 0);
  if (start === -1) return { fields, files };
  start += delimiter.length + 2; // skip boundary + CRLF

  while (true) {
    const nextBoundary = bufferIndexOf(raw, delimiter, start);
    if (nextBoundary === -1) break;

    // Part content is between start and nextBoundary - 2 (strip trailing CRLF)
    const partData = raw.subarray(start, nextBoundary - 2);

    // Split headers from body (double CRLF)
    const headerEnd = bufferIndexOf(partData, Buffer.from('\r\n\r\n'), 0);
    if (headerEnd === -1) { start = nextBoundary + delimiter.length + 2; continue; }

    const headerStr = partData.subarray(0, headerEnd).toString('utf-8');
    const body = partData.subarray(headerEnd + 4);

    // Parse Content-Disposition
    const nameMatch = headerStr.match(/name="([^"]+)"/);
    const fileNameMatch = headerStr.match(/filename="([^"]+)"/);
    const ctMatch = headerStr.match(/Content-Type:\s*(.+)/i);

    if (nameMatch) {
      if (fileNameMatch) {
        files.push({
          fieldName: nameMatch[1],
          fileName: fileNameMatch[1],
          contentType: ctMatch ? ctMatch[1].trim() : 'application/octet-stream',
          data: Buffer.from(body),
          size: body.length,
        });
      } else {
        fields[nameMatch[1]] = body.toString('utf-8');
      }
    }

    // Check if next is the end boundary
    if (bufferIndexOf(raw, end, nextBoundary) === nextBoundary) break;
    start = nextBoundary + delimiter.length + 2;
  }

  return { fields, files };
}

function bufferIndexOf(buf: Buffer, search: Buffer, from: number): number {
  for (let i = from; i <= buf.length - search.length; i++) {
    let found = true;
    for (let j = 0; j < search.length; j++) {
      if (buf[i + j] !== search[j]) { found = false; break; }
    }
    if (found) return i;
  }
  return -1;
}
