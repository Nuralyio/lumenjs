import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the router-data module
vi.mock('./router-data.js', () => ({
  fetchComponentLoaderData: vi.fn(),
}));

import { fetchComponentLoaderData } from './router-data.js';
import { __nk_setupComponentLoader } from './component-loader.js';

const mockFetch = vi.mocked(fetchComponentLoaderData);

// Minimal HTMLElement shim for Node tests
class MockHTMLElement {
  connectedCallback() {}
}
(globalThis as any).HTMLElement = (globalThis as any).HTMLElement || MockHTMLElement;

beforeEach(() => {
  mockFetch.mockReset();
});

describe('__nk_setupComponentLoader', () => {
  it('patches connectedCallback to fetch loader data', () => {
    mockFetch.mockResolvedValue({ name: 'Alice' });

    class MyComp extends HTMLElement {
      connectedCallback() {}
    }
    __nk_setupComponentLoader(MyComp, 'components/my-comp.ts');

    const el = new MyComp();
    el.connectedCallback();

    expect(mockFetch).toHaveBeenCalledWith('components/my-comp.ts');
  });

  it('spreads loader data as individual properties', async () => {
    mockFetch.mockResolvedValue({ name: 'Alice', count: 42 });

    class MyComp extends HTMLElement {
      connectedCallback() {}
    }
    __nk_setupComponentLoader(MyComp, 'components/test.ts');

    const el = new MyComp() as any;
    el.connectedCallback();

    await vi.waitFor(() => {
      expect(el.name).toBe('Alice');
      expect(el.count).toBe(42);
    });
  });

  it('calls requestUpdate after setting data', async () => {
    mockFetch.mockResolvedValue({ items: [] });

    const requestUpdate = vi.fn();
    class MyComp extends HTMLElement {
      requestUpdate = requestUpdate;
      connectedCallback() {}
    }
    __nk_setupComponentLoader(MyComp, 'components/test.ts');

    const el = new MyComp();
    el.connectedCallback();

    await vi.waitFor(() => {
      expect(requestUpdate).toHaveBeenCalled();
    });
  });

  it('skips fetch when loaderData is already set (SSR hydration)', () => {
    mockFetch.mockResolvedValue({ x: 1 });

    class MyComp extends HTMLElement {
      connectedCallback() {}
    }
    __nk_setupComponentLoader(MyComp, 'components/test.ts');

    const el = new MyComp() as any;
    el.loaderData = { y: 2 };
    el.connectedCallback();

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not fetch twice on multiple connectedCallback calls', () => {
    mockFetch.mockResolvedValue({ ok: true });

    class MyComp extends HTMLElement {
      connectedCallback() {}
    }
    __nk_setupComponentLoader(MyComp, 'components/test.ts');

    const el = new MyComp();
    el.connectedCallback();
    el.connectedCallback();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('does not spread blocked keys', async () => {
    mockFetch.mockResolvedValue({
      name: 'ok',
      constructor: 'bad',
      render: 'bad',
      innerHTML: '<script>evil</script>',
    });

    class MyComp extends HTMLElement {
      connectedCallback() {}
    }
    __nk_setupComponentLoader(MyComp, 'components/test.ts');

    const el = new MyComp() as any;
    el.connectedCallback();

    await vi.waitFor(() => {
      expect(el.name).toBe('ok');
    });

    expect(typeof el.constructor).toBe('function');
    expect(el.render).not.toBe('bad');
    expect(el.innerHTML).not.toBe('<script>evil</script>');
  });

  it('handles fetch returning undefined gracefully', async () => {
    mockFetch.mockResolvedValue(undefined);

    const requestUpdate = vi.fn();
    class MyComp extends HTMLElement {
      requestUpdate = requestUpdate;
      connectedCallback() {}
    }
    __nk_setupComponentLoader(MyComp, 'components/test.ts');

    const el = new MyComp();
    el.connectedCallback();

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    expect(requestUpdate).not.toHaveBeenCalled();
  });

  it('preserves the original connectedCallback', () => {
    mockFetch.mockResolvedValue(undefined);
    const baseCb = vi.fn();

    class MyComp extends HTMLElement {
      connectedCallback() { baseCb(); }
    }
    __nk_setupComponentLoader(MyComp, 'components/test.ts');

    const el = new MyComp();
    el.connectedCallback();

    expect(baseCb).toHaveBeenCalled();
  });

  it('works on different instances independently', () => {
    mockFetch.mockResolvedValue({ val: 1 });

    class MyComp extends HTMLElement {
      connectedCallback() {}
    }
    __nk_setupComponentLoader(MyComp, 'components/test.ts');

    const el1 = new MyComp();
    const el2 = new MyComp();

    el1.connectedCallback();
    el2.connectedCallback();

    // Each instance triggers its own fetch
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
