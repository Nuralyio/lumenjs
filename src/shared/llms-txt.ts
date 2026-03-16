import fs from 'fs';
import path from 'path';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const;

interface LlmsTxtPage {
  path: string;
  hasLoader: boolean;
  hasSubscribe: boolean;
  hasSocket: boolean;
}

interface LlmsTxtApiRoute {
  path: string;
  methods: string[];
}

interface LlmsTxtConfig {
  title: string;
  integrations: string[];
  i18n?: { locales: string[]; defaultLocale: string };
}

/**
 * Generate the /llms.txt content for a LumenJS project.
 */
export function generateLlmsTxt(options: {
  pages: LlmsTxtPage[];
  apiRoutes: LlmsTxtApiRoute[];
  config: LlmsTxtConfig;
}): string {
  const { pages, apiRoutes, config } = options;
  const lines: string[] = [];

  lines.push(`# ${config.title}`);
  lines.push('');
  lines.push('> Built with LumenJS');
  lines.push('');

  // Pages section
  if (pages.length > 0) {
    lines.push('## Pages');
    lines.push('');
    for (const page of pages) {
      lines.push(`### ${page.path}`);
      const traits: string[] = [];
      if (page.hasLoader) traits.push('server loader');
      if (page.hasSubscribe) traits.push('live data (SSE)');
      if (page.hasSocket) traits.push('socket (bidirectional)');
      if (page.path.includes(':')) traits.push('dynamic route');
      if (traits.length > 0) {
        lines.push(`- ${traits.join(', ')}`);
      }
      lines.push('');
    }
  }

  // API routes section
  if (apiRoutes.length > 0) {
    lines.push('## API Routes');
    lines.push('');
    for (const route of apiRoutes) {
      for (const method of route.methods) {
        const fullPath = route.path.startsWith('/api') ? route.path : `/api${route.path}`;
        lines.push(`- ${method} ${fullPath}`);
      }
    }
    lines.push('');
  }

  // Features section
  const features: string[] = [];
  if (config.i18n) {
    features.push(`Internationalization (${config.i18n.locales.join(', ')})`);
  }
  if (config.integrations.includes('tailwind')) features.push('Tailwind CSS');
  if (config.integrations.includes('nuralyui')) features.push('NuralyUI Components');
  if (config.integrations.includes('socketio')) features.push('Socket.IO');

  if (features.length > 0) {
    lines.push('## Features');
    lines.push('');
    for (const f of features) {
      lines.push(`- ${f}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Detect exported HTTP methods from an API route file.
 */
export function detectApiMethods(filePath: string): string[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const methods: string[] = [];
    for (const method of HTTP_METHODS) {
      const regex = new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\s*\\(`);
      if (regex.test(content)) {
        methods.push(method);
      }
    }
    return methods;
  } catch {
    return [];
  }
}
