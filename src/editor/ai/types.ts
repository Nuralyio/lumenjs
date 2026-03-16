/**
 * Shared types and constants for AI backend clients.
 */

export interface AiChatOptions {
  mode: 'element' | 'project';
  prompt: string;
  context: {
    sourceFile?: string;
    sourceLine?: number;
    elementTag?: string;
    elementAttributes?: Record<string, string>;
    sourceContent?: string;
  };
  sessionId?: string;
}

export interface AiChatResult {
  sessionId: string;
  onToken: (cb: (text: string) => void) => void;
  onDone: (cb: (fullText: string) => void) => void;
  onError: (cb: (err: Error) => void) => void;
  abort: () => void;
}

export interface AiStatusResult {
  configured: boolean;
  backend: 'claude-code' | 'opencode';
}

export const SYSTEM_PROMPT = `You are an AI coding assistant working inside a LumenJS project.

LumenJS is a full-stack Lit web component framework with file-based routing, server loaders, SSR, and API routes.

Key conventions:
- Pages live in \`pages/\` directory — file path maps to URL route
- Components are Lit web components (LitElement) auto-registered by file path
- Layouts: \`_layout.ts\` in any directory for nested layouts (use <slot>)
- API routes: \`api/\` directory with named exports (GET, POST, PUT, DELETE)
- Server loaders: \`export async function loader()\` for server-side data fetching
- Styles: use Tailwind CSS classes or Lit's \`static styles\` with css template tag
- Config: \`lumenjs.config.ts\` at project root

IMPORTANT — Styling rules:
- When asked to change a style (color, font, spacing, etc.), find and UPDATE the EXISTING CSS rule in \`static styles = css\\\`...\\\`\`. Do NOT add a new class or duplicate rule.
- Never add inline \`style="..."\` attributes on HTML template elements. Always modify the CSS rule in \`static styles\`.
- Example: to change the h1 color, find the \`h1 { ... }\` rule in \`static styles\` and update its \`color\` property. Do not create a new class.
- If no CSS rule exists for the element, add one to the existing \`static styles\` block — do not add a separate \`<style>\` tag.

IMPORTANT — i18n / translation rules (when the project uses i18n):
- Text content in templates uses \`t('key')\` from \`@lumenjs/i18n\` — NEVER replace a \`t()\` call with hardcoded text.
- To change displayed text, edit the translation value in \`locales/<locale>.json\` — do NOT modify the template.
- Example: to change the subtitle, update \`"home.subtitle"\` in \`locales/en.json\` (and other locale files like \`locales/fr.json\`).
- To add new text, add a key to ALL locale JSON files and use \`t('new.key')\` in the template.
- The dev server watches locale files and updates the page automatically via HMR.

You have full access to the filesystem and can run shell commands.
When a task requires a new npm package, install it with \`npm install <package>\`.
After npm install, the dev server will automatically restart to load the new dependency.
Vite's HMR will pick up file changes automatically — no manual restart needed.
`;

export function buildPrompt(options: AiChatOptions): string {
  const { mode, prompt, context } = options;
  let result = prompt;

  if (mode === 'element' && context.elementTag) {
    let enriched = `I'm looking at \`<${context.elementTag}>\``;
    if (context.sourceFile) {
      enriched += ` in \`${context.sourceFile}`;
      if (context.sourceLine) enriched += `:${context.sourceLine}`;
      enriched += '`';
    }
    if (context.elementAttributes && Object.keys(context.elementAttributes).length > 0) {
      const attrs = Object.entries(context.elementAttributes)
        .map(([k, v]) => `${k}="${v}"`)
        .join(' ');
      enriched += ` with attributes: ${attrs}`;
    }
    enriched += `. ${prompt}`;
    result = enriched;
  }

  // Append i18n context so the AI knows to edit locale files, not templates
  if ((context as any)?.i18n?.translations) {
    const i18n = (context as any).i18n;
    const locales = Object.keys(i18n.translations);
    result += `\n\nThis project uses i18n (locales: ${locales.join(', ')}). Translation files:\n`;
    for (const [locale, trans] of Object.entries(i18n.translations)) {
      result += `locales/${locale}.json: ${JSON.stringify(trans, null, 2)}\n`;
    }
  }

  return result;
}
