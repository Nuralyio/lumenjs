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
  /** 'fast' uses Sonnet for quick edits, 'default' uses the standard model */
  model?: 'fast' | 'default';
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

IMPORTANT — Be fast and direct:
- Make changes immediately — do not explain what you will do before doing it.
- Read the file, make the edit, done. Minimize tool calls.
- For simple CSS/text changes, edit directly without reading first if you have the source context.
- Keep responses under 2 sentences. The user sees the diff, not your explanation.
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

  // Append i18n context — only include keys actually used in the current source file
  if ((context as any)?.i18n?.translations) {
    const i18n = (context as any).i18n;
    const locales = Object.keys(i18n.translations);
    result += `\n\nThis project uses i18n (locales: ${locales.join(', ')}).`;

    // Extract t('key') calls from source to only send relevant translations
    const sourceContent: string = (context as any).sourceContent || '';
    const usedKeys = new Set<string>();
    const tCallRegex = /t\(['"]([^'"]+)['"]\)/g;
    let tMatch;
    while ((tMatch = tCallRegex.exec(sourceContent)) !== null) {
      usedKeys.add(tMatch[1]);
    }

    if (usedKeys.size > 0) {
      result += ` Relevant translation keys from this file:\n`;
      for (const [locale, trans] of Object.entries(i18n.translations)) {
        const filtered: Record<string, any> = {};
        for (const key of usedKeys) {
          const value = getNestedValue(trans as Record<string, any>, key);
          if (value !== undefined) filtered[key] = value;
        }
        if (Object.keys(filtered).length > 0) {
          result += `locales/${locale}.json (relevant keys): ${JSON.stringify(filtered, null, 2)}\n`;
        }
      }
    } else {
      result += ` Edit locale JSON files in locales/ to change text — do not hardcode text in templates.\n`;
    }
  }

  return result;
}

/** Resolve a dot-separated key like 'home.subtitle' from a nested object */
function getNestedValue(obj: Record<string, any>, key: string): any {
  const parts = key.split('.');
  let current: any = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}
