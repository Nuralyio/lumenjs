# LumenJS

Full-stack Lit web component framework with file-based routing, server loaders, SSR, and API routes.

Published as `@nuraly/lumenjs` (MIT, v0.3.0). Mirrored to `Nuralyio/lumenjs`.

## Source Structure

```
src/
├── cli.ts                 # Entry: create/dev/build/serve/add commands
├── dev-server/
│   ├── server.ts          # Vite dev server, getSharedViteConfig()
│   ├── config.ts          # Reads lumenjs.config.ts (title, integrations, i18n)
│   ├── ssr-render.ts      # SSR: layout chain + loader execution via @lit-labs/ssr
│   ├── index-html.ts      # HTML shell generation with SSR data inlining
│   ├── nuralyui-aliases.ts # NuralyUI component path resolution
│   ├── middleware/
│   │   └── locale.ts      # i18n locale detection from URL/cookie/header
│   └── plugins/           # Vite plugins (see below)
├── build/
│   ├── build.ts           # Production build (client + server bundles via Vite)
│   ├── scan.ts            # Scans pages/, layouts, api/, middleware
│   ├── serve.ts           # Production Express server
│   ├── serve-loaders.ts   # Prod loader/subscribe endpoint handlers
│   ├── serve-api.ts       # Prod API route handlers
│   ├── serve-ssr.ts       # Prod SSR rendering
│   ├── serve-static.ts    # Static asset serving
│   ├── serve-i18n.ts      # Prod i18n translation serving
│   └── error-page.ts      # Error page HTML
├── runtime/               # Client-side (ships to browser)
│   ├── app-shell.ts       # <nk-app> — root element, creates router
│   ├── router.ts          # NkRouter — SPA navigation, layout diffing, loader fetching
│   ├── router-data.ts     # Fetches loader/subscribe/component-loader data from server endpoints
│   ├── router-hydration.ts # SSR hydration logic (pages, layouts, components)
│   ├── component-loader.ts # __nk_setupComponentLoader — auto-patches connectedCallback for component loaders
│   ├── response.ts        # Response helpers (redirect, json)
│   ├── i18n.ts            # Client i18n: t(), getLocale(), setLocale()
│   ├── error-boundary.ts  # <nk-error-boundary> — catches render errors, shows fallback
│   └── socket-client.ts   # Socket.io client wrapper
├── editor/                # Visual editor mode
│   ├── editor-bridge.ts   # Host ↔ editor iframe communication
│   ├── standalone-overlay.ts # Selection/hover overlay for editor
│   ├── inline-text-edit.ts   # In-place text editing
│   ├── ast-service.ts     # AST parsing/modification of page files
│   ├── file-service.ts    # File read/write for editor API
│   ├── properties-panel.ts # Component property editing panel
│   ├── ai-chat-panel.ts   # AI assistant panel
│   └── ...
├── shared/
│   ├── types.ts           # BuildManifest, ManifestRoute, ManifestLayout, ManifestComponent
│   ├── utils.ts           # filePathToTagName, filePathToRoute, fileHasLoader, etc.
│   ├── route-matching.ts  # URL pattern matching
│   ├── middleware-runner.ts # Express-style middleware chain execution
│   ├── logger.ts          # Structured logging (JSON prod, pretty dev, log levels)
│   ├── security-headers.ts # CSP, X-Frame-Options, HSTS, etc. middleware
│   ├── rate-limit.ts      # Token bucket rate limiter middleware
│   ├── health.ts          # /__health endpoint handler
│   ├── request-id.ts      # X-Request-ID generation/propagation
│   ├── graceful-shutdown.ts # SIGTERM/SIGINT handler with connection draining
│   ├── dom-shims.ts       # DOM shims for SSR
│   ├── meta.ts            # Page meta/head management
│   ├── socket-io-setup.ts # Socket.io server setup
│   └── llms-txt.ts        # llms.txt generation
├── integrations/
│   └── add.ts             # `lumenjs add <integration>` handler
├── db/
│   ├── context.ts         # Database context for loaders
│   └── index.ts           # DB exports
├── llms/
│   └── generate.ts        # LLM text generation
└── create.ts              # `lumenjs create` scaffolder
```

## Vite Plugins

| Plugin | File | Purpose |
|---|---|---|
| `vite-plugin-routes` | Routes from `pages/` → virtual `virtual:lumenjs-routes` module |
| `vite-plugin-loaders` | Handles `/__nk_loader/*` and `/__nk_subscribe/*` SSE endpoints |
| `vite-plugin-api-routes` | Handles `/api/*` routes with named HTTP method exports |
| `vite-plugin-auto-define` | Auto-registers custom elements from file paths (no decorator needed) |
| `vite-plugin-auto-import` | NuralyUI `<nr-*>` component auto-import |
| `vite-plugin-i18n` | Serves `/__nk_i18n/*.json` translation files |
| `vite-plugin-lit-dedup` | Forces single Lit instance across all modules |
| `vite-plugin-lit-hmr` | HMR support for Lit components |
| `vite-plugin-source-annotator` | Annotates elements with source file info (editor mode only) |
| `vite-plugin-virtual-modules` | Exposes runtime/editor modules as virtual imports |
| `vite-plugin-editor-api` | REST API for editor file operations and AST modification |
| `vite-plugin-llms` | LLM integration plugin |
| `vite-plugin-socketio` | Socket.io dev server integration |

## Key Conventions

### File-based routing
- `pages/` → URL routes. `pages/index.ts` → `/`, `pages/blog/[slug].ts` → `/blog/:slug`
- `[slug]` = dynamic param, `[...rest]` = catch-all
- `_layout.ts` in any directory = nested layout (uses `<slot>`, persists across navigation)
- `_middleware.ts` in any directory = Express-style middleware for that route subtree
- `_`-prefixed folders/files are ignored by the router (except `_layout` and `_middleware`). Use for colocated components: `pages/feed/_components/post-card.ts`
- `api/` → API routes with named exports: `GET`, `POST`, `PUT`, `DELETE`

### Auto-registration
- File path → tag name: `pages/docs/api-routes.ts` → `<page-docs-api-routes>`
- Layouts: `pages/dashboard/_layout.ts` → `<layout-dashboard>`
- No `@customElement` decorator needed

### Server loaders (pages)
- `export async function loader({ params, query, url, headers, locale })` — runs server-side
- Each key in the returned object is auto-spread as an individual property on the element
- Declare each key as its own property (e.g., `static properties = { stats: { type: Array } }` if loader returns `{ stats: [...] }`)
- Access directly as `this.stats` — no `loaderData` wrapper needed
- Return `{ __nk_redirect: true, location: '/path', status: 302 }` for redirects
- **Co-located loader**: for folder routes (`pages/foo/index.ts`), place a `_loader.ts` in the same directory — auto-discovered, no import or wrapper needed in the page file. Inline loader always wins if both exist. Only works for `index.ts` pages; flat pages keep the loader inline.

### Component loaders
- Any Lit component file (outside `pages/`) can export `loader()` — same syntax as page loaders
- The Vite transform auto-strips the loader from the client bundle and injects `__nk_setupComponentLoader` to patch `connectedCallback`
- No mixin or file path string needed — just `export async function loader() { ... }` before the class
- **SSR**: component loaders are discovered from the page module's import graph in `ssr-render.ts`, run server-side, and data is set on the class prototype before Lit renders. Data is inlined in `__nk_ssr_data__` under the `components` key for hydration.
- **CSR navigation**: `connectedCallback` fetches from `/__nk_loader/__component/?__file=<relative-path>`, spreads data as properties, and calls `requestUpdate()`
- **Hydration**: `router-hydration.ts` reads `ssrData.components` and sets data on matching DOM elements before module load
- Component loaders receive `{ params: {}, query, url, headers, locale, user }` — `params` is always empty (no URL segments)
- Best for **parameterless global data** (nav, sidebar, footer). For instance-specific data, use the page loader and pass props.
- `subscribe()` (SSE) is not supported for components — only pages and layouts
- Files touched: `vite-plugin-loaders.ts` (strip + endpoint), `ssr-render.ts`, `index-html.ts`, `router-hydration.ts`, `router-data.ts`, `component-loader.ts`, `serve-loaders.ts`, `serve-ssr.ts`, `serve.ts`, `types.ts`, `vite-plugin-virtual-modules.ts`

### Socket (Socket.IO)
- `export function socket({ on, push, room, params, headers, locale, socket })` — bidirectional Socket.IO handler
- `push(data)` spreads keys as individual properties on the element (same as loader/subscribe)
- `on(event, handler)` listens for `nk:{event}` from the client; `emit(event, payload)` on the element sends to server
- `room.join(name)`, `.broadcast(name, data)`, `.broadcastAll(name, data)` for room management
- Return a cleanup function from `socket()` — called on disconnect
- **Co-located socket**: place a `_socket.ts` next to `index.ts` with `export function socket(...)` — auto-discovered, no import needed. Inline socket always wins if both exist. Only works for folder routes.

### Subscribe (SSE)
- `export async function subscribe({ params, headers, locale, push })` — server-sent events
- Each key from `push(data)` is spread as an individual property on the element (same as loader data)
- Declare matching properties for each key pushed
- Return a cleanup function

### Config file
- `lumenjs.config.ts` at project root with `title`, `integrations: string[]`, `i18n: { locales, defaultLocale, prefixDefault }`
- Parsed via regex (not imported) — keep format simple

### Build output
- `.lumenjs/client/` — static assets (Vite client build)
- `.lumenjs/server/` — SSR modules + API handlers (Vite SSR build)
- `.lumenjs/manifest.json` — route manifest with loader/subscribe flags
- Lit is forced into a single `lit-shared` chunk in server builds to avoid `_$EM` mismatches

## Testing

- Framework: Vitest (`npm test` / `vitest run`)
- Test files: co-located as `*.test.ts` next to source files
- Run inside Docker, not on host

## Dependencies

- `lit` ^3.1.0, `@lit-labs/ssr` ^3.2.0, `vite` ^5.4.0, `glob` ^10.2.1
- Node.js 18+
- TypeScript compiled via `tsc` (not Vite)

## Commit Convention

LumenJS uses scoped conventional commits. CI auto-publishes to npm based on these scopes — **always use the correct scope** or the release won't trigger.

| Type | Scope | Version bump | Example |
|---|---|---|---|
| `fix` | `lumenjs` | patch `0.3.x` | `fix(lumenjs): resolve _loader.ts SSR edge case` |
| `feat` | `lumenjs` | minor `0.x.0` | `feat(lumenjs): add _loader.ts co-location` |
| `feat!` / `BREAKING` | `lumenjs` | major `x.0.0` | `feat(lumenjs)!: rename subscribe API` |
| anything | other scope | none | `feat(api): add webhook` — ignored by lumenjs CI |
| `chore`, `docs`, `test`, `refactor` | `lumenjs` | none | `chore(lumenjs): update tests` — no release |

**Rules:**
- Only `feat(lumenjs)` and `fix(lumenjs)` trigger a release
- The version-bump commit itself uses `chore(lumenjs): release vX.Y.Z` — never manually write this
- Never bump `libs/lumenjs/package.json` by hand — CI owns the version
- The bump commit is mirrored to `Nuralyio/lumenjs` automatically via the mirror workflow

## Don't

- Don't import `lumenjs.config.ts` dynamically — it's parsed via regex in `config.ts`
- Don't add `@customElement` decorators to pages/layouts — auto-define handles registration
- Don't put loader/subscribe exports after `export class` — `hasTopLevelExport()` checks ordering
- Don't add a `_loader.ts` to a flat page file (e.g. `pages/about.ts`) — co-located loader discovery only applies to folder routes (`index.ts`)
- Don't duplicate Lit instances — `litDedupPlugin` and `manualChunks` exist to prevent this
- Don't modify virtual module IDs (`virtual:lumenjs-routes`, `@lumenjs/i18n`) without updating all consumers
