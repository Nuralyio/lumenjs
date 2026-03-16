export interface AstModification {
  type: 'setAttribute' | 'removeAttribute' | 'insertElement' | 'removeElement' | 'setTextContent';
  elementSelector: string;
  /** Source line number from data-nk-source — used to find the exact element in the template */
  sourceLine?: number;
  attributeName?: string;
  attributeValue?: string;
  parentSelector?: string;
  position?: 'before' | 'after' | 'firstChild' | 'lastChild';
  html?: string;
}
