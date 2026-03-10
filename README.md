<p align="center">
  <img src="https://img.shields.io/npm/v/@nuraly/lumenjs?color=7c3aed&label=npm" alt="npm version" />
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="license" />
  <img src="https://img.shields.io/badge/lit-3.x-324fff" alt="Lit 3" />
  <img src="https://img.shields.io/badge/node-%3E%3D18-green" alt="node" />
</p>

# LumenJS

A full-stack web framework for [Lit](https://lit.dev/) web components. File-based routing, server loaders, real-time subscriptions (SSE), SSR with hydration, nested layouts, API routes, i18n, and a visual editor — all powered by Vite.

## Getting Started

```bash
npx @nuraly/lumenjs create my-app
cd my-app
npm install
npx lumenjs dev
```

Open [http://localhost:3000](http://localhost:3000) — you're live.

### Templates

```bash
npx @nuraly/lumenjs create my-app                        # default starter
npx @nuraly/lumenjs create my-blog --template blog       # blog with file-based posts
npx @nuraly/lumenjs create my-dash --template dashboard  # real-time dashboard with SSE
```

## Features

- **File-based routing** — `pages/about.ts` → `/about`, `pages/blog/[slug].ts` → `/blog/:slug`
- **Server loaders** — fetch data server-side, hydrate on the client
- **Live data (SSE)** — `subscribe()` pushes real-time updates to the browser
- **SSR + hydration** — pre-rendered HTML with `@lit-labs/ssr`, zero flash
- **Nested layouts** — `_layout.ts` wraps child routes, persists across navigation
- **API routes** — `api/users.ts` → REST endpoints with file uploads
- **i18n** — URL-prefix routing, JSON translations, SSR-safe
- **Visual editor** — click-to-select, inline text editing, file browser
- **Tailwind & NuralyUI** — one command to add integrations

## Pages

Pages are Lit components in `pages/`. The file path determines the URL.

```typescript
// pages/index.ts
import { LitElement, html, css } from 'lit';

export class PageIndex extends LitElement {
  static styles = css`:host { display: block; }`;

  render() {
    return html`<h1>Hello, LumenJS!</h1>`;
  }
}
```

No `@customElement` decorator needed — tag names are derived from the file path.

| File | URL | Tag |
|---|---|---|
| `pages/index.ts` | `/` | `<page-index>` |
| `pages/about.ts` | `/about` | `<page-about>` |
| `pages/blog/[slug].ts` | `/blog/:slug` | `<page-blog-slug>` |
| `pages/[...slug].ts` | `/*` (catch-all) | `<page-slug>` |

## Loaders

Export a `loader()` to fetch data server-side. It runs on SSR and via `/__nk_loader/<path>` during client-side navigation. Automatically stripped from client bundles.

```typescript
// pages/blog/[slug].ts
export async function loader({ params }) {
  const post = await db.posts.findOne({ slug: params.slug });
  if (!post) return { __nk_redirect: true, location: '/404', status: 302 };
  return { post };
}

export class BlogPost extends LitElement {
  static properties = { loaderData: { type: Object } };
  loaderData: any = {};

  render() {
    return html`<h1>${this.loaderData.post?.title}</h1>`;
  }
}
```

### Loader Context

| Property | Type | Description |
|---|---|---|
| `params` | `Record<string, string>` | Dynamic route parameters |
| `query` | `Record<string, string>` | Query string parameters |
| `url` | `string` | Request pathname |
| `headers` | `Record<string, any>` | Request headers |
| `locale` | `string` | Current locale (when i18n is configured) |

## Live Data (subscribe)

Export a `subscribe()` to push real-time data over Server-Sent Events.

```typescript
// pages/dashboard.ts
export function subscribe({ push }) {
  const interval = setInterval(() => {
    push({ time: new Date().toISOString(), count: ++n });
  }, 1000);
  return () => clearInterval(interval);
}

export class PageDashboard extends LitElement {
  static properties = { liveData: { type: Object } };
  liveData: any = null;

  render() {
    return html`<p>Server time: ${this.liveData?.time}</p>`;
  }
}
```

Return a cleanup function — it runs when the client disconnects.

## Layouts

Create `_layout.ts` in any directory. It wraps all pages below it and persists across navigation.

```typescript
// pages/_layout.ts
export class RootLayout extends LitElement {
  render() {
    return html`
      <header>My App</header>
      <main><slot></slot></main>
    `;
  }
}
```

Layouts can have their own `loader()` and `subscribe()` for shared data (auth, notifications, etc.).

## API Routes

Files in `api/` become REST endpoints. Export named functions for each HTTP method.

```typescript
// api/users/[id].ts
export async function GET(req) {
  return { user: { id: req.params.id, name: 'Alice' } };
}

export async function POST(req) {
  const { name } = req.body;
  return { created: true, name };
}
```

Supports JSON bodies, query params, dynamic routes, file uploads (`req.files`), and error handling via `throw { status, message }`.

## i18n

```typescript
// lumenjs.config.ts
export default {
  i18n: { locales: ['en', 'fr'], defaultLocale: 'en' },
};
```

```typescript
import { t, setLocale } from '@lumenjs/i18n';

html`<h1>${t('home.title')}</h1>
     <button @click=${() => setLocale('fr')}>FR</button>`;
```

Translations live in `locales/en.json`, `locales/fr.json`. URL routing: `/about` (default), `/fr/about` (French). Server-rendered, no flash.

## Integrations

```bash
npx lumenjs add tailwind    # Tailwind CSS via @tailwindcss/vite
```

```typescript
// lumenjs.config.ts — NuralyUI auto-import
export default { integrations: ['nuralyui'] };
```

## CLI

```
lumenjs create <name> [--template <default|blog|dashboard>]
lumenjs dev    [--project <dir>] [--port <port>] [--editor-mode]
lumenjs build  [--project <dir>] [--out <dir>]
lumenjs serve  [--project <dir>] [--port <port>]
lumenjs add    <integration>
```

## Production

```bash
npx lumenjs build --project ./my-app
npx lumenjs serve --project ./my-app --port 8080
```

Outputs to `.lumenjs/` — pre-built client assets, server modules, route manifest. The production server handles SSR, loaders, API routes, and gzip compression.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

MIT
