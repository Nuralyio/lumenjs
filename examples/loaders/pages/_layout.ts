import { LitElement, html } from 'lit';

// --- Layout loader ---
// Layouts can have loaders too. Data is spread as properties
// on the layout element, just like pages.
// Layout loaders run on every navigation — use them for
// shared data (current user, nav items, etc.).

export async function loader() {
  return {
    navItems: [
      { href: '/', label: 'Home + Component Loader' },
      { href: '/products', label: 'Products' },
      { href: '/live', label: 'Live (SSE)' },
      { href: '/counter', label: 'Counter (Socket)' },
    ],
  };
}

export class LayoutRoot extends LitElement {
  static properties = {
    navItems: { type: Array },
  };

  navItems: { href: string; label: string }[] = [];

  render() {
    return html`
      <nav>
        ${this.navItems.map((item, i) => html`${i > 0 ? ' | ' : ''}<a href=${item.href}>${item.label}</a>`)}
      </nav>
      <hr />
      <slot></slot>
    `;
  }
}
