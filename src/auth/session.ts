import crypto from 'node:crypto';
import type { SessionData } from './types.js';

const keyCache = new Map<string, Buffer>();

export function deriveKey(secret: string): Buffer {
  const cached = keyCache.get(secret);
  if (cached) return cached;
  const key = Buffer.from(
    crypto.hkdfSync('sha256', secret, '', 'lumenjs-session', 32)
  );
  keyCache.set(secret, key);
  return key;
}

export async function encryptSession(data: SessionData, secret: string): Promise<string> {
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = JSON.stringify(data);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${ciphertext.toString('base64url')}.${tag.toString('base64url')}`;
}

export async function decryptSession(cookie: string, secret: string): Promise<SessionData | null> {
  try {
    const parts = cookie.split('.');
    if (parts.length !== 3) return null;
    const iv = Buffer.from(parts[0], 'base64url');
    const ciphertext = Buffer.from(parts[1], 'base64url');
    const tag = Buffer.from(parts[2], 'base64url');
    const key = deriveKey(secret);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8')) as SessionData;
  } catch {
    return null;
  }
}

export function createSessionCookie(name: string, value: string, maxAge: number, secure: boolean): string {
  let cookie = `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
  if (secure) cookie += '; Secure';
  return cookie;
}

export function clearSessionCookie(name: string): string {
  return `${name}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export function parseSessionCookie(cookieHeader: string, name: string): string | undefined {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? match[1] : undefined;
}

export function shouldRefreshSession(session: SessionData): boolean {
  return session.expiresAt - Date.now() / 1000 < 300;
}
