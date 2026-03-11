import { describe, it, expect } from 'vitest';
import { generateLlmsTxt, resolveDynamicEntries } from './generate.js';
import type { LlmsTxtInput } from './generate.js';

describe('generateLlmsTxt', () => {
  it('generates basic output with title and pages', () => {
    const input: LlmsTxtInput = {
      title: 'My App',
      pages: [
        { path: '/', hasLoader: false, hasSubscribe: false },
        { path: '/about', hasLoader: false, hasSubscribe: false },
      ],
      apiRoutes: [],
      integrations: [],
    };
    const result = generateLlmsTxt(input);
    expect(result).toContain('# My App');
    expect(result).toContain('> Built with LumenJS');
    expect(result).toContain('## Pages');
    expect(result).toContain('### /');
    expect(result).toContain('### /about');
    expect(result).toContain('- Server-rendered page');
  });

  it('includes loader data as key-value text', () => {
    const input: LlmsTxtInput = {
      title: 'Blog',
      pages: [
        {
          path: '/',
          hasLoader: true,
          hasSubscribe: false,
          loaderData: { title: 'Home', description: 'Welcome to the blog' },
        },
      ],
      apiRoutes: [],
      integrations: [],
    };
    const result = generateLlmsTxt(input);
    expect(result).toContain('title: Home');
    expect(result).toContain('description: Welcome to the blog');
  });

  it('annotates pages with loader and subscribe features', () => {
    const input: LlmsTxtInput = {
      title: 'App',
      pages: [
        { path: '/dashboard', hasLoader: true, hasSubscribe: true },
      ],
      apiRoutes: [],
      integrations: [],
    };
    const result = generateLlmsTxt(input);
    expect(result).toContain('with loader data');
    expect(result).toContain('with live data');
  });

  it('renders dynamic route entries', () => {
    const input: LlmsTxtInput = {
      title: 'Blog',
      pages: [
        {
          path: '/blog/:slug',
          hasLoader: true,
          hasSubscribe: false,
          dynamicEntries: [
            { path: '/blog/hello-world', loaderData: { title: 'Hello World', date: '2025-01-15' } },
            { path: '/blog/getting-started', loaderData: { title: 'Getting Started', date: '2025-01-20' } },
          ],
        },
      ],
      apiRoutes: [],
      integrations: [],
    };
    const result = generateLlmsTxt(input);
    expect(result).toContain('Dynamic route — 2 entries:');
    expect(result).toContain('#### /blog/hello-world');
    expect(result).toContain('title: Hello World');
    expect(result).toContain('date: 2025-01-15');
    expect(result).toContain('#### /blog/getting-started');
    expect(result).toContain('title: Getting Started');
  });

  it('shows dynamic route without count when no entries resolved', () => {
    const input: LlmsTxtInput = {
      title: 'App',
      pages: [
        { path: '/blog/:slug', hasLoader: true, hasSubscribe: false },
      ],
      apiRoutes: [],
      integrations: [],
    };
    const result = generateLlmsTxt(input);
    expect(result).toContain('### /blog/:slug');
    expect(result).toContain('- Dynamic route');
    expect(result).not.toContain('entries');
    expect(result).not.toContain('with loader data');
  });

  it('shows dynamic route without count when dynamicEntries is empty array', () => {
    const input: LlmsTxtInput = {
      title: 'App',
      pages: [
        { path: '/posts/:id', hasLoader: true, hasSubscribe: false, dynamicEntries: [] },
      ],
      apiRoutes: [],
      integrations: [],
    };
    const result = generateLlmsTxt(input);
    expect(result).toContain('### /posts/:id');
    expect(result).toContain('- Dynamic route');
    expect(result).not.toContain('entries');
  });

  it('renders single dynamic entry with correct pluralization', () => {
    const input: LlmsTxtInput = {
      title: 'App',
      pages: [
        {
          path: '/users/:id',
          hasLoader: true,
          hasSubscribe: false,
          dynamicEntries: [
            { path: '/users/1', loaderData: { name: 'Alice' } },
          ],
        },
      ],
      apiRoutes: [],
      integrations: [],
    };
    const result = generateLlmsTxt(input);
    expect(result).toContain('Dynamic route — 1 entry:');
  });

  it('includes API routes with methods', () => {
    const input: LlmsTxtInput = {
      title: 'App',
      pages: [],
      apiRoutes: [
        { path: 'posts', methods: ['GET', 'POST'] },
        { path: 'stats', methods: ['GET'] },
      ],
      integrations: [],
    };
    const result = generateLlmsTxt(input);
    expect(result).toContain('## API Routes');
    expect(result).toContain('- GET /api/posts');
    expect(result).toContain('- POST /api/posts');
    expect(result).toContain('- GET /api/stats');
  });

  it('includes features section with db', () => {
    const input: LlmsTxtInput = {
      title: 'App',
      pages: [],
      apiRoutes: [],
      integrations: [],
      db: { path: 'data.db' },
    };
    const result = generateLlmsTxt(input);
    expect(result).toContain('## Features');
    expect(result).toContain('- SQLite Database');
  });

  it('includes i18n in features', () => {
    const input: LlmsTxtInput = {
      title: 'App',
      pages: [],
      apiRoutes: [],
      integrations: [],
      i18n: { locales: ['en', 'fr'], defaultLocale: 'en' },
    };
    const result = generateLlmsTxt(input);
    expect(result).toContain('- Internationalization (en, fr)');
  });

  it('includes integrations in features', () => {
    const input: LlmsTxtInput = {
      title: 'App',
      pages: [],
      apiRoutes: [],
      integrations: ['tailwind', 'nuralyui'],
    };
    const result = generateLlmsTxt(input);
    expect(result).toContain('- Tailwind CSS');
    expect(result).toContain('- NuralyUI Components');
  });

  it('omits features section when no features', () => {
    const input: LlmsTxtInput = {
      title: 'App',
      pages: [],
      apiRoutes: [],
      integrations: [],
    };
    const result = generateLlmsTxt(input);
    expect(result).not.toContain('## Features');
  });

  it('omits pages section when no pages', () => {
    const input: LlmsTxtInput = {
      title: 'App',
      pages: [],
      apiRoutes: [{ path: 'health', methods: ['GET'] }],
      integrations: [],
    };
    const result = generateLlmsTxt(input);
    expect(result).not.toContain('## Pages');
    expect(result).toContain('## API Routes');
  });

  it('omits API routes section when no API routes', () => {
    const input: LlmsTxtInput = {
      title: 'App',
      pages: [{ path: '/', hasLoader: false, hasSubscribe: false }],
      apiRoutes: [],
      integrations: [],
    };
    const result = generateLlmsTxt(input);
    expect(result).not.toContain('## API Routes');
  });

  it('flattens nested loader data', () => {
    const input: LlmsTxtInput = {
      title: 'App',
      pages: [
        {
          path: '/',
          hasLoader: true,
          hasSubscribe: false,
          loaderData: { site: { name: 'My Site', version: '1.0' } },
        },
      ],
      apiRoutes: [],
      integrations: [],
    };
    const result = generateLlmsTxt(input);
    expect(result).toContain('site.name: My Site');
    expect(result).toContain('site.version: 1.0');
  });

  it('skips array values in loader data', () => {
    const input: LlmsTxtInput = {
      title: 'App',
      pages: [
        {
          path: '/',
          hasLoader: true,
          hasSubscribe: false,
          loaderData: { posts: [{ id: 1 }, { id: 2 }], count: 2 },
        },
      ],
      apiRoutes: [],
      integrations: [],
    };
    const result = generateLlmsTxt(input);
    expect(result).toContain('count: 2');
    // Arrays are skipped in flat display
    expect(result).not.toContain('posts');
  });

  it('skips null values in loader data', () => {
    const input: LlmsTxtInput = {
      title: 'App',
      pages: [
        {
          path: '/',
          hasLoader: true,
          hasSubscribe: false,
          loaderData: { title: 'Hello', empty: null },
        },
      ],
      apiRoutes: [],
      integrations: [],
    };
    const result = generateLlmsTxt(input);
    expect(result).toContain('title: Hello');
    expect(result).not.toContain('empty');
  });

  it('ends with newline', () => {
    const input: LlmsTxtInput = {
      title: 'App',
      pages: [],
      apiRoutes: [],
      integrations: [],
    };
    const result = generateLlmsTxt(input);
    expect(result.endsWith('\n')).toBe(true);
  });

  it('generates full realistic output', () => {
    const input: LlmsTxtInput = {
      title: 'My Blog',
      pages: [
        { path: '/', hasLoader: true, hasSubscribe: false, loaderData: { count: 3 } },
        {
          path: '/blog/:slug',
          hasLoader: true,
          hasSubscribe: false,
          dynamicEntries: [
            { path: '/blog/hello', loaderData: { title: 'Hello', content: 'Hi there' } },
            { path: '/blog/world', loaderData: { title: 'World', content: 'Hey world' } },
          ],
        },
        { path: '/dashboard', hasLoader: true, hasSubscribe: true },
      ],
      apiRoutes: [
        { path: 'posts', methods: ['GET', 'POST'] },
      ],
      integrations: ['tailwind'],
      db: {},
      i18n: { locales: ['en', 'fr'], defaultLocale: 'en' },
    };
    const result = generateLlmsTxt(input);

    expect(result).toContain('# My Blog');
    expect(result).toContain('> Built with LumenJS');
    expect(result).toContain('## Pages');
    expect(result).toContain('### /');
    expect(result).toContain('count: 3');
    expect(result).toContain('### /blog/:slug');
    expect(result).toContain('Dynamic route — 2 entries:');
    expect(result).toContain('#### /blog/hello');
    expect(result).toContain('#### /blog/world');
    expect(result).toContain('### /dashboard');
    expect(result).toContain('## API Routes');
    expect(result).toContain('- GET /api/posts');
    expect(result).toContain('- POST /api/posts');
    expect(result).toContain('## Features');
    expect(result).toContain('- SQLite Database');
    expect(result).toContain('- Internationalization (en, fr)');
    expect(result).toContain('- Tailwind CSS');
  });
});

describe('resolveDynamicEntries', () => {
  it('returns null when no parent index page exists', async () => {
    const result = await resolveDynamicEntries(
      { path: '/blog/:slug', paramName: 'slug' },
      async () => ({}),
      [{ path: '/blog/:slug', filePath: '/pages/blog/[slug].ts', hasLoader: true }],
    );
    expect(result).toBeNull();
  });

  it('returns null when parent loader has no array data', async () => {
    const result = await resolveDynamicEntries(
      { path: '/blog/:slug', paramName: 'slug' },
      async (filePath) => {
        if (filePath === '/pages/blog/index.ts') {
          return { loader: () => ({ count: 5 }) };
        }
        return {};
      },
      [
        { path: '/blog', filePath: '/pages/blog/index.ts', hasLoader: true },
        { path: '/blog/:slug', filePath: '/pages/blog/[slug].ts', hasLoader: true },
      ],
    );
    expect(result).toBeNull();
  });

  it('resolves dynamic entries from parent index loader', async () => {
    const posts = [
      { slug: 'hello', title: 'Hello' },
      { slug: 'world', title: 'World' },
    ];

    const result = await resolveDynamicEntries(
      { path: '/blog/:slug', paramName: 'slug' },
      async (filePath) => {
        if (filePath === '/pages/blog/index.ts') {
          return { loader: () => ({ posts }) };
        }
        if (filePath === '/pages/blog/[slug].ts') {
          return {
            loader: ({ params }: any) => {
              const post = posts.find(p => p.slug === params.slug);
              return post ? { title: post.title, slug: post.slug } : null;
            },
          };
        }
        return null;
      },
      [
        { path: '/blog', filePath: '/pages/blog/index.ts', hasLoader: true },
        { path: '/blog/:slug', filePath: '/pages/blog/[slug].ts', hasLoader: true },
      ],
    );

    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    expect(result![0].path).toBe('/blog/hello');
    expect(result![0].loaderData).toEqual({ title: 'Hello', slug: 'hello' });
    expect(result![1].path).toBe('/blog/world');
    expect(result![1].loaderData).toEqual({ title: 'World', slug: 'world' });
  });

  it('skips items when dynamic loader throws', async () => {
    const result = await resolveDynamicEntries(
      { path: '/blog/:slug', paramName: 'slug' },
      async (filePath) => {
        if (filePath === '/pages/blog/index.ts') {
          return { loader: () => ({ posts: [{ slug: 'good' }, { slug: 'bad' }] }) };
        }
        if (filePath === '/pages/blog/[slug].ts') {
          return {
            loader: ({ params }: any) => {
              if (params.slug === 'bad') throw new Error('DB error');
              return { title: 'Good Post' };
            },
          };
        }
        return null;
      },
      [
        { path: '/blog', filePath: '/pages/blog/index.ts', hasLoader: true },
        { path: '/blog/:slug', filePath: '/pages/blog/[slug].ts', hasLoader: true },
      ],
    );

    expect(result).toHaveLength(1);
    expect(result![0].path).toBe('/blog/good');
  });

  it('returns null when parent loader throws', async () => {
    const result = await resolveDynamicEntries(
      { path: '/blog/:slug', paramName: 'slug' },
      async (filePath) => {
        if (filePath === '/pages/blog/index.ts') {
          return { loader: () => { throw new Error('DB error'); } };
        }
        return null;
      },
      [
        { path: '/blog', filePath: '/pages/blog/index.ts', hasLoader: true },
        { path: '/blog/:slug', filePath: '/pages/blog/[slug].ts', hasLoader: true },
      ],
    );
    expect(result).toBeNull();
  });

  it('uses id field when slug is not available', async () => {
    const items = [{ id: 42, name: 'Item A' }];

    const result = await resolveDynamicEntries(
      { path: '/items/:id', paramName: 'id' },
      async (filePath) => {
        if (filePath === '/pages/items/index.ts') {
          return { loader: () => ({ items }) };
        }
        if (filePath === '/pages/items/[id].ts') {
          return {
            loader: ({ params }: any) => ({ id: params.id, name: 'Item A' }),
          };
        }
        return null;
      },
      [
        { path: '/items', filePath: '/pages/items/index.ts', hasLoader: true },
        { path: '/items/:id', filePath: '/pages/items/[id].ts', hasLoader: true },
      ],
    );

    expect(result).toHaveLength(1);
    expect(result![0].path).toBe('/items/42');
  });

  it('finds root index as parent for top-level dynamic route', async () => {
    const result = await resolveDynamicEntries(
      { path: '/:slug', paramName: 'slug' },
      async (filePath) => {
        if (filePath === '/pages/index.ts') {
          return { loader: () => ({ pages: [{ slug: 'about' }, { slug: 'contact' }] }) };
        }
        if (filePath === '/pages/[slug].ts') {
          return {
            loader: ({ params }: any) => ({ slug: params.slug }),
          };
        }
        return null;
      },
      [
        { path: '/', filePath: '/pages/index.ts', hasLoader: true },
        { path: '/:slug', filePath: '/pages/[slug].ts', hasLoader: true },
      ],
    );

    expect(result).toHaveLength(2);
    expect(result![0].path).toBe('/about');
    expect(result![1].path).toBe('/contact');
  });
});
