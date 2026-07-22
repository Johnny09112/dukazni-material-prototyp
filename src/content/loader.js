// @ts-check
/**
 * Content loader (architektura.md §2.1): izomorfní parseContent(yamlStrings)
 * bez I/O — browser ho krmí přes Vite import, simulátor přes fs.
 *
 * Validuje obsah proti schématům z komentářů v hlavičkách obsah/*.yaml.
 * Chybové hlášky jsou ČESKY a KONKRÉTNÍ (soubor + id záznamu) — obsah ladí
 * neprogramátor. Všechny nalezené chyby se hlásí najednou.
 */

import { load } from 'js-yaml';
import { CURSED_EFFECTS, PURSUER_EFFECTS } from '../engine/rules.js';
import { parseCondition } from '../engine/events.js';

const TAGY = ['nasili', 'lest', 'uplatek', 'utek'];
const TYPY_KARET = ['zakladni', 'prokleta', 'zoufala'];
const TVRDOSTI = ['bedna', 'zar', 'zraneni'];
const AFINITY = [-2, 0, 2];
const MAX_TEXT_KARTY = 140; // schéma: „max ~140 znaků"
const MAX_SLOV_NAZVU = 3;

/**
 * @param {{karty: string, uzly: string, cile: string, pronasledovatele: string}} yamlStrings
 *   surové YAML texty jednotlivých souborů z obsah/
 * @returns {{karty: object[], uzly: object[], cile: object[],
 *   pronasledovatele: object[], verze: string}}
 * @throws {Error} souhrn všech validačních chyb, česky
 */
export function parseContent(yamlStrings) {
  /** @type {string[]} */
  const chyby = [];

  const karty = parseFile(yamlStrings.karty, 'karty.yaml', 'karty', chyby);
  const uzly = parseFile(yamlStrings.uzly, 'uzly.yaml', 'uzly', chyby);
  const cile = parseFile(yamlStrings.cile, 'cile.yaml', 'cile', chyby);
  const pronasledovatele = parseFile(
    yamlStrings.pronasledovatele,
    'pronasledovatele.yaml',
    'pronasledovatele',
    chyby
  );

  validujUnikatniId([...karty, ...uzly, ...cile, ...pronasledovatele], chyby);
  karty.forEach((k) => validujKartu(k, chyby));
  uzly.forEach((u) => validujUzel(u, chyby));
  cile.forEach((c) => validujCil(c, chyby));
  pronasledovatele.forEach((p) => validujPronasledovatele(p, chyby));

  const zatahy = uzly.filter((u) => u.specialni === 'zatah');
  if (zatahy.length !== 1) {
    chyby.push(`uzly.yaml: očekávám přesně 1 speciální Zátah-uzel (specialni: zatah), nalezeno ${zatahy.length}.`);
  }
  if (uzly.filter((u) => !u.specialni).length < 2) {
    chyby.push('uzly.yaml: potřebuji aspoň 2 běžné uzly (volba cesty je vždy ze 2).');
  }

  if (chyby.length > 0) {
    throw new Error(`Obsah neprošel validací (${chyby.length} chyb):\n- ${chyby.join('\n- ')}`);
  }

  return {
    karty,
    uzly,
    cile,
    pronasledovatele,
    verze: fnv1a(
      [yamlStrings.karty, yamlStrings.uzly, yamlStrings.cile, yamlStrings.pronasledovatele].join('\n')
    ),
  };
}

/** @param {string} yamlText @param {string} soubor @param {string} klic @param {string[]} chyby */
function parseFile(yamlText, soubor, klic, chyby) {
  if (typeof yamlText !== 'string' || yamlText.trim() === '') {
    chyby.push(`${soubor}: chybí obsah souboru.`);
    return [];
  }
  let data;
  try {
    data = load(yamlText);
  } catch (err) {
    chyby.push(`${soubor}: YAML se nedá načíst — ${err.message}`);
    return [];
  }
  const zaznamy = data?.[klic];
  if (!Array.isArray(zaznamy)) {
    chyby.push(`${soubor}: očekávám seznam pod klíčem „${klic}".`);
    return [];
  }
  zaznamy.forEach((z, i) => {
    if (!z || typeof z.id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(z.id)) {
      chyby.push(`${soubor}: záznam č. ${i + 1} nemá platné kebab-case id.`);
    }
  });
  return zaznamy.filter((z) => z && typeof z.id === 'string');
}

/** @param {object[]} vse @param {string[]} chyby */
function validujUnikatniId(vse, chyby) {
  const videno = new Set();
  for (const z of vse) {
    if (videno.has(z.id)) chyby.push(`id „${z.id}" není unikátní napříč soubory v obsah/.`);
    videno.add(z.id);
  }
}

/** @param {object} k @param {string[]} chyby */
function validujKartu(k, chyby) {
  const kde = `karty.yaml, karta „${k.id}"`;
  if (!TYPY_KARET.includes(k.typ)) {
    chyby.push(`${kde}: neznámý typ „${k.typ}" (povolené: ${TYPY_KARET.join(', ')}).`);
    return;
  }
  if (typeof k.nazev !== 'string' || k.nazev.trim() === '') {
    chyby.push(`${kde}: chybí název.`);
  } else if (k.nazev.trim().split(/\s+/).length > MAX_SLOV_NAZVU) {
    chyby.push(`${kde}: název „${k.nazev}" má víc než ${MAX_SLOV_NAZVU} slova.`);
  }
  if (typeof k.text !== 'string' || k.text.trim() === '') {
    chyby.push(`${kde}: chybí text.`);
  } else if (k.text.length > MAX_TEXT_KARTY) {
    chyby.push(`${kde}: text má ${k.text.length} znaků (max ${MAX_TEXT_KARTY}).`);
  }
  if (k.hlucna !== undefined && typeof k.hlucna !== 'boolean') {
    chyby.push(`${kde}: hlucna musí být true/false.`);
  }
  if (k.typ === 'prokleta') {
    if (k.tag != null) chyby.push(`${kde}: prokletá karta nesmí mít tag (má „${k.tag}").`);
    if (k.sila !== 0) chyby.push(`${kde}: prokletá karta musí mít sílu 0 (má ${k.sila}).`);
    if (!CURSED_EFFECTS[k.id]) {
      chyby.push(`${kde}: engine nezná mechanický efekt této prokleté karty (doplň do CURSED_EFFECTS v src/engine/rules.js).`);
    }
  } else {
    if (!TAGY.includes(k.tag)) {
      chyby.push(`${kde}: neplatný tag „${k.tag}" (povolené: ${TAGY.join(', ')}).`);
    }
    if (!Number.isInteger(k.sila) || k.sila < 1 || k.sila > 3) {
      chyby.push(`${kde}: síla musí být 1–3 (má ${k.sila}).`);
    }
  }
  if (k.typ === 'zoufala' && (typeof k.podminka !== 'string' || k.podminka.trim() === '')) {
    chyby.push(`${kde}: zoufalá karta musí mít podmínku (např. "3+ zranění").`);
  }
  if (k.typ !== 'zoufala' && k.podminka !== undefined) {
    chyby.push(`${kde}: pole podminka patří jen zoufalým kartám.`);
  }
}

/** @param {object} afinity @param {string} kde @param {string[]} chyby */
function validujAfinity(afinity, kde, chyby) {
  if (!afinity || typeof afinity !== 'object') {
    chyby.push(`${kde}: chybí afinity.`);
    return;
  }
  for (const tag of TAGY) {
    if (!(tag in afinity)) {
      chyby.push(`${kde}: afinity postrádají tag „${tag}".`);
    } else if (!AFINITY.includes(afinity[tag])) {
      chyby.push(`${kde}: afinita ${tag}: ${afinity[tag]} není z povolených hodnot (${AFINITY.join(' | ')}).`);
    }
  }
  for (const klic of Object.keys(afinity)) {
    if (!TAGY.includes(klic)) chyby.push(`${kde}: neznámý tag afinit „${klic}".`);
  }
}

/** @param {object} u @param {string[]} chyby */
function validujUzel(u, chyby) {
  const kde = `uzly.yaml, uzel „${u.id}"`;
  if (typeof u.nazev !== 'string' || u.nazev.trim() === '') chyby.push(`${kde}: chybí název.`);
  if (typeof u.uvod !== 'string' || u.uvod.trim() === '') chyby.push(`${kde}: chybí úvod.`);
  validujAfinity(u.afinity, kde, chyby);
  if (!TVRDOSTI.includes(u.tvrdost)) {
    chyby.push(`${kde}: neplatná tvrdost „${u.tvrdost}" (povolené: ${TVRDOSTI.join(', ')}).`);
  }
  if (u.specialni !== undefined && u.specialni !== 'zatah') {
    chyby.push(`${kde}: neznámá hodnota specialni „${u.specialni}" (povolené: zatah).`);
  }
}

/** @param {object} c @param {string[]} chyby */
function validujCil(c, chyby) {
  const kde = `cile.yaml, cíl „${c.id}"`;
  if (typeof c.text !== 'string' || c.text.trim() === '') chyby.push(`${kde}: chybí text.`);
  if (typeof c.overeni !== 'string' || c.overeni.trim() === '') chyby.push(`${kde}: chybí overeni.`);
  if (!Number.isInteger(c.body) || c.body < 1 || c.body > 3) {
    chyby.push(`${kde}: body musí být 1–3 (má ${c.body}).`);
  }
  if (c.overeni_typ === 'mechanicky') {
    if (typeof c.podminka !== 'string' || c.podminka.trim() === '') {
      chyby.push(`${kde}: mechanický cíl musí mít pole podminka.`);
      return;
    }
    try {
      parseCondition(c.podminka);
    } catch (err) {
      chyby.push(`${kde}: podminka se nedá naparsovat — ${err.message}`);
    }
  } else if (c.overeni_typ === 'textovy') {
    if (c.podminka !== undefined) {
      chyby.push(`${kde}: textový cíl nesmí mít pole podminka.`);
    }
  } else {
    chyby.push(`${kde}: overeni_typ musí být mechanicky | textovy (má „${c.overeni_typ}").`);
  }
}

/** @param {object} p @param {string[]} chyby */
function validujPronasledovatele(p, chyby) {
  const kde = `pronasledovatele.yaml, pronásledovatel „${p.id}"`;
  if (typeof p.nazev !== 'string' || p.nazev.trim() === '') chyby.push(`${kde}: chybí název.`);
  if (!TAGY.includes(p.ruseny_tag)) {
    chyby.push(`${kde}: neplatný ruseny_tag „${p.ruseny_tag}" (povolené: ${TAGY.join(', ')}).`);
  }
  if (typeof p.pravidlo !== 'string' || p.pravidlo.trim() === '') chyby.push(`${kde}: chybí pravidlo.`);
  if (typeof p.flavor !== 'string' || p.flavor.trim() === '') chyby.push(`${kde}: chybí flavor.`);
  if (!PURSUER_EFFECTS[p.id]) {
    chyby.push(`${kde}: engine nezná mechaniku tohoto pronásledovatele (doplň do PURSUER_EFFECTS v src/engine/rules.js).`);
  }
  for (const [klic, ocekavanaTvrdost] of [['lecka', 'zar'], ['konfrontace', 'zraneni']]) {
    const mini = p[klic];
    if (!mini || typeof mini !== 'object') {
      chyby.push(`${kde}: chybí mini-uzel ${klic}.`);
      continue;
    }
    if (typeof mini.uvod !== 'string' || mini.uvod.trim() === '') {
      chyby.push(`${kde}: mini-uzel ${klic} nemá úvod.`);
    }
    validujAfinity(mini.afinity, `${kde}, mini-uzel ${klic}`, chyby);
    if (mini.tvrdost !== ocekavanaTvrdost) {
      chyby.push(`${kde}: tvrdost mini-uzlu ${klic} musí být „${ocekavanaTvrdost}" (má „${mini.tvrdost}").`);
    }
  }
}

/**
 * FNV-1a hash → hex; slouží jako verze obsahu do události run_started
 * (reprodukovatelnost dávek — architektura §2.2, ADR-005).
 * @param {string} text
 */
function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
