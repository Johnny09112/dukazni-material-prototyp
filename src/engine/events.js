// @ts-check
/**
 * Událostní log enginu (architektura.md §2.2) + odvození metrik tajných cílů
 * z logu a parser/vyhodnocení `podminka` výrazů (obsah/cile.yaml).
 *
 * Log je append-only a JSONL-serializovatelný; každá událost má `seq`,
 * `type`, `nodeIndex` a payload. UI i simulátor čtou tentýž log.
 */

/** Typy událostí — přesně dle tabulky v architektura.md §2.2. */
export const EVENT = /** @type {const} */ ({
  RUN_STARTED: 'run_started',
  ROUTE_OFFERED: 'route_offered',
  ROUTE_CHOSEN: 'route_chosen',
  CARD_PLAYED: 'card_played',
  CHECK_RESOLVED: 'check_resolved',
  INJURY_ADDED: 'injury_added',
  CURSED_DRAWN: 'cursed_drawn',
  CHARACTER_DOWN: 'character_down',
  CRATE_LOST: 'crate_lost',
  HEAT_CHANGED: 'heat_changed',
  HEAT_THRESHOLD: 'heat_threshold',
  AMBUSH_INSERTED: 'ambush_inserted',
  CONFRONTATION_STARTED: 'confrontation_started',
  NODE_RESOLVED: 'node_resolved',
  RUN_ENDED: 'run_ended',
});

/** Důvody ztráty bedny (payload `crate_lost.duvod`). */
export const CRATE_LOSS_REASON = /** @type {const} */ ({
  /** Rezervováno architekturou; pravidla v0.1 přímou ztrátu z hodu nemají. */
  HOD_SELHANI: 'hod_selhani',
  RIDER_UPLATEK: 'rider_uplatek',
  RIDER_UTEK: 'rider_utek',
  TVRDOST_UZLU: 'tvrdost_uzlu',
});

/**
 * Append-only událostní log.
 * @returns {{append(type: string, nodeIndex: number, payload: object): object,
 *   all(): object[]}}
 */
export function createLog() {
  /** @type {object[]} */
  const events = [];
  return {
    append(type, nodeIndex, payload) {
      const event = { seq: events.length + 1, type, nodeIndex, ...payload };
      events.push(event);
      return event;
    },
    all() {
      return events;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Metriky cílů z událostního logu (obsah/cile.yaml, hlavička schématu) */
/* ------------------------------------------------------------------ */

const TAGS = ['nasili', 'lest', 'uplatek', 'utek'];

/**
 * Odvodí metriky pro postavu vlastníka cíle z kompletního event logu.
 *
 * @param {object[]} events kompletní log runu (včetně run_ended)
 * @param {string} postavaId
 * @returns {{zraneni: number, kolaps: boolean, doruceno: boolean,
 *   ztracene_bedny: number, ztracene_bedny_vlastni: number,
 *   tag_prvni_karty: string|null, pocet_tag: Record<string, number>,
 *   max_sila_karty: number, zar_prah: number}}
 */
export function deriveGoalMetrics(events, postavaId) {
  let zraneni = 0;
  let kolaps = false;
  let doruceno = false;
  let ztracene_bedny = 0;
  let ztracene_bedny_vlastni = 0;
  /** @type {string|null} */
  let tag_prvni_karty = null;
  const pocet_tag = Object.fromEntries(TAGS.map((t) => [t, 0]));
  let max_sila_karty = 0;
  let zar_prah = 0;

  for (const e of events) {
    switch (e.type) {
      case EVENT.INJURY_ADDED:
        if (e.postava === postavaId) zraneni = e.pocetZraneni;
        break;
      case EVENT.CHARACTER_DOWN:
        if (e.postava === postavaId) kolaps = true;
        break;
      case EVENT.CRATE_LOST:
        ztracene_bedny += 1;
        if (e.postava === postavaId) ztracene_bedny_vlastni += 1;
        break;
      case EVENT.CARD_PLAYED:
        if (e.postava === postavaId) {
          if (tag_prvni_karty === null && e.karta.tag) tag_prvni_karty = e.karta.tag;
          if (e.karta.tag && e.karta.tag in pocet_tag) pocet_tag[e.karta.tag] += 1;
          // Jen DOBROVOLNĚ zahrané karty (bez zoufalých a vynucených) — cíl obetni-beranek.
          if (e.dobrovolna && e.karta.sila > max_sila_karty) max_sila_karty = e.karta.sila;
        }
        break;
      case EVENT.HEAT_THRESHOLD:
        if (e.prah > zar_prah) zar_prah = e.prah;
        break;
      case EVENT.RUN_ENDED:
        doruceno = e.vysledek === 'DORUCENO';
        break;
    }
  }

  return {
    zraneni,
    kolaps,
    doruceno,
    ztracene_bedny,
    ztracene_bedny_vlastni,
    tag_prvni_karty,
    pocet_tag,
    max_sila_karty,
    zar_prah,
  };
}

/* ------------------------------------------ */
/* Parser a vyhodnocení `podminka` výrazů      */
/* ------------------------------------------ */

/** Metriky povolené v `podminka` (viz hlavička obsah/cile.yaml). */
export const KNOWN_METRICS = [
  'zraneni',
  'kolaps',
  'doruceno',
  'ztracene_bedny',
  'ztracene_bedny_vlastni',
  'tag_prvni_karty',
  ...TAGS.map((t) => `pocet_tag.${t}`),
  'max_sila_karty',
  'zar_prah',
];

const OPERATORS = ['==', '!=', '>=', '<=', '>', '<'];

/**
 * Parser výrazů tvaru `metrika op hodnota` spojených `a`/`nebo`.
 * Precedence: `a` váže těsněji než `nebo` (OR přes AND-skupiny).
 * Holá metrika (např. `doruceno`) = test pravdivosti.
 *
 * @param {string} vyraz
 * @returns {{typ: 'nebo', skupiny: {typ: 'a', podminky:
 *   {metrika: string, op: string|null, hodnota: (number|boolean|string|null)}[]}[]}}
 * @throws {Error} česky, s konkrétním důvodem — loader hlášku obalí souborem a id
 */
export function parseCondition(vyraz) {
  if (typeof vyraz !== 'string' || vyraz.trim() === '') {
    throw new Error('podmínka je prázdná');
  }
  const orGroups = vyraz.split(/\bnebo\b/).map((g) => g.trim());
  const skupiny = orGroups.map((group) => {
    if (group === '') throw new Error(`prázdná větev „nebo" ve výrazu „${vyraz}"`);
    const andTerms = group.split(/\ba\b/).map((t) => t.trim());
    const podminky = andTerms.map((term) => {
      if (term === '') throw new Error(`prázdná větev „a" ve výrazu „${vyraz}"`);
      const tokens = term.split(/\s+/);
      if (tokens.length === 1) {
        return { metrika: assertMetric(tokens[0], vyraz), op: null, hodnota: null };
      }
      if (tokens.length === 3) {
        const [metrika, op, raw] = tokens;
        if (!OPERATORS.includes(op)) {
          throw new Error(`neznámý operátor „${op}" ve výrazu „${vyraz}" (povolené: ${OPERATORS.join(', ')})`);
        }
        return { metrika: assertMetric(metrika, vyraz), op, hodnota: parseValue(raw) };
      }
      throw new Error(`nesrozumitelný člen „${term}" ve výrazu „${vyraz}" (očekávám „metrika operátor hodnota" nebo holou metriku)`);
    });
    return { typ: /** @type {const} */ ('a'), podminky };
  });
  return { typ: 'nebo', skupiny };
}

/** @param {string} name @param {string} vyraz */
function assertMetric(name, vyraz) {
  if (!KNOWN_METRICS.includes(name)) {
    throw new Error(`neznámá metrika „${name}" ve výrazu „${vyraz}" (povolené: ${KNOWN_METRICS.join(', ')})`);
  }
  return name;
}

/** @param {string} raw @returns {number|boolean|string} */
function parseValue(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  return raw; // identifikátor, např. tag `utek`
}

/**
 * Vyhodnotí naparsovanou podmínku nad metrikami.
 *
 * @param {ReturnType<typeof parseCondition>} ast
 * @param {ReturnType<typeof deriveGoalMetrics>} metriky
 * @returns {boolean}
 */
export function evalCondition(ast, metriky) {
  return ast.skupiny.some((skupina) =>
    skupina.podminky.every((p) => {
      const hodnota = lookupMetric(metriky, p.metrika);
      if (p.op === null) return Boolean(hodnota);
      switch (p.op) {
        case '==': return hodnota === p.hodnota;
        case '!=': return hodnota !== p.hodnota;
        case '>=': return Number(hodnota) >= Number(p.hodnota);
        case '<=': return Number(hodnota) <= Number(p.hodnota);
        case '>': return Number(hodnota) > Number(p.hodnota);
        case '<': return Number(hodnota) < Number(p.hodnota);
        default: return false;
      }
    })
  );
}

/** @param {object} metriky @param {string} cesta např. `pocet_tag.nasili` */
function lookupMetric(metriky, cesta) {
  return cesta.split('.').reduce((obj, klic) => obj?.[klic], metriky);
}

/**
 * Obodování tajných cílů na konci runu (payload run_ended.cile).
 *
 * Mechanické cíle se vyhodnotí z metrik logu; textové (např. mozek-operace)
 * se nebodují — `splnen: null` a flag `textovy: true` (splnění pozná až
 * člověk z protokolu, viz obsah/cile.yaml).
 *
 * @param {object[]} events
 * @param {{postavaId: string, cil: object}[]} prirazeni
 * @returns {{postava: string, cil: string, textovy: boolean,
 *   splnen: boolean|null, body: number}[]}
 */
export function scoreGoals(events, prirazeni) {
  return prirazeni.map(({ postavaId, cil }) => {
    if (cil.overeni_typ === 'textovy') {
      return { postava: postavaId, cil: cil.id, textovy: true, splnen: null, body: 0 };
    }
    const metriky = deriveGoalMetrics(events, postavaId);
    const splnen = evalCondition(parseCondition(cil.podminka), metriky);
    return {
      postava: postavaId,
      cil: cil.id,
      textovy: false,
      splnen,
      body: splnen ? cil.body : 0,
    };
  });
}
