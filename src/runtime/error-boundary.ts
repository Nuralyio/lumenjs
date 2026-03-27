/**
 * <nk-error-boundary> — Client-side error boundary for Lit/web component pages.
 *
 * Wraps page content via <slot>. If a child throws during render or in an
 * event handler, catches the error and displays a fallback UI.
 *
 * Usage:
 *   <nk-error-boundary>
 *     <my-page></my-page>
 *   </nk-error-boundary>
 *
 * Attributes:
 *   fallback-message — Custom message shown on error (default: "Something went wrong")
 */
class NkErrorBoundary extends HTMLElement {
  private hasError = false;
  private caughtError: Error | null = null;

  connectedCallback() {
    // Listen for unhandled errors from slotted children
    this.addEventListener('error', this.handleError as EventListener);

    // Create a slot for normal content
    if (!this.shadowRoot) {
      const shadow = this.attachShadow({ mode: 'open' });
      shadow.innerHTML = `
        <style>
          :host { display: contents; }
          .nk-error-fallback {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 2rem;
            min-height: 200px;
            font-family: system-ui, -apple-system, sans-serif;
            color: #dc2626;
            text-align: center;
          }
          .nk-error-fallback h2 {
            margin: 0 0 0.5rem;
            font-size: 1.25rem;
            font-weight: 600;
          }
          .nk-error-fallback p {
            margin: 0 0 1rem;
            color: #6b7280;
            font-size: 0.875rem;
          }
          .nk-error-fallback button {
            padding: 0.5rem 1rem;
            border: 1px solid #d1d5db;
            border-radius: 0.375rem;
            background: white;
            color: #374151;
            font-size: 0.875rem;
            cursor: pointer;
          }
          .nk-error-fallback button:hover {
            background: #f9fafb;
          }
          .nk-error-hidden { display: none; }
        </style>
        <slot></slot>
        <div class="nk-error-fallback nk-error-hidden">
          <h2></h2>
          <p></p>
          <button>Try again</button>
        </div>
      `;

      const button = shadow.querySelector('button')!;
      button.addEventListener('click', () => this.recover());
    }
  }

  disconnectedCallback() {
    this.removeEventListener('error', this.handleError as EventListener);
  }

  private handleError = (event: ErrorEvent) => {
    event.stopPropagation();
    this.showFallback(event.error || new Error(event.message));
  };

  private showFallback(error: Error) {
    this.hasError = true;
    this.caughtError = error;

    const shadow = this.shadowRoot;
    if (!shadow) return;

    const slot = shadow.querySelector('slot')!;
    const fallback = shadow.querySelector('.nk-error-fallback') as HTMLElement;
    const message = this.getAttribute('fallback-message') || 'Something went wrong';

    slot.classList.add('nk-error-hidden');
    fallback.classList.remove('nk-error-hidden');
    fallback.querySelector('h2')!.textContent = message;
    fallback.querySelector('p')!.textContent = error.message || 'An unexpected error occurred.';

    // Dispatch custom event for external error tracking
    this.dispatchEvent(new CustomEvent('nk-error', {
      bubbles: true,
      composed: true,
      detail: { error },
    }));
  }

  private recover() {
    this.hasError = false;
    this.caughtError = null;

    const shadow = this.shadowRoot;
    if (!shadow) return;

    const slot = shadow.querySelector('slot')!;
    const fallback = shadow.querySelector('.nk-error-fallback') as HTMLElement;

    fallback.classList.add('nk-error-hidden');
    slot.classList.remove('nk-error-hidden');

    // Re-trigger the current route to re-render
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
}

if (!customElements.get('nk-error-boundary')) {
  customElements.define('nk-error-boundary', NkErrorBoundary);
}
