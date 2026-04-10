import { LitElement, html } from 'lit';

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

  render() {
    if (this.notFound) return html`<p>Not found.</p>`;
    return html`
      <a href="/products">&larr; Back</a>
      <h1>${this.name}</h1>
      <p>$${this.price}</p>
    `;
  }
}
