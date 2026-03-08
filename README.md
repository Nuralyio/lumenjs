# LumenJS

A full-stack web framework for [Lit](https://lit.dev/) web components. File-based routing, server loaders, real-time subscriptions (SSE), SSR with hydration, nested layouts, API routes, and a Vite-powered dev server.

## Quick Start

```bash
npx lumenjs dev --project ./my-app
```

## Project Structure

```
my-app/
├── lumenjs.config.ts       # Project config
├── package.json
├── pages/                  # File-based routes
│   ├── _layout.ts          # Root layout
│   ├── index.ts            # → /
│   ├── about.ts            # → /about
│   └── blog/
│       ├── _layout.ts      # Nested layout (wraps blog/*)
│       ├── index.ts         # → /blog
│       └── [slug].ts       # → /blog/:slug
├── api/                    # API routes
│   └── hello.ts            # → /api/hello
└── public/                 # Static assets
```

## Configuration

```typescript
// lumenjs.config.ts
export default {
  title: 'My App',
  integrations: ['tailwind'],
};
```

| Option | Type | Description |
|---|---|---|
| `title` | `string` | HTML page title |
| `integrations` | `string[]` | Optional integrations: `'tailwind'`, `'nuralyui'` |

## Pages

Pages are Lit components in the `pages/` directory. The file path determines the URL.

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

The custom element tag name is derived automatically from the file path — no `@customElement` decorator needed.

### Routing

| File | URL | Tag |
|---|---|---|
| `pages/index.ts` | `/` | `<page-index>` |
| `pages/about.ts` | `/about` | `<page-about>` |
| `pages/blog/index.ts` | `/blog` | `<page-blog-index>` |
| `pages/blog/[slug].ts` | `/blog/:slug` | `<page-blog-slug>` |
| `pages/[...slug].ts` | `/*` (catch-all) | `<page-slug>` |

Static routes take priority over dynamic ones. Dynamic `[param]` routes take priority over catch-all `[...param]` routes.

## Loaders

Export a `loader()` function from any page or layout to fetch data on the server.

```typescript
// pages/blog/[slug].ts
export async function loader({ params, headers, query, url }) {
  const post = await db.posts.findOne({ slug: params.slug });
  if (!post) return { __nk_redirect: true, location: '/404', status: 302 };
  return { post };
}

export class BlogPost extends LitElement {
  @property({ type: Object }) loaderData: any = {};

  render() {
    return html`<h1>${this.loaderData.post?.title}</h1>`;
  }
}
```

Loaders run server-side on initial load (SSR) and are fetched via `/__nk_loader/<path>` during client-side navigation. The `loader()` export is automatically stripped from client bundles.

### Loader Context

| Property | Type | Description |
|---|---|---|
| `params` | `Record<string, string>` | Dynamic route parameters |
| `query` | `Record<string, string>` | Query string parameters |
| `url` | `string` | Request pathname |
| `headers` | `Record<string, any>` | Request headers |
| `locale` | `string` | Current locale (when i18n is configured) |

### Redirects

```typescript
export async function loader({ headers }) {
  const user = await getUser(headers.authorization);
  if (!user) return { __nk_redirect: true, location: '/login', status: 302 };
  return { user };
}
```

## Live Data (subscribe)

Export a `subscribe()` function from any page or layout to push real-time data to the client over Server-Sent Events (SSE).

```typescript
// pages/dashboard.ts
export async function loader() {
  return { orders: await db.orders.findAll() };
}

export function subscribe({ push }) {
  const stream = db.orders.watch();
  stream.on('change', (change) => push({ type: 'order-update', data: change }));
  return () => stream.close();
}

export class PageDashboard extends LitElement {
  @property({ type: Object }) loaderData: any = {};
  @property({ type: Object }) liveData: any = null;

  render() {
    return html`
      <h1>Orders (${this.loaderData.orders?.length})</h1>
      ${this.liveData ? html`<p>Update: ${this.liveData.type}</p>` : ''}
    `;
  }
}
```

The `subscribe()` function is a persistent server-side process tied to the page lifecycle:

1. User opens page → framework opens SSE connection to `/__nk_subscribe/<path>`
2. Server calls `subscribe()` — function keeps running (DB watchers, intervals, etc.)
3. Call `push(data)` whenever you want → delivered to client → updates `liveData` property
4. User navigates away → connection closes → cleanup function runs

Like `loader()`, `subscribe()` is stripped from client bundles automatically.

### Subscribe Context

| Property | Type | Description |
|---|---|---|
| `params` | `Record<string, string>` | Dynamic route parameters |
| `headers` | `Record<string, any>` | Request headers |
| `locale` | `string` | Current locale (when i18n is configured) |
| `push` | `(data: any) => void` | Send SSE event to client (JSON-serialized) |

Return a cleanup function that is called when the client disconnects.

### Layout Subscribe

Layouts can also export `subscribe()` for global live data (notifications, presence, etc.):

```typescript
// pages/_layout.ts
export function subscribe({ push }) {
  const ws = new WebSocket('wss://notifications.example.com');
  ws.on('message', (msg) => push(JSON.parse(msg)));
  return () => ws.close();
}
```

## Nested Layouts

Create `_layout.ts` in any directory to wrap all pages in that directory and its subdirectories.

```typescript
// pages/_layout.ts
export class RootLayout extends LitElement {
  render() {
    return html`
      <header>My App</header>
      <main><slot></slot></main>
      <footer>Footer</footer>
    `;
  }
}
```

Layouts persist across navigation — when navigating between pages that share the same layout, only the page component is swapped.

Layouts can have their own `loader()` function for shared data like auth or navigation:

```typescript
// pages/dashboard/_layout.ts
export async function loader({ headers }) {
  const user = await getUser(headers.authorization);
  if (!user) return { __nk_redirect: true, location: '/login', status: 302 };
  return { user };
}

export class DashboardLayout extends LitElement {
  @property({ type: Object }) loaderData: any = {};

  render() {
    return html`
      <nav>Welcome, ${this.loaderData.user?.name}</nav>
      <slot></slot>
    `;
  }
}
```

## API Routes

Create files in `api/` and export named functions for each HTTP method.

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

### Request Object

| Property | Type | Description |
|---|---|---|
| `method` | `string` | HTTP method |
| `url` | `string` | Request pathname |
| `query` | `Record<string, string>` | Query string parameters |
| `params` | `Record<string, string>` | Dynamic route parameters |
| `body` | `any` | Parsed JSON body (non-GET) |
| `files` | `NkUploadedFile[]` | Uploaded files (multipart) |
| `headers` | `Record<string, any>` | Request headers |

### Error Responses

```typescript
export async function GET(req) {
  const item = await db.find(req.params.id);
  if (!item) throw { status: 404, message: 'Not found' };
  return item;
}
```

### File Uploads

Multipart form data is parsed automatically:

```typescript
export async function POST(req) {
  for (const file of req.files) {
    console.log(file.fileName, file.size, file.contentType);
    // file.data is a Buffer
  }
  return { uploaded: req.files.length };
}
```

## SSR & Hydration

Pages with loaders are automatically server-rendered using `@lit-labs/ssr`:

1. Loader runs on the server
2. Lit component renders to HTML
3. Loader data is embedded as JSON in the response
4. Browser receives pre-rendered HTML (fast first paint)
5. Client hydrates the existing DOM without re-rendering

Pages without loaders render client-side only (SPA mode). If SSR fails, LumenJS falls back gracefully to client-side rendering.

## Internationalization (i18n)

LumenJS has built-in i18n support with URL-prefix-based locale routing.

### Setup

1. Add i18n config to `lumenjs.config.ts`:

```typescript
export default {
  title: 'My App',
  i18n: {
    locales: ['en', 'fr'],
    defaultLocale: 'en',
    prefixDefault: false, // / instead of /en/
  },
};
```

2. Create translation files in `locales/`:

```
my-app/
├── locales/
│   ├── en.json    # { "home.title": "Welcome", "nav.docs": "Docs" }
│   └── fr.json    # { "home.title": "Bienvenue", "nav.docs": "Documentation" }
├── pages/
└── lumenjs.config.ts
```

### Usage

```typescript
import { t, getLocale, setLocale } from '@lumenjs/i18n';

export class PageIndex extends LitElement {
  render() {
    return html`<h1>${t('home.title')}</h1>`;
  }
}
```

### API

| Function | Description |
|---|---|
| `t(key)` | Returns the translated string for the key, or the key itself if not found |
| `getLocale()` | Returns the current locale string |
| `setLocale(locale)` | Switches locale — sets cookie, navigates to the localized URL |

### Locale Resolution

Locale is resolved in this order:

1. URL prefix: `/fr/about` → locale `fr`, pathname `/about`
2. Cookie `nk-locale` (set on explicit locale switch)
3. `Accept-Language` header (SSR)
4. Config `defaultLocale`

### URL Routing

With `prefixDefault: false`, the default locale uses clean URLs:

| URL | Locale | Page |
|---|---|---|
| `/about` | `en` (default) | `pages/about.ts` |
| `/fr/about` | `fr` | `pages/about.ts` |

Routes are locale-agnostic — you don't need separate pages per locale. The router strips the locale prefix before matching and prepends it during navigation.

### SSR

Translations are server-rendered. The `<html lang="...">` attribute is set dynamically, and translations are inlined in the response for hydration without flash of untranslated content.

## Integrations

### Tailwind CSS

```bash
npx lumenjs add tailwind
```

This installs `tailwindcss` and `@tailwindcss/vite`, creates `styles/tailwind.css`, and updates your config. For pages using Tailwind classes in light DOM:

```typescript
createRenderRoot() { return this; }
```

### NuralyUI

Add `'nuralyui'` to integrations to enable auto-import of `<nr-*>` components:

```typescript
// lumenjs.config.ts
export default {
  title: 'My App',
  integrations: ['nuralyui'],
};
```

NuralyUI components are detected in `html\`\`` templates and imported automatically, including implicit dependencies (e.g., `nr-button` auto-imports `nr-icon`).

## CLI

```
lumenjs dev    [--project <dir>] [--port <port>] [--base <path>] [--editor-mode]
lumenjs build  [--project <dir>] [--out <dir>]
lumenjs serve  [--project <dir>] [--port <port>]
lumenjs add    <integration>
```

| Command | Description |
|---|---|
| `dev` | Start Vite dev server with HMR, SSR, and API routes |
| `build` | Bundle client assets and server modules for production |
| `serve` | Serve the production build with SSR and gzip compression |
| `add` | Add an integration (e.g., `tailwind`) |

### Default Ports

| Mode | Default |
|---|---|
| `dev` | 3000 |
| `serve` | 3000 |

## Production Build

```bash
npx lumenjs build --project ./my-app
npx lumenjs serve --project ./my-app --port 8080
```

The build outputs to `.lumenjs/`:

```
.lumenjs/
├── client/           # Static assets (HTML, JS, CSS)
├── server/           # Server modules (loaders, API routes, SSR runtime)
└── manifest.json     # Route manifest
```

The production server includes gzip compression and serves pre-built assets while executing loaders and API routes on demand.

## License

MIT
