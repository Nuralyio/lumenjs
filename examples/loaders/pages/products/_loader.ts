// --- Co-located loader ---
// Place _loader.ts next to index.ts in a folder route.
// Auto-discovered by LumenJS — no import needed in the page.
// Only works for folder routes (index.ts), not flat pages.

const PRODUCTS = [
  { id: 1, name: 'Keyboard', price: 129 },
  { id: 2, name: 'Monitor', price: 399 },
  { id: 3, name: 'Headphones', price: 79 },
];

export async function loader() {
  return { products: PRODUCTS };
}
