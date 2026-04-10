import { LitElement, html, css } from 'lit';

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

  static styles = css`
    :host { display: block; }
    h3 { font-size: 1rem; font-weight: 600; margin-bottom: 0.75rem; color: #475569; }
    .list { display: flex; gap: 0.75rem; }
    .item {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 1rem 1.25rem;
      font-size: 0.875rem;
    }
    .item .name { font-weight: 600; }
    .item .price { color: #7c3aed; margin-top: 0.25rem; }
  `;

  render() {
    return html`
      <h3>Featured (component loader)</h3>
      <div class="list">
        ${this.featured.map(p => html`
          <div class="item">
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
