/**
 * Element Annotator — adds `data-nk-source` attributes to rendered Lit elements.
 *
 * In editor mode, this module observes the DOM for custom elements (those with a tag
 * containing a hyphen) and annotates them with source file and line info so the
 * editor bridge can map clicks back to source code.
 *
 * Source mapping relies on the `data-nk-source` attribute format: "file:line"
 * This attribute is injected by a Vite transform or manually by the framework.
 */

let annotatorActive = false;

interface SourceInfo {
  file: string;
  line: number;
  tag: string;
}

/**
 * Parse a data-nk-source attribute value. Format: "file:line"
 */
export function parseSourceAttr(value: string): SourceInfo | null {
  const lastColon = value.lastIndexOf(':');
  if (lastColon === -1) return null;
  const file = value.substring(0, lastColon);
  const line = parseInt(value.substring(lastColon + 1), 10);
  if (isNaN(line)) return null;
  return { file, line, tag: '' };
}

/**
 * Find the closest element with a data-nk-source attribute from an event.
 * Traverses composed path for Shadow DOM support.
 */
export function findAnnotatedElement(event: Event): { element: HTMLElement; source: SourceInfo } | null {
  const composedPath = event.composedPath();

  for (const node of composedPath) {
    if (!(node instanceof HTMLElement)) continue;
    const sourceAttr = node.getAttribute('data-nk-source');
    if (sourceAttr) {
      const source = parseSourceAttr(sourceAttr);
      if (source) {
        source.tag = node.tagName.toLowerCase();
        return { element: node, source };
      }
    }
  }
  return null;
}

/**
 * Start observing the DOM and annotate custom elements with sequential IDs.
 * This helps the editor uniquely identify elements for AST modifications.
 */
export function startAnnotator() {
  if (annotatorActive) return;
  annotatorActive = true;

  let idCounter = 0;

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement) {
          annotateTree(node);
        }
      }
    }
  });

  function annotateTree(root: HTMLElement) {
    // Annotate the root if it's a custom element without an ID
    if (root.tagName.includes('-') && !root.hasAttribute('data-nk-id')) {
      root.setAttribute('data-nk-id', `nk-${idCounter++}`);
    }
    // Walk children
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let current = walker.nextNode();
    while (current) {
      const el = current as HTMLElement;
      if (el.tagName.includes('-') && !el.hasAttribute('data-nk-id')) {
        el.setAttribute('data-nk-id', `nk-${idCounter++}`);
      }
      current = walker.nextNode();
    }
  }

  // Annotate existing elements
  annotateTree(document.body);

  // Watch for new elements
  observer.observe(document.body, { childList: true, subtree: true });
}
