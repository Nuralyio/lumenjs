import { LitElement, html } from 'lit';

export class LayoutRoot extends LitElement {
  render() {
    return html`
      <nav>
        <a href="/">Home</a> |
        <a href="/products">Products</a> |
        <a href="/live">Live (SSE)</a> |
        <a href="/counter">Counter (Socket)</a>
      </nav>
      <hr />
      <slot></slot>
    `;
  }
}
