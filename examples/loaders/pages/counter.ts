import { LitElement, html } from 'lit';

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

  render() {
    return html`
      <h1>Counter (Socket.IO)</h1>
      <p>Count: ${this.count}</p>
      <button @click=${() => (this as any).emit('increment', {})}>+</button>
      <button @click=${() => (this as any).emit('decrement', {})}>-</button>
      <p><small>Open in multiple tabs to see it sync.</small></p>
    `;
  }
}
