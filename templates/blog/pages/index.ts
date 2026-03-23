import { LitElement, html, css } from 'lit';

export async function loader() {
  return {
    posts: [
      { slug: 'hello-world', title: 'Hello World', date: '2025-01-15', excerpt: 'Welcome to my blog built with LumenJS.', tags: ['introduction', 'lumenjs'] },
      { slug: 'getting-started', title: 'Getting Started with LumenJS', date: '2025-01-20', excerpt: 'Learn how to build web apps with Lit components and file-based routing.', tags: ['tutorial', 'lumenjs', 'web-components'] },
    ],
  };
}

export class PageIndex extends LitElement {
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
    .excerpt { color: #64748b; margin-top: 0.5rem; line-height: 1.5; }
    .tags { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.5rem; }
    .tag { display: inline-block; padding: 0.125rem 0.5rem; background: #f1f5f9; color: #7c3aed; border-radius: 9999px; font-size: 0.75rem; text-decoration: none; }
    .tag:hover { background: #ede9fe; }
  `;

  render() {
    const posts = this.loaderData.posts || [];
    return html`
      <h1>Blog</h1>
      <p class="subtitle">Thoughts and tutorials</p>
      ${posts.map((p: any) => html`
        <div class="post">
          <a href="/posts/${p.slug}">${p.title}</a>
          <div class="meta">${p.date}</div>
          <p class="excerpt">${p.excerpt}</p>
          <div class="tags">
            ${p.tags?.map((tag: string) => html`
              <a class="tag" href="/tag/${tag}">${tag}</a>
            `)}
          </div>
        </div>
      `)}
    `;
  }
}
