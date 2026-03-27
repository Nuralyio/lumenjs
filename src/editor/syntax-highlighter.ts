/**
 * Lightweight syntax highlighter for CodeJar.
 */

const KW = new Set([
  'async','await','break','case','catch','class','const','continue','debugger',
  'default','delete','do','else','enum','export','extends','finally','for',
  'from','function','if','implements','import','in','instanceof','interface',
  'let','new','of','return','static','super','switch','this','throw','try',
  'type','typeof','var','void','while','with','yield',
]);
const LIT = new Set(['true','false','null','undefined','NaN','Infinity']);

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function highlightCode(el: HTMLElement) {
  const src = el.textContent || '';
  let out = '', i = 0;
  while (i < src.length) {
    // Line comment
    if (src[i] === '/' && src[i + 1] === '/') {
      const e = src.indexOf('\n', i); const end = e === -1 ? src.length : e;
      out += `<span class="nk-hl-c">${esc(src.slice(i, end))}</span>`;
      i = end; continue;
    }
    // Block comment
    if (src[i] === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2); const end = e === -1 ? src.length : e + 2;
      out += `<span class="nk-hl-c">${esc(src.slice(i, end))}</span>`;
      i = end; continue;
    }
    // String
    if (src[i] === '"' || src[i] === "'" || src[i] === '`') {
      const q = src[i]; let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === q) { j++; break; }
        if (q !== '`' && src[j] === '\n') break;
        j++;
      }
      out += `<span class="nk-hl-s">${esc(src.slice(i, j))}</span>`;
      i = j; continue;
    }
    // Word (keyword / literal / identifier)
    if (/[a-zA-Z_$]/.test(src[i])) {
      let j = i;
      while (j < src.length && /[\w$]/.test(src[j])) j++;
      const w = src.slice(i, j);
      out += KW.has(w) ? `<span class="nk-hl-k">${w}</span>`
           : LIT.has(w) ? `<span class="nk-hl-l">${w}</span>`
           : esc(w);
      i = j; continue;
    }
    // Number
    if (/\d/.test(src[i])) {
      let j = i;
      while (j < src.length && /[\d.xXa-fA-FeEnb_]/.test(src[j])) j++;
      out += `<span class="nk-hl-n">${esc(src.slice(i, j))}</span>`;
      i = j; continue;
    }
    out += esc(src[i]); i++;
  }
  el.innerHTML = out;
}
