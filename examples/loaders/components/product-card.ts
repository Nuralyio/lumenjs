import { LitElement, html } from 'lit';

// --- Child component ---
// Regular Lit component — no loader.
// Receives data from the parent page via properties.
//
// Files in _components/ get auto-defined with a generated name
// (e.g. page-_components-product-card), so we register manually
// to use a clean tag name.

export class ProductCard extends LitElement {
  static properties = {
    name: { type: String },
    price: { type: Number },
    productId: { type: Number },
  };

  name = '';
  price = 0;
  productId = 0;

  render() {
    return html`
      <div>
        <a href="/products/${this.productId}">${this.name}</a> — $${this.price}
      </div>
    `;
  }
}

if (!customElements.get('product-card')) {
  customElements.define('product-card', ProductCard);
}
