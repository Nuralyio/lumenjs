import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { useDb } from '@nuraly/lumenjs/db';

export function loader({ params }: { params: { slug: string } }) {
  const db = useDb();
  const post = db.get('SELECT id, title, slug, content, date FROM posts WHERE slug = ?', params.slug);
  return { post: post || null };
}

@customElement('page-post')
export class PagePost extends LitElement {
  @property({ type: Object }) data: any;

  static styles = css`
    :host { display: block; max-width: 720px; margin: 0 auto; padding: 2rem; font-family: system-ui, sans-serif; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .date { color: #666; font-size: 0.875rem; }
    .content { margin-top: 1rem; line-height: 1.6; color: #333; }
  `;

  render() {
    const post = this.data?.post;
    if (!post) {
      return html`<p>Post not found. <a href="/">Back to blog</a></p>`;
    }
    return html`
      <a href="/">&larr; Back to blog</a>
      <h1>${post.title}</h1>
      <span class="date">${post.date}</span>
      <div class="content">${post.content}</div>
    `;
  }
}
