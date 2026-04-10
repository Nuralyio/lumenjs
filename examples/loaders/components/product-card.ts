import { LitElement, html, css } from 'lit';
import { theme, card } from '../styles/shared.js';

// --- Child component ---
// Regular Lit component — no loader.
// Receives data from the parent page via properties.

export class ProductCard extends LitElement {
  static properties = {
    name: { type: String },
    price: { type: Number },
    productId: { type: Number },
  };

  name = '';
  price = 0;
  productId = 0;

  static styles = [theme, card, css`
    :host { display: block; }
    .name a {
      font-weight: 600;
      font-size: 0.9375rem;
      color: var(--text);
      text-decoration: none;
    }
    .name a:hover { color: var(--accent); }
    .price { color: var(--accent); font-weight: 700; margin-top: 0.375rem; }
  `];

  render() {
    return html`
      <div class="card">
        <div class="name"><a href="/products/${this.productId}">${this.name}</a></div>
        <div class="price">$${this.price}</div>
      </div>
    `;
  }
}

if (!customElements.get('product-card')) {
  customElements.define('product-card', ProductCard);
}
