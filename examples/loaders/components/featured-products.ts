import { LitElement, html, css } from 'lit';
import { theme, card } from '../styles/shared.js';

// --- Component-level loader ---
// Any component outside pages/ can export a loader().
// LumenJS auto-wires it: the loader runs server-side,
// and data is fetched + spread as properties on connectedCallback.
// No prop-passing from the parent needed — the component is self-contained.

export async function loader() {
  return {
    featured: [
      { name: 'Keyboard', price: 129 },
      { name: 'Monitor', price: 399 },
    ],
  };
}

export class FeaturedProducts extends LitElement {
  static properties = {
    featured: { type: Array },
  };

  featured: { name: string; price: number }[] = [];

  static styles = [theme, card, css`
    :host { display: block; }
    h3 { font-size: 1rem; font-weight: 600; margin-bottom: 0.75rem; color: var(--text-muted); }
    .list { display: flex; gap: 0.75rem; }
    .card .name { font-weight: 600; }
    .card .price { color: var(--accent); margin-top: 0.25rem; }
  `];

  render() {
    return html`
      <h3>Featured (component loader)</h3>
      <div class="list">
        ${this.featured.map(p => html`
          <div class="card">
            <div class="name">${p.name}</div>
            <div class="price">$${p.price}</div>
          </div>
        `)}
      </div>
    `;
  }
}

if (!customElements.get('featured-products')) {
  customElements.define('featured-products', FeaturedProducts);
}
