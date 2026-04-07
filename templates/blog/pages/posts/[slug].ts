import { LitElement, html, css } from 'lit';

function estimateReadingTime(text: string): number {
  const wordsPerMinute = 200;
  const words = text.trim().split(/\s+/).length;
  return Math.max(1, Math.ceil(words / wordsPerMinute));
}

const POSTS: Record<string, { title: string; date: string; content: string }> = {
  'hello-world': {
    title: 'Hello World',
    date: '2025-01-15',
    content: 'Welcome to my blog! This is a sample post built with LumenJS. Each post is a dynamic route using the [slug] parameter.',
  },
  'getting-started': {
    title: 'Getting Started with LumenJS',
    date: '2025-01-20',
    content: 'LumenJS uses file-based routing with Lit web components. Create a file in pages/ and it becomes a route. Add a loader() function for server-side data fetching.',
  },
};

export async function loader({ params }: { params: { slug: string } }) {
  const post = POSTS[params.slug];
  if (!post) return { notFound: true };
  return {
    ...post,
    readingTime: estimateReadingTime(post.content),
  };
}

export class PagePost extends LitElement {
  static properties = {
    title: { type: String },
    date: { type: String },
    content: { type: String },
    readingTime: { type: Number },
    notFound: { type: Boolean },
    slug: { type: String },
  };
  title = '';
  date = '';
  content = '';
  readingTime = 0;
  notFound = false;
  slug = '';

  static styles = css`
    :host { display: block; }
    .back { color: #7c3aed; text-decoration: none; font-size: 0.875rem; }
    .back:hover { text-decoration: underline; }
    h1 { font-size: 2rem; margin: 1rem 0 0.25rem; }
    .date { color: #94a3b8; font-size: 0.875rem; margin-bottom: 1.5rem; }
    .content { line-height: 1.8; color: #334155; }
    .not-found { color: #64748b; }
  `;

  render() {
    if (this.notFound) {
      return html`
        <a class="back" href="/posts">← Back to posts</a>
        <p class="not-found">Post not found.</p>
      `;
    }
    return html`
      <a class="back" href="/">← Back to posts</a>
      <h1>${this.title}</h1>
      <div class="date">${this.date} · ${this.readingTime} min read</div>
      <p class="content">${this.content}</p>
    `;
  }
}
