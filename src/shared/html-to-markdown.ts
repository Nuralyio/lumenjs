/**
 * Convert simple HTML to markdown.
 * Handles the subset of HTML that Lit SSR produces for LumenJS pages.
 * Not a full HTML parser — intentionally minimal.
 */
export function htmlToMarkdown(html: string): string {
  let md = html;

  // Extract content from declarative shadow DOM (<template shadowroot="open">...</template>)
  md = md.replace(/<template\s+shadowroot(?:mode)?="open"[^>]*>([\s\S]*?)<\/template>/gi, '$1');

  // Remove script/style tags and their content
  md = md.replace(/<script[\s\S]*?<\/script>/gi, '');
  md = md.replace(/<style[\s\S]*?<\/style>/gi, '');
  md = md.replace(/<template[\s\S]*?<\/template>/gi, '');

  // Remove Lit SSR markers (<!--lit-part-->, <!--/lit-part-->, etc.)
  md = md.replace(/<!--[\s\S]*?-->/g, '');

  // Headings
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, c) => `# ${strip(c)}\n\n`);
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, c) => `## ${strip(c)}\n\n`);
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, c) => `### ${strip(c)}\n\n`);
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, c) => `#### ${strip(c)}\n\n`);

  // Links
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => `[${strip(text)}](${href})`);

  // Bold / italic
  md = md.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, c) => `**${strip(c)}**`);
  md = md.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, c) => `*${strip(c)}*`);

  // Inline code
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, c) => `\`${strip(c)}\``);

  // Code blocks (pre > code or pre alone)
  md = md.replace(/<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi, (_, c) => `\n\`\`\`\n${decodeEntities(strip(c))}\n\`\`\`\n\n`);
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, c) => `\n\`\`\`\n${decodeEntities(strip(c))}\n\`\`\`\n\n`);

  // List items
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, c) => `- ${strip(c).trim()}\n`);

  // Table → simple text rows
  md = md.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (_, c) => {
    const cells = [...c.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((m: any) => strip(m[1]).trim());
    return cells.length > 0 ? `| ${cells.join(' | ')} |\n` : '';
  });

  // Paragraphs and divs → newlines
  md = md.replace(/<\/p>/gi, '\n\n');
  md = md.replace(/<br\s*\/?>/gi, '\n');
  md = md.replace(/<\/div>/gi, '\n');

  // Images
  md = md.replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, (_, alt) => alt ? `[${alt}]` : '');
  md = md.replace(/<img[^>]*>/gi, '');

  // Strip all remaining HTML tags
  md = md.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  md = decodeEntities(md);

  // Clean up whitespace
  md = md.replace(/\n{3,}/g, '\n\n');
  md = md.trim();

  return md + '\n';
}

/** Strip HTML tags from a string. */
function strip(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim();
}

/** Decode common HTML entities. */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rarr;/g, '→')
    .replace(/&larr;/g, '←')
    .replace(/&middot;/g, '·')
    .replace(/&copy;/g, '©')
    .replace(/\\u003c/g, '<')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ');
}
