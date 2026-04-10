import { LitElement, html, css } from 'lit';

// --- Nested layout loader ---
// A _layout.ts in a subdirectory wraps all pages in that folder.
// Its loader runs in addition to the parent layout loader.

export async function loader() {
  return { totalProducts: 6 };
}

export class LayoutProducts extends LitElement {
  static properties = {
    totalProducts: { type: Number },
  };

  totalProducts = 0;

  static styles = css`
    :host { display: block; }
    .header { color: #64748b; font-size: 0.8125rem; margin-bottom: 1.5rem; }
  `;

  render() {
    return html`
      <p class="header">${this.totalProducts} items in catalog</p>
      <slot></slot>
    `;
  }
}
