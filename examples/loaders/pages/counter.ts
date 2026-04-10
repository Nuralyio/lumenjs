import { LitElement, html, css } from 'lit';
import { theme, heading, card } from '../styles/shared.js';

// --- Socket (Socket.IO) ---
// Bidirectional: server listens with on(), client sends with this.emit().
// push() spreads keys as properties (same as loader/subscribe).
// room.broadcast() sends to all other clients in the room.
// Return a cleanup function for disconnect.

const state = { count: 0 };

export function loader() { return {}; }

export function socket({ on, push, room }: { on: Function; push: Function; room: any }) {
  room.join('counter');
  push({ count: state.count });

  on('increment', () => {
    state.count++;
    push({ count: state.count });
    room.broadcast('counter', { count: state.count });
  });

  on('decrement', () => {
    state.count--;
    push({ count: state.count });
    room.broadcast('counter', { count: state.count });
  });

  return () => room.leave('counter');
}

export class PageCounter extends LitElement {
  static properties = {
    count: { type: Number },
  };

  count = 0;

  static styles = [theme, heading, card, css`
    :host { display: block; }
    .card { display: inline-flex; align-items: center; gap: 1.5rem; padding: 2rem; }
    .count { font-size: 3rem; font-weight: 700; min-width: 80px; text-align: center; font-variant-numeric: tabular-nums; }
    .actions { display: flex; flex-direction: column; gap: 0.5rem; }
    button {
      padding: 0.5rem 1.25rem;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--card-bg);
      font-size: 0.9375rem;
      font-weight: 500;
      cursor: pointer;
      font-family: inherit;
      transition: all 0.15s;
    }
    button:hover { background: var(--bg); }
    button:active { transform: scale(0.97); }
    .plus { border-color: var(--accent); color: var(--accent); }
    .plus:hover { background: #f5f3ff; }
    .minus { border-color: #ef4444; color: #ef4444; }
    .minus:hover { background: #fef2f2; }
    .hint { color: var(--text-subtle); font-size: 0.8125rem; margin-top: 1rem; }
  `];

  render() {
    return html`
      <h1>Counter (Socket.IO)</h1>
      <div class="card">
        <div class="count">${this.count}</div>
        <div class="actions">
          <button class="plus" @click=${() => (this as any).emit('increment', {})}>+ Increment</button>
          <button class="minus" @click=${() => (this as any).emit('decrement', {})}>- Decrement</button>
        </div>
      </div>
      <p class="hint">Open in multiple tabs to see it sync.</p>
    `;
  }
}
