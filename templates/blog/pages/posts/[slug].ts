import { LitElement, html, css } from 'lit';

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
  return post;
}

export class PagePost extends LitElement {
  static properties = { loaderData: { type: Object }, slug: { type: String } };
  loaderData: any = {};
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
    if (this.loaderData.notFound) {
      return html`
        <a class="back" href="/posts">← Back to posts</a>
        <p class="not-found">Post not found.</p>
      `;
    }
    return html`
      <a class="back" href="/">← Back to posts</a>
      <h1>${this.loaderData.title}</h1>
      <div class="date">${this.loaderData.date}</div>
      <p class="content">${this.loaderData.content}</p>
    `;
  }
}
