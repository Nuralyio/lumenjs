import { LitElement, html, css } from 'lit';

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

  static styles = css`
    :host { display: block; }
    .card {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 1.25rem;
      transition: box-shadow 0.15s;
    }
    .card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
    .name a {
      font-weight: 600;
      font-size: 0.9375rem;
      color: #0f172a;
      text-decoration: none;
    }
    .name a:hover { color: #7c3aed; }
    .price { color: #7c3aed; font-weight: 700; margin-top: 0.375rem; }
  `;

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
