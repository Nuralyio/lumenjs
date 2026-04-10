import { LitElement, html, css } from 'lit';
import { theme, heading, card } from '../styles/shared.js';

// --- Subscribe (SSE) ---
// Server pushes data to the client via Server-Sent Events.
// Each key from push() becomes a property on the element.
// Return a cleanup function to stop when the client disconnects.

let tick = 0;

export function subscribe({ push }: { push: (data: any) => void }) {
  const id = setInterval(() => {
    tick++;
    push({ time: new Date().toISOString(), tick });
  }, 1000);
  return () => clearInterval(id);
}

export class PageLive extends LitElement {
  static properties = {
    time: { type: String },
    tick: { type: Number },
  };

  time = '';
  tick = 0;

  static styles = [theme, heading, card, css`
    :host { display: block; }
    .card { display: inline-flex; flex-direction: column; gap: 0.75rem; min-width: 280px; padding: 1.5rem; }
    .row { display: flex; justify-content: space-between; font-size: 0.9375rem; }
    .label { color: var(--text-muted); }
    .value { font-weight: 600; font-variant-numeric: tabular-nums; }
    .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #22c55e; margin-right: 0.5rem; vertical-align: middle; }
    .waiting { color: var(--text-subtle); }
  `];

  render() {
    if (!this.time) return html`<h1>Live (SSE)</h1><p class="waiting">Connecting...</p>`;
    return html`
      <h1>Live (SSE)</h1>
      <div class="card">
        <div class="row">
          <span class="label"><span class="dot"></span>Server time</span>
          <span class="value">${new Date(this.time).toLocaleTimeString()}</span>
        </div>
        <div class="row">
          <span class="label">Ticks</span>
          <span class="value">${this.tick}</span>
        </div>
      </div>
    `;
  }
}
