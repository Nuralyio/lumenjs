import { LitElement, html, css } from 'lit';

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

  static styles = css`
    :host { display: block; }
    .back { color: #7c3aed; text-decoration: none; font-size: 0.875rem; }
    .back:hover { text-decoration: underline; }
    h1 { font-size: 1.75rem; font-weight: 700; margin: 1rem 0 0.5rem; }
    .price { font-size: 1.5rem; font-weight: 700; color: #7c3aed; }
    .not-found { color: #64748b; margin-top: 1rem; }
  `;

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
