import { LitElement, html, css } from 'lit';

export class LayoutRoot extends LitElement {
  static styles = css`
    :host { display: flex; min-height: 100vh; font-family: system-ui; color: #1e293b; }
    aside { width: 240px; background: #0f172a; color: #cbd5e1; padding: 1.5rem 0; flex-shrink: 0; }
    .logo { padding: 0 1.25rem 1.5rem; font-weight: 700; font-size: 1.125rem; color: #fff; }
    nav a { display: block; padding: 0.625rem 1.25rem; color: #94a3b8; text-decoration: none; font-size: 0.875rem; }
    nav a:hover { background: #1e293b; color: #fff; }
    main { flex: 1; background: #f8fafc; padding: 2rem; }
  `;

  render() {
    return html`
      <aside>
        <div class="logo">{{PROJECT_NAME}}</div>
        <nav>
          <a href="/">Overview</a>
          <a href="/settings">Settings</a>
        </nav>
      </aside>
      <main><slot></slot></main>
    `;
  }
}
