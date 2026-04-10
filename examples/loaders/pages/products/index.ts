import { LitElement, html, css } from 'lit';
import '../../components/product-card.js';

// --- Page with co-located loader + child component ---
// No loader here — data comes from _loader.ts in the same folder.
// Loader data is passed down to <product-card> via properties.

export class PageProducts extends LitElement {
  static properties = {
    products: { type: Array },
  };

  products: { id: number; name: string; price: number }[] = [];

  static styles = css`
    :host { display: block; }
    h1 { font-size: 1.75rem; font-weight: 700; margin-bottom: 1.25rem; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 0.75rem;
    }
  `;

  render() {
    return html`
      <h1>Products</h1>
      <div class="grid">
        ${this.products.map(p => html`
          <product-card .name=${p.name} .price=${p.price} .productId=${p.id}></product-card>
        `)}
      </div>
    `;
  }
}
