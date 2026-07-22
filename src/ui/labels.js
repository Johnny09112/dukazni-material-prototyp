// @ts-check
/**
 * České popisky pro render — jen prezentace, žádná herní logika.
 * Čísla v popiscích se berou z `rules` (ADR-003: nikde je nehardcodovat).
 */

export const TAG_LABEL = /** @type {Record<string, string>} */ ({
  nasili: 'Násilí',
  lest: 'Lest',
  uplatek: 'Úplatek',
  utek: 'Útěk',
});

export const PASMO_LABEL = /** @type {Record<string, string>} */ ({
  uspech: 'ÚSPĚCH',
  uspech_za_cenu: 'ÚSPĚCH ZA CENU',
  selhani: 'SELHÁNÍ',
});

export const DRUH_LABEL = /** @type {Record<string, string|null>} */ ({
  uzel: null,
  zatah: 'ZÁTAH',
  lecka: 'LÉČKA',
  konfrontace: 'KONFRONTACE',
});

export const PRICINA_LABEL = /** @type {Record<string, string>} */ ({
  doruceno: 'náklad dojel do New Yorku',
  dosly_bedny: 'došly bedny',
  vsichni_vyrazeni: 'všichni podezřelí vyřazeni',
});

/**
 * Co navíc stojí selhání v tomto uzlu.
 * @param {string} tvrdost @param {{tvrdostZarPrirustek: number}} rules
 */
export function tvrdostLabel(tvrdost, rules) {
  if (tvrdost === 'bedna') return 'selhání stojí navíc 1 bednu';
  if (tvrdost === 'zar') return `selhání přidává +${rules.tvrdostZarPrirustek} Žáru (za každé)`;
  if (tvrdost === 'zraneni') return 'selhání přidává druhé zranění';
  return tvrdost;
}

/** Zobrazení čísla se znaménkem a typografickým minus. @param {number} n */
export function znamenko(n) {
  if (n > 0) return `+${n}`;
  if (n < 0) return `−${-n}`;
  return '±0';
}

/** Výsledek runu s diakritikou. @param {string} vysledek */
export function vysledekLabel(vysledek) {
  return vysledek === 'DORUCENO' ? 'DORUČENO' : 'NEVYŘEŠENO';
}
