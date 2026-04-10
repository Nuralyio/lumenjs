import { LitElement, html } from 'lit';

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

  render() {
    if (!this.time) return html`<p>Connecting...</p>`;
    return html`
      <h1>Live (SSE)</h1>
      <p>Server time: ${new Date(this.time).toLocaleTimeString()}</p>
      <p>Ticks: ${this.tick}</p>
    `;
  }
}
