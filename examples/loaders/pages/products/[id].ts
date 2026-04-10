import { LitElement, html, css } from 'lit';
import { theme, heading, backLink } from '../../styles/shared.js';

// --- Dynamic route params ---
// File: pages/products/[id].ts → URL: /products/:id
// params.id is available in the loader.

const PRODUCTS: Record<string, { name: string; price: number }> = {
  '1': { name: 'Keyboard', price: 129 },
  '2': { name: 'Monitor', price: 399 },
  '3': { name: 'Headphones', price: 79 },
};

export async function loader({ params }: { params: { id: string } }) {
  const product = PRODUCTS[params.id];
  if (!product) return { notFound: true };
  return { ...product, id: params.id };
}

export class PageProductDetail extends LitElement {
  static properties = {
    id: { type: String },
    name: { type: String },
    price: { type: Number },
    notFound: { type: Boolean },
  };

  id = '';
  name = '';
  price = 0;
  notFound = false;

  static styles = [theme, heading, backLink, css`
    :host { display: block; }
    h1 { margin-top: 1rem; }
    .price { font-size: 1.5rem; font-weight: 700; color: var(--accent); }
    .not-found { color: var(--text-muted); margin-top: 1rem; }
  `];

  render() {
    if (this.notFound) {
      return html`
        <a class="back" href="/products">&larr; Back</a>
        <p class="not-found">Product not found.</p>
      `;
    }
    return html`
      <a class="back" href="/products">&larr; Back</a>
      <h1>${this.name}</h1>
      <p class="price">$${this.price}</p>
    `;
  }
}
