import { css } from 'lit';

export const layoutStyles = css`
  :host {
    display: block;
    min-height: 100vh;
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    color: #1e293b;
    background: #f8fafc;
  }
  nav {
    display: flex;
    gap: 0.25rem;
    padding: 1rem 2rem;
    background: #fff;
    border-bottom: 1px solid #e2e8f0;
    position: sticky;
    top: 0;
    z-index: 10;
  }
  nav a {
    padding: 0.5rem 1rem;
    border-radius: 8px;
    text-decoration: none;
    font-size: 0.875rem;
    font-weight: 500;
    color: #64748b;
    transition: all 0.15s;
  }
  nav a:hover {
    background: #f1f5f9;
    color: #0f172a;
  }
  .content {
    max-width: 860px;
    margin: 0 auto;
    padding: 2.5rem 2rem;
  }
`;
