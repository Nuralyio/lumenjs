import { LitElement, html, css } from 'lit';

export class LayoutRoot extends LitElement {
  static styles = css`
    :host { display: block; min-height: 100vh; font-family: system-ui; color: #1e293b; }
    header { max-width: 720px; margin: 0 auto; padding: 1.5rem 1rem; display: flex; justify-content: space-between; align-items: center; }
    header a { color: #7c3aed; text-decoration: none; font-weight: 600; font-size: 1.125rem; }
    nav a { color: #64748b; text-decoration: none; margin-left: 1.5rem; }
    nav a:hover { color: #7c3aed; }
    main { max-width: 720px; margin: 0 auto; padding: 0 1rem 3rem; }
  `;

  render() {
    return html`
      <header>
        <a href="/">{{PROJECT_NAME}}</a>
        <nav>
          <a href="/">Home</a>
          <a href="/posts">Posts</a>
        </nav>
      </header>
      <main><slot></slot></main>
    `;
  }
}
