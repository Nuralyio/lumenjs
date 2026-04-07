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

let tick = 0;

export function subscribe({ push }: { push: (data: any) => void }) {
  const interval = setInterval(() => {
    tick++;
    push({
      stats: [
        { label: 'Users', value: (1234 + tick * 3).toLocaleString() },
        { label: 'Revenue', value: '$' + (12345 + tick * 47).toLocaleString() },
        { label: 'Orders', value: (567 + tick).toLocaleString() },
        { label: 'Conversion', value: (3.2 + Math.sin(tick / 5) * 0.5).toFixed(1) + '%' },
      ],
      updatedAt: new Date().toISOString(),
    });
  }, 2000);
  return () => clearInterval(interval);
}

export class PageIndex extends LitElement {
  static properties = {
    stats: { type: Array },
    updatedAt: { type: String },
  };
  stats: any[] = [];
  updatedAt = '';

  static styles = css`
    :host { display: block; }
    h1 { font-size: 1.5rem; margin-bottom: 1.5rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem; }
    .card { background: #fff; border-radius: 8px; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.08); transition: box-shadow 0.2s; }
    .card.live { box-shadow: 0 0 0 2px rgba(124,58,237,0.3), 0 1px 3px rgba(0,0,0,0.08); }
    .card-label { font-size: 0.875rem; color: #64748b; }
    .card-value { font-size: 1.75rem; font-weight: 700; margin-top: 0.25rem; }
    .status { font-size: 0.75rem; color: #94a3b8; margin-top: 1.5rem; }
    .status .dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #22c55e; margin-right: 0.375rem; vertical-align: middle; }
  `;

  render() {
    const stats = this.stats || [];
    const isLive = !!this.updatedAt;
    return html`
      <h1>Overview</h1>
      <div class="grid">
        ${stats.map((s: any) => html`
          <div class="card ${isLive ? 'live' : ''}">
            <div class="card-label">${s.label}</div>
            <div class="card-value">${s.value}</div>
          </div>
        `)}
      </div>
      ${isLive ? html`
        <div class="status">
          <span class="dot"></span>Live — updated ${this.updatedAt ? new Date(this.updatedAt).toLocaleTimeString() : ''}
        </div>
      ` : ''}
    `;
  }
}
