import { routes } from 'virtual:lumenjs-routes';
import { NkRouter } from './router.js';

/**
 * <nk-app> — The application shell. Sets up the router and renders pages.
 */
class NkApp extends HTMLElement {
  private router: NkRouter | null = null;

  connectedCallback() {
    const isSSR = this.hasAttribute('data-nk-ssr');
    if (!isSSR) {
      this.innerHTML = '<div id="nk-router-outlet"></div>';
    }
    const outlet = this.querySelector('#nk-router-outlet') as HTMLElement;
    this.router = new NkRouter(routes, outlet, isSSR);
  }
}

if (!customElements.get('nk-app')) {
  customElements.define('nk-app', NkApp);
}
