# LumenJS

A full-stack web framework for [Lit](https://lit.dev/) web components. File-based routing, server loaders, SSR with hydration, nested layouts, API routes, and a Vite-powered dev server.

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
import { customElement } from 'lit/decorators.js';

@customElement('page-index')
export class PageIndex extends LitElement {
  static styles = css`:host { display: block; }`;

  render() {
    return html`<h1>Hello, LumenJS!</h1>`;
  }
}
```

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

@customElement('page-blog-slug')
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

### Redirects

```typescript
export async function loader({ headers }) {
  const user = await getUser(headers.authorization);
  if (!user) return { __nk_redirect: true, location: '/login', status: 302 };
  return { user };
}
```

## Nested Layouts

Create `_layout.ts` in any directory to wrap all pages in that directory and its subdirectories.

```typescript
// pages/_layout.ts
@customElement('layout-root')
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

@customElement('layout-dashboard')
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
