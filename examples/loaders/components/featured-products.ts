import { LitElement, html } from 'lit';

// --- Component-level loader ---
// Any component outside pages/ can export a loader().
// LumenJS auto-wires it: the loader runs server-side,
// and data is fetched + spread as properties on connectedCallback.
// No prop-passing from the parent needed — the component is self-contained.

export async function loader() {
  return {
    featured: [
      { name: 'Keyboard', price: 129 },
      { name: 'Monitor', price: 399 },
    ],
  };
}

export class FeaturedProducts extends LitElement {
  static properties = {
    featured: { type: Array },
  };

  featured: { name: string; price: number }[] = [];

  render() {
    return html`
      <h3>Featured (loaded by the component itself)</h3>
      <ul>${this.featured.map(p => html`<li>${p.name} — $${p.price}</li>`)}</ul>
    `;
  }
}
