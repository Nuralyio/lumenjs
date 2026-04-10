import { LitElement, html, css } from 'lit';
import '../components/featured-products.js';

// --- Inline page loader ---
// Export loader() in the same file as the page component.
// Each returned key becomes a property on the element.

export async function loader() {
  return {
    message: 'LumenJS Loaders',
    items: [
      { label: 'Inline loader', desc: 'loader() in the page file' },
      { label: 'Co-located _loader.ts', desc: 'Separate file, auto-discovered' },
      { label: 'Layout loader', desc: 'Shared data for all child pages' },
      { label: 'Component loader', desc: 'Component fetches its own data' },
      { label: 'Subscribe (SSE)', desc: 'Server pushes live updates' },
      { label: 'Socket (Socket.IO)', desc: 'Bidirectional real-time' },
    ],
  };
}

export class PageIndex extends LitElement {
  static properties = {
    message: { type: String },
    items: { type: Array },
  };

  message = '';
  items: { label: string; desc: string }[] = [];

  static styles = css`
    :host { display: block; }
    h1 { font-size: 1.75rem; font-weight: 700; margin-bottom: 0.5rem; }
    .subtitle { color: #64748b; margin-bottom: 2rem; font-size: 0.9375rem; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 0.75rem;
      margin-bottom: 2.5rem;
    }
    .card {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 1.25rem;
    }
    .card strong { display: block; font-size: 0.875rem; margin-bottom: 0.25rem; }
    .card span { font-size: 0.8125rem; color: #64748b; }
  `;

  render() {
    return html`
      <h1>${this.message}</h1>
      <p class="subtitle">Every data-fetching pattern in one example project.</p>
      <div class="grid">
        ${this.items.map(i => html`
          <div class="card">
            <strong>${i.label}</strong>
            <span>${i.desc}</span>
          </div>
        `)}
      </div>

      <!-- This component fetches its own data via its own loader -->
      <featured-products></featured-products>
    `;
  }
}
