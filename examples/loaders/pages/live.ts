import { LitElement, html, css } from 'lit';

// --- Subscribe (SSE) ---
// Server pushes data to the client via Server-Sent Events.
// Each key from push() becomes a property on the element.
// Return a cleanup function to stop when the client disconnects.

let tick = 0;

export function subscribe({ push }: { push: (data: any) => void }) {
  const id = setInterval(() => {
    tick++;
    push({
      time: new Date().toISOString(),
      tick,
    });
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

  static styles = css`
    :host { display: block; }
    h1 { font-size: 1.75rem; font-weight: 700; margin-bottom: 1.25rem; }
    .card {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 1.5rem;
      display: inline-flex;
      flex-direction: column;
      gap: 0.75rem;
      min-width: 280px;
    }
    .row { display: flex; justify-content: space-between; font-size: 0.9375rem; }
    .label { color: #64748b; }
    .value { font-weight: 600; font-variant-numeric: tabular-nums; }
    .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #22c55e; margin-right: 0.5rem; vertical-align: middle; }
    .waiting { color: #94a3b8; }
  `;

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
