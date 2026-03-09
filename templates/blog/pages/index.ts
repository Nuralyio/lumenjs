import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { useDb } from '@nuraly/lumenjs/db';

export function loader() {
  const db = useDb();
  const posts = db.all('SELECT id, title, slug, content, date FROM posts ORDER BY date DESC');
  return { posts };
}

@customElement('page-home')
export class PageHome extends LitElement {
  @property({ type: Object }) data: any;

  static styles = css`
    :host { display: block; max-width: 720px; margin: 0 auto; padding: 2rem; font-family: system-ui, sans-serif; }
    h1 { font-size: 2rem; margin-bottom: 1.5rem; }
    .post { margin-bottom: 1.5rem; padding-bottom: 1.5rem; border-bottom: 1px solid #eee; }
    .post h2 { margin: 0 0 0.25rem; }
    .post a { color: #0066cc; text-decoration: none; }
    .post a:hover { text-decoration: underline; }
    .post .date { color: #666; font-size: 0.875rem; }
    .post p { color: #333; margin: 0.5rem 0 0; }
  `;

  render() {
    const posts = this.data?.posts || [];
    return html`
      <h1>Blog</h1>
      ${posts.map((post: any) => html`
        <div class="post">
          <h2><a href="/posts/${post.slug}">${post.title}</a></h2>
          <span class="date">${post.date}</span>
          <p>${post.content}</p>
        </div>
      `)}
    `;
  }
}
