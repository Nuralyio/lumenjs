import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import { handleI18nRequest } from './serve-i18n.js';

vi.mock('fs');
vi.mock('./serve-static.js', () => ({
  sendCompressed: vi.fn(),
}));

import { sendCompressed } from './serve-static.js';

function makeReq(): any {
  return { headers: {} };
}

function makeRes(): any {
  return {
    writeHead: vi.fn(),
    end: vi.fn(),
  };
}

const localesDir = '/app/locales';
const locales = ['en', 'fr', 'pt-BR'];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handleI18nRequest', () => {
  describe('pathname matching', () => {
    it('returns false for non-i18n paths', () => {
      for (const p of ['/api/users', '/', '/assets/style.css', '/other']) {
        expect(handleI18nRequest(localesDir, locales, p, makeReq(), makeRes())).toBe(false);
      }
    });

    it('matches simple locale codes', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(handleI18nRequest(localesDir, locales, '/__nk_i18n/en.json', makeReq(), makeRes())).toBe(true);
      expect(handleI18nRequest(localesDir, locales, '/__nk_i18n/fr.json', makeReq(), makeRes())).toBe(true);
    });

    it('matches locale codes with region', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(handleI18nRequest(localesDir, locales, '/__nk_i18n/en-US.json', makeReq(), makeRes())).toBe(true);
      expect(handleI18nRequest(localesDir, locales, '/__nk_i18n/pt-BR.json', makeReq(), makeRes())).toBe(true);
    });

    it('rejects invalid locale formats', () => {
      expect(handleI18nRequest(localesDir, locales, '/__nk_i18n/123.json', makeReq(), makeRes())).toBe(false);
      expect(handleI18nRequest(localesDir, locales, '/__nk_i18n/EN.json', makeReq(), makeRes())).toBe(false);
      expect(handleI18nRequest(localesDir, locales, '/__nk_i18n/.json', makeReq(), makeRes())).toBe(false);
    });

    it('rejects path traversal attempts', () => {
      expect(handleI18nRequest(localesDir, locales, '/__nk_i18n/../etc/passwd.json', makeReq(), makeRes())).toBe(false);
    });
  });

  describe('locale validation', () => {
    it('returns 404 JSON error for valid format but unknown locale', () => {
      const res = makeRes();
      const result = handleI18nRequest(localesDir, locales, '/__nk_i18n/de.json', makeReq(), res);

      expect(result).toBe(true);
      expect(res.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'application/json' });
      expect(res.end).toHaveBeenCalledWith(JSON.stringify({ error: 'Unknown locale' }));
    });

    it('accepts locale that exists in the locales array', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('{"hello":"world"}');
      const res = makeRes();

      const result = handleI18nRequest(localesDir, locales, '/__nk_i18n/en.json', makeReq(), res);

      expect(result).toBe(true);
      expect(res.writeHead).not.toHaveBeenCalled();
    });
  });

  describe('file handling', () => {
    it('returns empty {} JSON when locale file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const req = makeReq();
      const res = makeRes();

      handleI18nRequest(localesDir, locales, '/__nk_i18n/en.json', req, res);

      expect(sendCompressed).toHaveBeenCalledWith(req, res, 200, 'application/json', '{}');
    });

    it('returns file contents when locale file exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('{"greeting":"Bonjour"}');
      const req = makeReq();
      const res = makeRes();

      handleI18nRequest(localesDir, locales, '/__nk_i18n/fr.json', req, res);

      expect(fs.readFileSync).toHaveBeenCalledWith('/app/locales/fr.json', 'utf-8');
      expect(sendCompressed).toHaveBeenCalledWith(req, res, 200, 'application/json', '{"greeting":"Bonjour"}');
    });
  });

  describe('return value', () => {
    it('returns true when path matches (even for unknown locale)', () => {
      expect(handleI18nRequest(localesDir, locales, '/__nk_i18n/de.json', makeReq(), makeRes())).toBe(true);
    });

    it('returns false when path does not match', () => {
      expect(handleI18nRequest(localesDir, locales, '/api/users', makeReq(), makeRes())).toBe(false);
    });
  });
});
