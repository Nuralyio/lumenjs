import { LitElement, html, css } from 'lit';

export async function loader() {
  return { title: 'Welcome to LumenJS' };
}

export class PageIndex extends LitElement {
  static properties = { loaderData: { type: Object } };
  loaderData: any = {};

  static styles = css`
    :host { display: block; max-width: 640px; margin: 0 auto; padding: 2rem; font-family: system-ui; }
    h1 { color: #7c3aed; margin-bottom: 0.5rem; }
    p { color: #64748b; line-height: 1.6; }
    a { color: #7c3aed; }
  `;

  render() {
    return html`
      <h1>${this.loaderData.title}</h1>
      <p>Edit <code>pages/index.ts</code> to get started.</p>
    `;
  }
}
