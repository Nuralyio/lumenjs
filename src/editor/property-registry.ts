/**
 * Property Registry — static enum registry + runtime property discovery
 * for the right-side properties panel.
 */

export interface PropertyInfo {
  name: string;
  attrName: string;
  type: 'Boolean' | 'String' | 'Number' | 'Array' | 'Object';
  value: unknown;
  enumValues?: string[];
}

/** Enum values for nr-* components, extracted from *.types.ts files */
const PROPERTY_ENUMS: Record<string, Record<string, string[]>> = {
  'nr-button': {
    type: ['primary', 'secondary', 'danger', 'ghost', 'default'],
    size: ['small', 'medium', 'large'],
    shape: ['default', 'circle', 'round'],
    iconPosition: ['left', 'right'],
  },
  'nr-input': {
    state: ['default', 'error', 'warning', 'success'],
    size: ['large', 'medium', 'small'],
    variant: ['outlined', 'filled', 'borderless', 'underlined'],
    type: ['password', 'text', 'number', 'email', 'url', 'tel', 'search', 'calendar'],
  },
  'nr-select': {
    state: ['error', 'warning', 'success'],
    type: ['default', 'inline', 'button', 'slot'],
    status: ['default', 'warning', 'error', 'success'],
    size: ['small', 'medium', 'large'],
    direction: ['horizontal', 'vertical'],
    variant: ['default', 'solid', 'outline', 'borderless'],
    placement: ['bottom', 'top', 'auto'],
    searchMode: ['none', 'starts-with', 'contains', 'fuzzy'],
  },
  'nr-card': {
    size: ['small', 'default', 'large'],
  },
  'nr-tabs': {
    orientation: ['horizontal', 'vertical'],
    align: ['right', 'left', 'center', 'stretch'],
    size: ['small', 'medium', 'large'],
    type: ['default', 'card', 'line', 'bordered'],
  },
  'nr-alert': {
    type: ['success', 'info', 'warning', 'error'],
  },
  'nr-tag': {
    color: ['magenta', 'red', 'volcano', 'orange', 'gold', 'lime', 'green', 'cyan', 'blue', 'geekblue', 'purple'],
    size: ['default', 'small'],
  },
  'nr-badge': {
    status: ['success', 'processing', 'default', 'error', 'warning'],
    size: ['default', 'small'],
    color: ['pink', 'red', 'yellow', 'orange', 'cyan', 'green', 'blue', 'purple', 'geekblue', 'magenta', 'volcano', 'gold', 'lime'],
    ribbonPlacement: ['start', 'end'],
  },
  'nr-checkbox': {
    size: ['small', 'medium', 'large'],
  },
  'nr-radio': {
    size: ['small', 'medium', 'large'],
  },
  'nr-radio-group': {
    state: ['error', 'warning'],
    direction: ['horizontal', 'vertical'],
    position: ['left', 'right'],
    type: ['default', 'button', 'slot', 'button-slot'],
    size: ['small', 'medium', 'large'],
    variant: ['default', 'solid'],
  },
  'nr-divider': {
    type: ['horizontal', 'vertical'],
    orientation: ['start', 'center', 'end'],
    variant: ['solid', 'dashed', 'dotted'],
    size: ['small', 'middle', 'large'],
  },
  'nr-label': {
    size: ['small', 'medium', 'large'],
    variant: ['default', 'secondary', 'success', 'warning', 'error'],
  },
  'nr-icon': {
    type: ['solid', 'regular'],
  },
  'nr-image': {
    fit: ['none', 'fill', 'contain', 'cover', 'scale-down'],
    placeholder: ['default', 'custom'],
  },
  'nr-video': {
    controls: ['show', 'hide', 'hover'],
    preload: ['none', 'metadata', 'auto'],
  },
  'nr-dropdown': {
    placement: ['bottom', 'top', 'bottom-start', 'bottom-end', 'top-start', 'top-end', 'auto'],
    trigger: ['click', 'hover', 'focus', 'manual'],
    size: ['small', 'medium', 'large'],
    animation: ['none', 'fade', 'slide', 'scale'],
  },
  'nr-menu': {
    size: ['small', 'medium', 'large'],
    iconPosition: ['left', 'right'],
  },
  'nr-breadcrumb': {
    separator: ['/', '>', '›', '-', '•'],
  },
  'nr-modal': {
    size: ['small', 'medium', 'large', 'xl'],
    position: ['center', 'top', 'bottom'],
    animation: ['fade', 'zoom', 'slide-up', 'slide-down', 'none'],
    backdrop: ['static', 'closable', 'none'],
  },
  'nr-popconfirm': {
    placement: ['top', 'top-start', 'top-end', 'bottom', 'bottom-start', 'bottom-end', 'left', 'left-start', 'left-end', 'right', 'right-start', 'right-end'],
    trigger: ['click', 'hover', 'focus'],
    buttonType: ['primary', 'secondary', 'danger', 'default'],
    icon: ['exclamation-circle', 'question-circle', 'info-circle', 'close-circle', 'check-circle'],
  },
  'nr-toast': {
    type: ['default', 'success', 'error', 'warning', 'info'],
    position: ['top-right', 'top-left', 'top-center', 'bottom-right', 'bottom-left', 'bottom-center'],
    animation: ['fade', 'slide', 'bounce'],
  },
  'nr-skeleton': {
    shape: ['circle', 'square', 'round', 'default'],
    size: ['small', 'default', 'large'],
    elementType: ['avatar', 'button', 'input', 'image'],
  },
  'nr-timeline': {
    mode: ['left', 'right', 'alternate'],
    color: ['blue', 'red', 'green', 'gray'],
    position: ['left', 'right'],
  },
  'nr-table': {
    filterType: ['text', 'select', 'number', 'date'],
    selectionMode: ['single', 'multiple'],
    size: ['small', 'normal', 'large'],
  },
  'nr-form': {
    validationState: ['pristine', 'pending', 'valid', 'invalid', 'submitted'],
    submissionState: ['idle', 'submitting', 'success', 'error'],
  },
  'nr-flex': {
    direction: ['row', 'row-reverse', 'column', 'column-reverse'],
    wrap: ['nowrap', 'wrap', 'wrap-reverse'],
    justify: ['flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly'],
    align: ['flex-start', 'flex-end', 'center', 'baseline', 'stretch'],
    gap: ['small', 'medium', 'large'],
  },
  'nr-grid': {
    breakpoint: ['xs', 'sm', 'md', 'lg', 'xl', 'xxl'],
    align: ['top', 'middle', 'bottom', 'stretch'],
    justify: ['start', 'end', 'center', 'space-around', 'space-between', 'space-evenly'],
  },
  'nr-layout': {
    breakpoint: ['xs', 'sm', 'md', 'lg', 'xl', 'xxl'],
    siderTheme: ['light', 'dark'],
  },
  'nr-panel': {
    mode: ['panel', 'window', 'minimized', 'embedded'],
    size: ['small', 'medium', 'large', 'custom'],
    position: ['left', 'right', 'bottom', 'top'],
    maximizePosition: ['center', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'],
  },
  'nr-container': {
    layout: ['fluid', 'boxed', 'fixed'],
    direction: ['row', 'column'],
    size: ['sm', 'md', 'lg', 'xl', 'full'],
    padding: ['none', 'sm', 'md', 'lg'],
    justify: ['flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly'],
    align: ['flex-start', 'flex-end', 'center', 'baseline', 'stretch'],
  },
  'nr-slider-input': {
    size: ['small', 'medium', 'large'],
    variant: ['default', 'primary', 'success', 'warning', 'error'],
  },
  'nr-datepicker': {
    state: ['error', 'warning', 'success'],
    mode: ['day', 'month', 'year', 'decade'],
    type: ['single', 'range', 'multiple'],
    size: ['small', 'medium', 'large'],
    variant: ['default', 'outlined', 'filled'],
    format: ['YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY', 'DD/MM/YY', 'DD MMMM YYYY', 'DD MMM YYYY'],
    placement: ['bottom', 'top', 'auto'],
  },
  'nr-timepicker': {
    timeFormat: ['24h', '12h'],
    mode: ['hours', 'minutes', 'seconds'],
    size: ['small', 'medium', 'large'],
    variant: ['default', 'outlined', 'filled'],
    state: ['default', 'error', 'warning', 'success'],
    placement: ['bottom', 'top', 'auto'],
  },
  'nr-colorpicker': {
    size: ['default', 'small', 'large'],
    trigger: ['click', 'hover', 'manual'],
    placement: ['top', 'bottom', 'auto'],
    animation: ['none', 'fade', 'slide', 'scale'],
    format: ['hex', 'rgb', 'rgba', 'hsl', 'hsla'],
  },
  'nr-textarea': {
    state: ['default', 'error', 'warning', 'success'],
    size: ['large', 'medium', 'small'],
    variant: ['outlined', 'filled', 'borderless', 'underlined'],
    resize: ['none', 'vertical', 'horizontal', 'both'],
  },
  'nr-iconpicker': {
    size: ['small', 'medium', 'large'],
    placement: ['auto', 'top', 'bottom', 'top-start', 'top-end', 'bottom-start', 'bottom-end', 'left', 'right'],
    trigger: ['click', 'hover', 'manual'],
    iconType: ['solid', 'regular', 'brands'],
  },
  'nr-file-upload': {
    size: ['small', 'medium', 'large'],
  },
};

/** HTML attribute enum values for standard elements */
const HTML_ATTR_ENUMS: Record<string, string[]> = {
  target: ['_self', '_blank', '_parent', '_top'],
  type: ['text', 'password', 'email', 'number', 'tel', 'url', 'search', 'date', 'time', 'datetime-local', 'month', 'week', 'color', 'file', 'range', 'hidden', 'checkbox', 'radio', 'submit', 'reset', 'button'],
  loading: ['lazy', 'eager'],
  decoding: ['sync', 'async', 'auto'],
  crossorigin: ['anonymous', 'use-credentials'],
  referrerpolicy: ['no-referrer', 'no-referrer-when-downgrade', 'origin', 'origin-when-cross-origin', 'same-origin', 'strict-origin', 'strict-origin-when-cross-origin', 'unsafe-url'],
  autocomplete: ['on', 'off'],
  dir: ['ltr', 'rtl', 'auto'],
  draggable: ['true', 'false'],
  contenteditable: ['true', 'false'],
  inputmode: ['none', 'text', 'decimal', 'numeric', 'tel', 'search', 'email', 'url'],
  wrap: ['hard', 'soft'],
  method: ['get', 'post', 'dialog'],
  enctype: ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'],
  rel: ['noopener', 'noreferrer', 'nofollow', 'external', 'stylesheet', 'icon'],
};

/** Properties to hide from the panel */
const HIDDEN_PROPS = new Set([
  'currentTheme', 'requiredComponents', 'styles', 'renderOptions',
  'shadowRootOptions', 'elementStyles', 'properties', 'localizeDir',
  'isUpdatePending', 'hasUpdated', 'updateComplete',
]);

/**
 * Discover editable properties for any HTML element.
 * Three-tier: Lit custom elements → unknown custom elements → standard HTML.
 */
export function discoverProperties(element: HTMLElement): PropertyInfo[] {
  const tag = element.tagName.toLowerCase();
  const isCustom = tag.includes('-');

  if (isCustom) {
    // Try Lit element discovery via elementProperties
    const ctor = customElements.get(tag) as any;
    if (ctor?.elementProperties) {
      return discoverLitProperties(element, tag, ctor.elementProperties);
    }
  }

  // Fallback: read DOM attributes (for unknown custom elements and standard HTML)
  return discoverDomAttributes(element, tag);
}

function discoverLitProperties(element: HTMLElement, tag: string, propMap: Map<string, any>): PropertyInfo[] {
  const props: PropertyInfo[] = [];
  const enumMap = PROPERTY_ENUMS[tag];

  for (const [name, declaration] of propMap) {
    // Skip internal state
    if (declaration.state === true) continue;
    // Skip hidden / private
    if (HIDDEN_PROPS.has(name) || name.startsWith('_') || name.startsWith('__')) continue;

    const typeCtor = declaration.type;
    let type: PropertyInfo['type'] = 'String';
    if (typeCtor === Boolean) type = 'Boolean';
    else if (typeCtor === Number) type = 'Number';
    else if (typeCtor === Array) type = 'Array';
    else if (typeCtor === Object) type = 'Object';

    // Resolve attribute name (Lit may use a custom attribute name)
    let attrName = declaration.attribute;
    if (attrName === undefined || attrName === true) {
      // Default: lowercase prop name
      attrName = name.toLowerCase();
    } else if (attrName === false) {
      // Not reflected — still show but use prop name as attr
      attrName = name.toLowerCase();
    }

    const value = (element as any)[name];
    const enumValues = enumMap?.[name];

    props.push({ name, attrName, type, value, enumValues });
  }

  return props;
}

function discoverDomAttributes(element: HTMLElement, tag: string): PropertyInfo[] {
  const props: PropertyInfo[] = [];
  for (const attr of Array.from(element.attributes)) {
    if (attr.name.startsWith('data-nk-')) continue;
    if (attr.name === 'class' || attr.name === 'style') continue;

    const enumValues = HTML_ATTR_ENUMS[attr.name];
    props.push({
      name: attr.name,
      attrName: attr.name,
      type: 'String',
      value: attr.value,
      enumValues,
    });
  }
  return props;
}
