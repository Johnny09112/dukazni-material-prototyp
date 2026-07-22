// @ts-check
/**
 * Miniaturní DOM helper pro UI vrstvu — žádný framework (ADR-001).
 */

/**
 * Vytvoří element: h('div', {class: 'x', onclick: fn}, dítě, 'text', [pole]).
 * @param {string} tag
 * @param {Record<string, any>} [attrs]
 * @param {...any} deti
 * @returns {HTMLElement}
 */
export function h(tag, attrs = {}, ...deti) {
  const el = document.createElement(tag);
  for (const [klic, hodnota] of Object.entries(attrs)) {
    if (hodnota == null || hodnota === false) continue;
    if (klic === 'class') el.className = hodnota;
    else if (klic.startsWith('on') && typeof hodnota === 'function') {
      el.addEventListener(klic.slice(2), hodnota);
    } else if (hodnota === true) el.setAttribute(klic, '');
    else el.setAttribute(klic, String(hodnota));
  }
  for (const dite of deti.flat(Infinity)) {
    if (dite == null || dite === false) continue;
    el.append(/** @type {any} */ (dite).nodeType ? dite : document.createTextNode(String(dite)));
  }
  return el;
}
