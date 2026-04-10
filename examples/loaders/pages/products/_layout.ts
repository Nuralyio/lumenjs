import { LitElement, html } from 'lit';

// --- Nested layout loader ---
// A _layout.ts in a subdirectory wraps all pages in that folder.
// Its loader runs in addition to the parent layout loader.
// Use it for section-specific shared data.

export async function loader() {
  return {
    totalProducts: 6,
  };
}

export class LayoutProducts extends LitElement {
  static properties = {
    totalProducts: { type: Number },
  };

  totalProducts = 0;

  render() {
    return html`
      <p>Product catalog (${this.totalProducts} items)</p>
      <slot></slot>
    `;
  }
}
