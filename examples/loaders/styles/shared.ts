import { css } from 'lit';

export const theme = css`
  :host {
    --font: 'Inter', system-ui, -apple-system, sans-serif;
    --text: #1e293b;
    --text-muted: #64748b;
    --text-subtle: #94a3b8;
    --accent: #7c3aed;
    --bg: #f8fafc;
    --card-bg: #fff;
    --border: #e2e8f0;
    --radius: 10px;
  }
`;

export const heading = css`
  h1 {
    font-size: 1.75rem;
    font-weight: 700;
    margin-bottom: 1.25rem;
  }
`;

export const card = css`
  .card {
    background: var(--card-bg, #fff);
    border: 1px solid var(--border, #e2e8f0);
    border-radius: var(--radius, 10px);
    padding: 1.25rem;
    transition: box-shadow 0.15s;
  }
  .card:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  }
`;

export const backLink = css`
  .back {
    color: var(--accent, #7c3aed);
    text-decoration: none;
    font-size: 0.875rem;
  }
  .back:hover {
    text-decoration: underline;
  }
`;
