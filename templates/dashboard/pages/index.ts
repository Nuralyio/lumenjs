import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { useDb } from '@nuraly/lumenjs/db';

export function loader() {
  const db = useDb();
  const stats = db.all('SELECT id, label, value, unit, updated_at FROM stats ORDER BY id');
  return { stats };
}

@customElement('page-dashboard')
export class PageDashboard extends LitElement {
  @property({ type: Object }) data: any;

  static styles = css`
    :host { display: block; max-width: 960px; margin: 0 auto; padding: 2rem; font-family: system-ui, sans-serif; }
    h1 { font-size: 2rem; margin-bottom: 1.5rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem; }
    .card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.5rem; }
    .card .label { font-size: 0.875rem; color: #6b7280; margin-bottom: 0.25rem; }
    .card .value { font-size: 1.75rem; font-weight: 600; color: #111827; }
    .card .unit { font-size: 0.75rem; color: #9ca3af; margin-left: 0.25rem; }
  `;

  render() {
    const stats = this.data?.stats || [];
    return html`
      <h1>Dashboard</h1>
      <div class="grid">
        ${stats.map((stat: any) => html`
          <div class="card">
            <div class="label">${stat.label}</div>
            <div class="value">
              ${stat.value}<span class="unit">${stat.unit}</span>
            </div>
          </div>
        `)}
      </div>
    `;
  }
}
