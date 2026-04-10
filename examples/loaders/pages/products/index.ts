import { LitElement, html } from 'lit';
import '../../components/product-card.js';

// --- Page with co-located loader + child component ---
// No loader here — data comes from _loader.ts in the same folder.
// Loader data is passed down to <product-card> via properties.

export class PageProducts extends LitElement {
  static properties = {
    products: { type: Array },
  };

  products: { id: number; name: string; price: number }[] = [];

  render() {
    return html`
      <h1>Products</h1>
      ${this.products.map(p => html`
        <product-card .name=${p.name} .price=${p.price} .productId=${p.id}></product-card>
      `)}
    `;
  }
}
