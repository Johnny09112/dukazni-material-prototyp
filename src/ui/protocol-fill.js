// @ts-check
/**
 * Výběr a dosazení fallback šablon protokolu
 * (content/prompty/fallback-sablony.yaml — schéma v hlavičce souboru).
 *
 * Čistý modul bez DOM a bez herní logiky (architektura §2.4): dostává hotové
 * výsledky z událostí enginu (`node_resolved`, `run_ended`) a jen z nich skládá
 * text. Náhoda výběru šablon je UI záležitost — vstřikuje se přes `rand`
 * (v testech deterministická, v aplikaci Math.random; engine se jí nedotýká).
 *
 * Kontrakt {jmeno} (CLAUDE.md): dosazuje se PŘÍJMENÍ postavy — poslední slovo
 * pole `jmeno` z content/obsah/postavy.yaml.
 */

/**
 * Workaround chyby obsahu (nahlášeno do design repa 2026-07-22):
 * fallback-sablony.yaml uzavírá české uvozovky ASCII znakem `"` uvnitř
 * double-quoted YAML scalarů (`text: "… „{karta}". …"`), což scalar předčasně
 * ukončí a soubor je nevalidní YAML. Než to design repo opraví, nahradíme
 * vnitřní neescapované `"` v `text:` řádcích typografickým `“` (správná česká
 * uzavírací uvozovka). Po opravě obsahu je funkce neškodná (nic nenajde).
 * @param {string} yamlText
 */
export function opravUvozovkySablon(yamlText) {
  return yamlText
    .split('\n')
    .map((radek) => {
      const m = radek.match(/^(\s*text:\s*")(.*)("\s*)$/);
      if (!m) return radek;
      return m[1] + m[2].replace(/(?<!\\)"/g, '“') + m[3];
    })
    .join('\n');
}

/** Mapování pásma hodu z události enginu na pásmo šablony. */
export const PASMO_HODU = /** @type {const} */ ({
  uspech: 'uspech',
  uspech_za_cenu: 'za_cenu',
  selhani: 'selhani',
});

/** Pásmo úvodní šablony pro speciální druhy setkání. */
export const PASMO_DRUHU = /** @type {const} */ ({
  zatah: 'zatah',
  lecka: 'lecka',
  konfrontace: 'konfrontace',
});

/** Nouzová věta, kdyby pro kombinaci neexistovala žádná šablona. */
export const NOUZOVY_ZAZNAM =
  'Průběh v tomto bodě zaznamenán bez podrobností; spis doplní vyšetřovatel dodatečně.';

/**
 * Příjmení = poslední slovo celého jména („Vincenc Bartoš" → „Bartoš").
 * @param {string} celeJmeno
 */
export function prijmeni(celeJmeno) {
  const slova = String(celeJmeno).trim().split(/\s+/);
  return slova[slova.length - 1];
}

const BEDNY_SLOVY = [
  'žádná bedna',
  'jedna bedna',
  'dvě bedny',
  'tři bedny',
  'čtyři bedny',
  'pět beden',
  'šest beden',
];

/**
 * Česká fráze počtu beden („jedna bedna" / „dvě bedny" / „pět beden").
 * Slovem do šesti (víc jich tým nevozí — rules.bedenNaStartu), dál číslicí.
 * @param {number} n
 */
export function frazeBeden(n) {
  return BEDNY_SLOVY[n] ?? `${n} beden`;
}

/**
 * Popis zranění pro {zraneni}. Zatím obecný placeholder („zranění blíže
 * neurčené"), obarvený tvrdostí uzlu, byla-li při hodu aplikována; konkrétní
 * popisy dodá až LLM vrstva (fáze 3).
 * @param {string|null|undefined} tvrdostAplikovana bedna | zar | zraneni | null
 */
export function popisZraneni(tvrdostAplikovana) {
  if (tvrdostAplikovana === 'zraneni') return 'zranění vícečetné, blíže neurčené';
  if (tvrdostAplikovana === 'zar') return 'zranění blíže neurčené, utrpěné za značného rozruchu';
  return 'zranění blíže neurčené';
}

/**
 * Dosadí hodnoty do placeholderů {klic}. Neznámé placeholdery nechává být
 * (šablona smí zmínit jen to, co jí `podminka` zaručuje — chybějící hodnota
 * je chyba šablony, ne dosazení).
 * @param {string} text
 * @param {Record<string, string|number>} hodnoty
 */
export function dosad(text, hodnoty) {
  return text.replace(/\{(\w+)\}/g, (cely, klic) =>
    klic in hodnoty ? String(hodnoty[klic]) : cely
  );
}

/**
 * Sedí šablona na stav hodu? Klíč vynechaný v `podminka` = „jakkoli";
 * uvedený klíč musí odpovídat (`ano` ⇔ true).
 * @param {{podminka?: {zraneni?: string, bedna?: string}}} sablona
 * @param {{zraneni?: boolean, bedna?: boolean}} stav
 */
export function sedi(sablona, stav) {
  const p = sablona.podminka ?? {};
  for (const klic of /** @type {const} */ (['zraneni', 'bedna'])) {
    if (p[klic] != null && (p[klic] === 'ano') !== Boolean(stav?.[klic])) return false;
  }
  return true;
}

/**
 * Stavový výběr šablon: filtruje dle pásma + podmínky a losuje bez opakování
 * v řadě (tatáž šablona nepadne dvakrát po sobě, pokud je z čeho vybírat).
 *
 * @param {object[]} sablony seznam z fallback-sablony.yaml
 * @param {() => number} [rand] zdroj náhody [0,1) — v testech deterministický
 * @returns {(pasmo: string, stav?: {zraneni?: boolean, bedna?: boolean}) =>
 *   {id: string|null, text: string}}
 */
export function createVyberSablon(sablony, rand = Math.random) {
  /** @type {Map<string, string>} poslední vylosované id per pásmo */
  const posledni = new Map();
  return function vyber(pasmo, stav = {}) {
    let kandidati = sablony.filter((s) => s.pasmo === pasmo && sedi(s, stav));
    if (kandidati.length === 0) return { id: null, text: NOUZOVY_ZAZNAM };
    if (kandidati.length > 1 && posledni.has(pasmo)) {
      const bezPosledni = kandidati.filter((s) => s.id !== posledni.get(pasmo));
      if (bezPosledni.length > 0) kandidati = bezPosledni;
    }
    const s = kandidati[Math.floor(rand() * kandidati.length)];
    posledni.set(pasmo, s.id);
    return { id: s.id, text: s.text };
  };
}

/**
 * Složí odstavce protokolu jednoho uzlu z události `node_resolved`.
 *
 * Pořadí: úvod speciálního setkání (Zátah/léčka/konfrontace) → hlasy z auta
 * (zasáhly před hody) → hody v pořadí u stolu → kolapsy.
 *
 * @param {object} udalost node_resolved (payload dle architektura.md §2.2)
 * @param {{kolapsy?: {postava: string}[],
 *   hlasy?: {postava: string}[]}} extra kolapsy = character_down události uzlu;
 *   hlasy = volby hlasu z auta zaznamenané UI vrstvou (engine je neloguje)
 * @param {{jmena: Record<string, string>}} ctx postavaId → celé jméno
 * @param {ReturnType<typeof createVyberSablon>} vyber
 * @returns {string[]} hotové odstavce
 */
export function zapisUzlu(udalost, extra, ctx, vyber) {
  /** @type {string[]} */
  const odstavce = [];
  const uzel = udalost.nazev ?? udalost.uzel;
  const ztracenoCelkem = udalost.hody.reduce(
    (soucet, h) => soucet + h.bedny_ztracene_timto_hodem,
    0
  );
  // Zůstatek nákladu PŘED uzlem; per hod se odečítá, ať {naklad} sedí v čase.
  let zbyva = udalost.zbyvaBeden + ztracenoCelkem;

  const pasmoDruhu = PASMO_DRUHU[udalost.druh];
  if (pasmoDruhu) {
    odstavce.push(dosad(vyber(pasmoDruhu).text, { uzel }));
  }

  for (const hlas of extra?.hlasy ?? []) {
    odstavce.push(
      dosad(vyber('hlas_z_auta').text, { jmeno: prijmeni(ctx.jmena[hlas.postava]), uzel })
    );
  }

  for (const hod of udalost.hody) {
    zbyva -= hod.bedny_ztracene_timto_hodem;
    const stav = {
      zraneni: hod.zraneni_pridana > 0,
      bedna: hod.bedny_ztracene_timto_hodem > 0,
    };
    const sablona = vyber(PASMO_HODU[hod.pasmo], stav);
    odstavce.push(
      dosad(sablona.text, {
        jmeno: prijmeni(ctx.jmena[hod.postava]),
        uzel,
        karta: hod.karta.nazev,
        bedny: frazeBeden(hod.bedny_ztracene_timto_hodem),
        naklad: frazeBeden(zbyva),
        zraneni: popisZraneni(hod.tvrdost_aplikovana),
      })
    );
  }

  for (const kolaps of extra?.kolapsy ?? []) {
    odstavce.push(
      dosad(vyber('kolaps').text, { jmeno: prijmeni(ctx.jmena[kolaps.postava]), uzel })
    );
  }

  return odstavce;
}

/**
 * Závěrečný odstavec spisu z události `run_ended`.
 * @param {object} udalost run_ended ({vysledek, zbyvaBeden, …})
 * @param {ReturnType<typeof createVyberSablon>} vyber
 * @returns {string[]}
 */
export function zapisFinale(udalost, vyber) {
  const pasmo = udalost.vysledek === 'DORUCENO' ? 'finale_doruceno' : 'finale_nevyreseno';
  return [dosad(vyber(pasmo).text, { naklad: frazeBeden(udalost.zbyvaBeden) })];
}
