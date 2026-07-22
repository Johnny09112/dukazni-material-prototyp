// @ts-check
/**
 * Čisté vyhodnocovací funkce resolučního systému (ADR-003).
 *
 * Žádná z funkcí nemutuje vstup ani nedrží stav; jediná náhoda přichází
 * zvenku přes `rng` (ADR-002). Orchestrace (aplikace následků, event log)
 * žije ve state.js.
 */

import { PURSUER_EFFECTS } from './rules.js';

/** Druhy setkání; léčka/konfrontace/zátah jsou „uzly pronásledovatele". */
export const ENCOUNTER_KINDS = /** @type {const} */ ({
  UZEL: 'uzel',
  ZATAH: 'zatah',
  LECKA: 'lecka',
  KONFRONTACE: 'konfrontace',
});

/** Setkání, na nichž platí rušený tag pronásledovatele (Malone). */
const PURSUER_OWNED_KINDS = new Set([
  ENCOUNTER_KINDS.ZATAH,
  ENCOUNTER_KINDS.LECKA,
  ENCOUNTER_KINDS.KONFRONTACE,
]);

/**
 * Efektivní síla karty: Malone nuluje sílu karet Úplatek na svých uzlech
 * (Zátah, léčka, konfrontace) — viz obsah/pronasledovatele.yaml.
 *
 * @param {{tag?: string|null, sila: number}} karta
 * @param {string} druhSetkani hodnota z ENCOUNTER_KINDS
 * @param {string} pronasledovatelId
 * @returns {number}
 */
export function effectiveStrength(karta, druhSetkani, pronasledovatelId) {
  const efekt = PURSUER_EFFECTS[pronasledovatelId];
  if (
    efekt?.silaNulaTagNaJehoUzlech &&
    karta.tag === efekt.silaNulaTagNaJehoUzlech &&
    PURSUER_OWNED_KINDS.has(druhSetkani)
  ) {
    return 0;
  }
  return karta.sila;
}

/**
 * Kolik Žáru stojí zahrání hlučné karty (Brody: +2 místo +1).
 *
 * @param {string} pronasledovatelId
 * @param {typeof import('./rules.js').RULES} rules
 * @returns {number}
 */
export function noisyHeat(pronasledovatelId, rules) {
  return PURSUER_EFFECTS[pronasledovatelId]?.zarZaHlucnou ?? rules.zar.zaHlucnouKartu;
}

/**
 * Postih za zranění: −min(zranění, 3); zoufalé karty ho ignorují
 * (prototyp-mvp.md — „zdemolovaný hráč s nimi hraje naplno").
 *
 * @param {number} zraneni
 * @param {boolean} zoufala
 * @param {typeof import('./rules.js').RULES} rules
 * @returns {number} nezáporné číslo, které se od hodu ODEČÍTÁ
 */
export function injuryPenalty(zraneni, zoufala, rules) {
  if (zoufala) return 0;
  return Math.min(zraneni, rules.maxPostihZraneni);
}

/**
 * Zařazení součtu do pásma. 7+ úspěch / 5–6 úspěch za cenu / ≤4 selhání.
 *
 * @param {number} soucet
 * @param {typeof import('./rules.js').RULES} rules
 * @returns {'uspech'|'uspech_za_cenu'|'selhani'}
 */
export function classifyBand(soucet, rules) {
  if (soucet >= rules.prahUspechu) return 'uspech';
  if (soucet >= rules.prahUspechuZaCenu) return 'uspech_za_cenu';
  return 'selhani';
}

/**
 * Vyhodnocení jednoho hodu postavy — čistá funkce, jediný hod d6 z rng.
 *
 * @param {object} vstup
 * @param {{tag?: string|null, sila: number}} vstup.karta
 * @param {boolean} vstup.zoufala hraje se zoufalá karta (ignoruje postih)
 * @param {number} vstup.zraneni aktuální zranění postavy
 * @param {number} vstup.afinita afinita uzlu k tagu karty (−2/0/+2)
 * @param {number} vstup.modifikatory součet bonusů/malusů (hlas z auta +1, prokleté −2…)
 * @param {string} vstup.druhSetkani hodnota z ENCOUNTER_KINDS
 * @param {string} vstup.pronasledovatelId
 * @param {typeof import('./rules.js').RULES} rules
 * @param {{die(sides: number): number}} rng
 * @returns {{hod: number, sila: number, afinita: number, postih: number,
 *   modifikatory: number, soucet: number, pasmo: 'uspech'|'uspech_za_cenu'|'selhani'}}
 */
export function resolveCheck(vstup, rules, rng) {
  const hod = rng.die(rules.kostka);
  const sila = effectiveStrength(vstup.karta, vstup.druhSetkani, vstup.pronasledovatelId);
  const postih = injuryPenalty(vstup.zraneni, vstup.zoufala, rules);
  const soucet = hod + sila + vstup.afinita - postih + vstup.modifikatory;
  return {
    hod,
    sila,
    afinita: vstup.afinita,
    postih,
    modifikatory: vstup.modifikatory,
    soucet,
    pasmo: classifyBand(soucet, rules),
  };
}

/**
 * Jaký rider se nabízí při selhání s kartou daného tagu.
 *
 * - Úplatek: DOBROVOLNĚ odhodit 1 týmovou bednu → povýšení na „úspěch za cenu"
 *   (zranění, ale bez tvrdosti a nepočítá se jako selhání).
 * - Útěk: vlastník VOLÍ zranění NEBO −1 týmová bedna (bez beden → zranění);
 *   tvrdost se uplatní tak jako tak.
 * - Násilí, Lest: žádný rider selhání (Násilí platí Žár hlučností, Lest nic).
 *
 * @param {string|null|undefined} tag
 * @param {number} bedny aktuální počet týmových beden
 * @returns {{typ: 'uplatek'|'utek', volby: string[]} | null}
 */
export function failureRider(tag, bedny) {
  if (tag === 'uplatek' && bedny > 0) {
    return { typ: 'uplatek', volby: ['zaplatit_bednu', 'nechat_selhani'] };
  }
  if (tag === 'utek') {
    return { typ: 'utek', volby: bedny > 0 ? ['zraneni', 'bedna'] : ['zraneni'] };
  }
  return null;
}
