import { describe, it, expect } from 'vitest';
import { generateLlmsTxt } from './llms-txt.js';

describe('generateLlmsTxt', () => {
  it('generates basic output with title', () => {
    const result = generateLlmsTxt({
      pages: [],
      apiRoutes: [],
      config: { title: 'My App', integrations: [] },
    });
    expect(result).toContain('# My App');
    expect(result).toContain('> Built with LumenJS');
  });

  it('lists pages with capabilities', () => {
    const result = generateLlmsTxt({
      pages: [
        { path: '/', hasLoader: true, hasSubscribe: false, hasSocket: false },
        { path: '/chat', hasLoader: false, hasSubscribe: false, hasSocket: true },
        { path: '/blog/:slug', hasLoader: true, hasSubscribe: false, hasSocket: false },
      ],
      apiRoutes: [],
      config: { title: 'Test', integrations: [] },
    });
    expect(result).toContain('### /\n- server loader');
    expect(result).toContain('### /chat\n- socket (bidirectional)');
    expect(result).toContain('### /blog/:slug\n- server loader, dynamic route');
  });

  it('lists API routes with methods', () => {
    const result = generateLlmsTxt({
      pages: [],
      apiRoutes: [
        { path: '/api/users', methods: ['GET', 'POST'] },
        { path: '/ping', methods: ['GET'] },
      ],
      config: { title: 'Test', integrations: [] },
    });
    expect(result).toContain('- GET /api/users');
    expect(result).toContain('- POST /api/users');
    expect(result).toContain('- GET /api/ping');
  });

  it('lists features from config', () => {
    const result = generateLlmsTxt({
      pages: [],
      apiRoutes: [],
      config: {
        title: 'Test',
        integrations: ['tailwind', 'nuralyui', 'socketio'],
        i18n: { locales: ['en', 'fr'], defaultLocale: 'en' },
      },
    });
    expect(result).toContain('- Internationalization (en, fr)');
    expect(result).toContain('- Tailwind CSS');
    expect(result).toContain('- NuralyUI Components');
    expect(result).toContain('- Socket.IO');
  });

  it('omits empty sections', () => {
    const result = generateLlmsTxt({
      pages: [],
      apiRoutes: [],
      config: { title: 'Empty', integrations: [] },
    });
    expect(result).not.toContain('## Pages');
    expect(result).not.toContain('## API Routes');
    expect(result).not.toContain('## Features');
  });
});
