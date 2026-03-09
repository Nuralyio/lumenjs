import { LitElement, html, css } from 'lit';

export class PageSettings extends LitElement {
  static properties = { name: { type: String } };
  name = '';

  static styles = css`
    :host { display: block; }
    h1 { font-size: 1.5rem; margin-bottom: 1.5rem; }
    .form-group { margin-bottom: 1rem; }
    label { display: block; font-size: 0.875rem; color: #64748b; margin-bottom: 0.375rem; }
    input { width: 100%; max-width: 400px; padding: 0.5rem 0.75rem; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 0.875rem; }
    input:focus { outline: none; border-color: #7c3aed; box-shadow: 0 0 0 2px rgba(124,58,237,0.15); }
    button { background: #7c3aed; color: #fff; border: none; padding: 0.5rem 1.25rem; border-radius: 6px; cursor: pointer; font-size: 0.875rem; }
    button:hover { background: #6d28d9; }
  `;

  render() {
    return html`
      <h1>Settings</h1>
      <div class="form-group">
        <label>Display Name</label>
        <input type="text" placeholder="Enter your name" .value=${this.name}
          @input=${(e: Event) => this.name = (e.target as HTMLInputElement).value} />
      </div>
      <button @click=${() => alert(`Saved: ${this.name}`)}>Save</button>
    `;
  }
}
