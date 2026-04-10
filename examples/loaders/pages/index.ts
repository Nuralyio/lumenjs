import { LitElement, html } from 'lit';

// --- Inline loader ---
// Export loader() in the same file as the page component.
// Each returned key becomes a property on the element.

export async function loader() {
  return {
    message: 'Hello from the inline loader',
    items: ['Alpha', 'Bravo', 'Charlie'],
  };
}

export class PageIndex extends LitElement {
  static properties = {
    message: { type: String },
    items: { type: Array },
  };

  message = '';
  items: string[] = [];

  render() {
    return html`
      <h1>${this.message}</h1>
      <ul>${this.items.map(i => html`<li>${i}</li>`)}</ul>
    `;
  }
}
