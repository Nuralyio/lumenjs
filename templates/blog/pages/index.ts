import { LitElement, html, css } from 'lit';

function estimateReadingTime(text: string): number {
  const wordsPerMinute = 200;
  const words = text.trim().split(/\s+/).length;
  return Math.max(1, Math.ceil(words / wordsPerMinute));
}

const POSTS = [
  {
    slug: 'hello-world',
    title: 'Hello World',
    date: '2025-01-15',
    excerpt: 'Welcome to my blog built with LumenJS.',
    content: 'Welcome to my blog! This is a sample post built with LumenJS. Each post is a dynamic route using the [slug] parameter.',
  },
  {
    slug: 'getting-started',
    title: 'Getting Started with LumenJS',
    date: '2025-01-20',
    excerpt: 'Learn how to build web apps with Lit components and file-based routing.',
    content: 'LumenJS uses file-based routing with Lit web components. Create a file in pages/ and it becomes a route. Add a loader() function for server-side data fetching.',
  },
];

export async function loader() {
  return {
    posts: POSTS.map(({ content, ...post }) => ({
      ...post,
      readingTime: estimateReadingTime(content),
    })),
  };
}

export class PageIndex extends LitElement {
  static properties = { posts: { type: Array } };
  posts: any[] = [];

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
  `;

  render() {
    const posts = this.posts || [];
    return html`
      <h1>Blog</h1>
      <p class="subtitle">Thoughts and tutorials</p>
      ${posts.map((p: any) => html`
        <div class="post">
          <a href="/posts/${p.slug}">${p.title}</a>
          <div class="meta">${p.date} · ${p.readingTime} min read</div>
          <p class="excerpt">${p.excerpt}</p>
        </div>
      `)}
    `;
  }
}
