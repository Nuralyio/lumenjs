/**
 * Lightweight markdown-to-HTML renderer for AI chat panels.
 * Handles: fenced code blocks, inline code, bold, italic, lists, paragraphs.
 * No external dependencies — all rendering is done inline.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Convert markdown text to safe HTML.
 * Escapes all HTML first, then applies markdown transformations.
 */
export function renderMarkdown(raw: string): string {
  if (!raw) return '';

  // Extract fenced code blocks before escaping so we can handle them specially
  const codeBlocks: string[] = [];
  const BLOCK_PH = '\x00CB';

  // Replace fenced code blocks with placeholders
  let text = raw.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    const escaped = escapeHtml(code.replace(/\n$/, ''));
    const langAttr = lang ? ` data-lang="${escapeHtml(lang)}"` : '';
    const langLabel = lang ? `<span class="nk-ai-code-lang">${escapeHtml(lang)}</span>` : '';
    codeBlocks.push(`<pre class="nk-ai-pre"${langAttr}>${langLabel}<code>${escaped}</code></pre>`);
    return `${BLOCK_PH}${codeBlocks.length - 1}${BLOCK_PH}`;
  });

  // Escape HTML in the remaining text
  text = escapeHtml(text);

  // Restore code block placeholders (they were already escaped/formatted)
  text = text.replace(new RegExp(`${BLOCK_PH}(\\d+)${BLOCK_PH}`, 'g'), (_m, idx) => codeBlocks[parseInt(idx)]);

  // Inline code (single backtick)
  text = text.replace(/`([^`\n]+)`/g, '<code class="nk-ai-code">$1</code>');

  // Bold
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic (single asterisk, not inside words)
  text = text.replace(/(?<!\w)\*([^*\n]+?)\*(?!\w)/g, '<em>$1</em>');

  // Split into blocks by double newlines (but preserve code blocks)
  const blocks = text.split(/\n{2,}/);
  const rendered = blocks.map(block => {
    const trimmed = block.trim();
    if (!trimmed) return '';

    // Already a rendered code block
    if (trimmed.startsWith('<pre ')) return trimmed;

    // Unordered list
    if (/^[-*]\s/.test(trimmed)) {
      const items = trimmed.split('\n')
        .filter(line => /^[-*]\s/.test(line.trim()))
        .map(line => `<li>${line.trim().replace(/^[-*]\s+/, '')}</li>`)
        .join('');
      return `<ul>${items}</ul>`;
    }

    // Ordered list
    if (/^\d+\.\s/.test(trimmed)) {
      const items = trimmed.split('\n')
        .filter(line => /^\d+\.\s/.test(line.trim()))
        .map(line => `<li>${line.trim().replace(/^\d+\.\s+/, '')}</li>`)
        .join('');
      return `<ol>${items}</ol>`;
    }

    // Regular paragraph — convert single newlines to <br>
    return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
  });

  return rendered.filter(Boolean).join('');
}
