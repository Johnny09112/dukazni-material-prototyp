// @ts-check
/**
 * Psací stroj — povinný efekt prototypu (architektura §2.4): postupné
 * vyklepávání protokolu ~30–50 ms/znak s malou variancí, přeskočitelné
 * klikem. Respektuje prefers-reduced-motion (vypíše text okamžitě).
 *
 * Záměrně netestováno (jen prezentační efekt, viz zadání fáze 2).
 */

/**
 * Vyklepe odstavce do kontejneru. Klik na kontejner efekt přeskočí.
 *
 * @param {HTMLElement} kontejner
 * @param {string[]} odstavce
 * @param {{minMs?: number, maxMs?: number}} [opts]
 * @returns {{hotovo: Promise<void>, preskoc: () => void}}
 */
export function vyklepej(kontejner, odstavce, opts = {}) {
  const minMs = opts.minMs ?? 30;
  const maxMs = opts.maxMs ?? 50;
  const okamzite =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  /** @type {{p: HTMLElement, text: string}[]} */
  const casti = odstavce.map((text) => {
    const p = document.createElement('p');
    p.className = 'protokol-odstavec';
    kontejner.append(p);
    return { p, text };
  });
  const kurzor = document.createElement('span');
  kurzor.className = 'protokol-kurzor';

  let preskoceno = false;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let casovac = null;
  /** @type {() => void} */
  let dokonci = () => {};

  const hotovo = new Promise((resolve) => {
    let iOdstavec = 0;
    let iZnak = 0;

    dokonci = () => {
      if (casovac) clearTimeout(casovac);
      for (const { p, text } of casti) p.textContent = text;
      kurzor.remove();
      resolve(undefined);
    };

    if (okamzite || casti.length === 0) {
      dokonci();
      return;
    }

    function krok() {
      if (preskoceno) {
        dokonci();
        return;
      }
      if (iOdstavec >= casti.length) {
        kurzor.remove();
        resolve(undefined);
        return;
      }
      const { p, text } = casti[iOdstavec];
      if (iZnak < text.length) {
        iZnak += 1;
        p.textContent = text.slice(0, iZnak);
        p.append(kurzor);
        casovac = setTimeout(krok, minMs + Math.random() * (maxMs - minMs));
      } else {
        iOdstavec += 1;
        iZnak = 0;
        // Krátká odmlka mezi odstavci — návrat válce.
        casovac = setTimeout(krok, 6 * maxMs);
      }
    }
    krok();
  });

  const preskoc = () => {
    if (preskoceno) return;
    preskoceno = true;
    dokonci();
  };
  kontejner.addEventListener('click', preskoc);

  return { hotovo, preskoc };
}
