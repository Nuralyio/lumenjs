import http from 'http';
import fs from 'fs';
import path from 'path';
import { sendCompressed } from './serve-static.js';

/**
 * Handle `/__nk_i18n/<locale>.json` requests in production.
 * Reads from the built `locales/` directory.
 */
export function handleI18nRequest(
  localesDir: string,
  locales: string[],
  pathname: string,
  req: http.IncomingMessage,
  res: http.ServerResponse
): boolean {
  const match = pathname.match(/^\/__nk_i18n\/([a-z]{2}(?:-[a-zA-Z]+)?)\.json$/);
  if (!match) return false;

  const locale = match[1];
  if (!locales.includes(locale)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unknown locale' }));
    return true;
  }

  const filePath = path.join(localesDir, `${locale}.json`);
  if (!fs.existsSync(filePath)) {
    sendCompressed(req, res, 200, 'application/json', '{}');
    return true;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  sendCompressed(req, res, 200, 'application/json', content);
  return true;
}
