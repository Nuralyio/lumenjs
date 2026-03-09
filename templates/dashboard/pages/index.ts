import { LitElement, html, css } from 'lit';

export async function loader() {
  return {
    stats: [
      { label: 'Users', value: '1,234' },
      { label: 'Revenue', value: '$12,345' },
      { label: 'Orders', value: '567' },
      { label: 'Conversion', value: '3.2%' },
    ],
  };
}

export class PageIndex extends LitElement {
  static properties = { loaderData: { type: Object } };
  loaderData: any = {};

  static styles = css`
    :host { display: block; }
    h1 { font-size: 1.5rem; margin-bottom: 1.5rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem; }
    .card { background: #fff; border-radius: 8px; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .card-label { font-size: 0.875rem; color: #64748b; }
    .card-value { font-size: 1.75rem; font-weight: 700; margin-top: 0.25rem; }
  `;

  render() {
    const stats = this.loaderData.stats || [];
    return html`
      <h1>Overview</h1>
      <div class="grid">
        ${stats.map((s: any) => html`
          <div class="card">
            <div class="card-label">${s.label}</div>
            <div class="card-value">${s.value}</div>
          </div>
        `)}
      </div>
    `;
  }
}
