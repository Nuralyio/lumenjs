import { LitElement, html, css } from 'lit';

const ALL_POSTS = [
  { slug: 'hello-world', title: 'Hello World', date: '2025-01-15', excerpt: 'Welcome to my blog built with LumenJS.', tags: ['introduction', 'lumenjs'] },
  { slug: 'getting-started', title: 'Getting Started with LumenJS', date: '2025-01-20', excerpt: 'Learn how to build web apps with Lit components and file-based routing.', tags: ['tutorial', 'lumenjs', 'web-components'] },
];

export async function loader({ params }: { params: { tag: string } }) {
  const posts = ALL_POSTS.filter(p => p.tags.includes(params.tag));
  return { tag: params.tag, posts };
}

export class PageTag extends LitElement {
  static properties = { loaderData: { type: Object } };
  loaderData: any = {};

  static styles = css`
    :host { display: block; }
    h1 { font-size: 2rem; margin-bottom: 0.5rem; }
    .subtitle { color: #64748b; margin-bottom: 2rem; }
    .post { border-bottom: 1px solid #e2e8f0; padding: 1.5rem 0; }
    .post:last-child { border-bottom: none; }
    .post a { color: #1e293b; text-decoration: none; font-size: 1.25rem; font-weight: 600; }
    .post a:hover { color: #7c3aed; }
    .meta { color: #94a3b8; font-size: 0.875rem; margin-top: 0.25rem; }
    .back { color: #7c3aed; text-decoration: none; font-size: 0.875rem; }
    .back:hover { text-decoration: underline; }
  `;

  render() {
    const { tag, posts } = this.loaderData;
    return html`
      <a class="back" href="/">← All posts</a>
      <h1>Tagged: ${tag}</h1>
      <p class="subtitle">${posts?.length || 0} post${posts?.length !== 1 ? 's' : ''}</p>
      ${(posts || []).map((p: any) => html`
        <div class="post">
          <a href="/posts/${p.slug}">${p.title}</a>
          <div class="meta">${p.date}</div>
        </div>
      `)}
    `;
  }
}
