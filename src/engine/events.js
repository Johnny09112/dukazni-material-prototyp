// @ts-check
/**
 * Událostní log enginu v3 (architektura.md §2.2 v3, ADR-008) + odvození
 * metrik tajných cílů z logu a parser/vyhodnocení `podminka` výrazů
 * (obsah/cile.yaml).
 *
 * **Jeden log, tři konzumenti** (ADR-008): (a) gate-metriky K1–K9 simulační
 * brány, (b) strojové `podminka` tajných cílů, (c) `max_achievable_band`.
 * Log je append-only a JSONL-serializovatelný; každá událost má `seq`,
 * `type`, `nodeIndex` a payload. UI i simulátor čtou tentýž log.
 */

/** Typy událostí — přesně dle tabulky architektura.md §2.2 v3. */
export const EVENT = /** @type {const} */ ({
  RUN_STARTED: 'run_started',
  MAP_MOVE: 'map_move',
  TELEGRAF_DERIVED: 'telegraf_derived',
  COMMIT: 'commit',
  SITUATION_REVEALED: 'situation_revealed',
  ASSIGNMENT: 'assignment',
  GAMBLE: 'gamble',
  SLOT_RESOLVED: 'slot_resolved',
  BAND_RESOLVED: 'band_resolved',
  PENALTY_ADDED: 'penalty_added',
  PENALTY_EXPIRED: 'penalty_expired',
  PENALTY_HEALED: 'penalty_healed',
  CHARACTER_FOLDED: 'character_folded',
  CHARACTER_RETURNED: 'character_returned',
  CREDIT_FLOW: 'credit_flow',
  ZAR_MOVE: 'zar_move',
  GOAL_SCORED: 'goal_scored',
  RUN_ENDED: 'run_ended',
});

/** Pásma dle počtu zásahů (band_resolved.pasmo). */
export const BAND = /** @type {const} */ ({
  LOOT: '4/4_HLADCE_LOOT',
  HLADCE: '3/4_HLADCE',
  NASLEDKY: '2/4_S_NASLEDKY',
  PRUSVIH: '≤1/4_PRUSVIH',
});

/** Anotace pohybu Žáru (zar_move.duvod — POVINNÁ, architektura §2.2). */
export const ZAR_DUVOD = /** @type {const} */ ({
  PRUSVIH: 'prusvih',
  SNASLEDKY: 's_nasledky',
  HLUCNE_GANGSTER: 'hlucne_GANGSTER',
  HLUCNE_UTOK: 'hlucne_utok',
  KONFRONTACE_PREZITA: 'konfrontace_prezita',
});

/** Důvody toku kreditů (credit_flow.duvod). */
export const CREDIT_DUVOD = /** @type {const} */ ({
  TRUHLA: 'truhla',
  HLADCE_LOOT: 'hladce_loot',
  HLADCE: 'hladce',
  SMENA: 'smena',
  LECENI: 'leceni',
  ZTRATOVY_POSTIH: 'ztratovy_postih',
});

/** Příčiny konce runu (run_ended.pricina — diag D19a). */
export const END_PRICINA = /** @type {const} */ ({
  DOJEZD: 'dojezd',
  BEDNY_0: 'bedny_0',
  KONFRONTACE_PROHRA: 'konfrontace_prohra',
  JINA: 'jina',
});

/**
 * Append-only událostní log.
 * @returns {{append(type: string, nodeIndex: number, payload?: object): object,
 *   all(): object[]}}
 */
export function createLog() {
  /** @type {object[]} */
  const events = [];
  return {
    append(type, nodeIndex, payload = {}) {
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
/* Odvozené v3 metriky cílů z logu (architektura §2.2, „Odvozené metriky") */
/* ------------------------------------------------------------------ */

/** Pásma jako pole (histogram + validace). */
export const BAND_LABELS = [BAND.LOOT, BAND.HLADCE, BAND.NASLEDKY, BAND.PRUSVIH];

/**
 * Odvodí v3 metriky pro postavu vlastníka cíle z kompletního event logu.
 * Jeden dopředný průchod (slot_resolved uzlu předchází jeho band_resolved).
 *
 * ENGINE (atribuce bedny_ztracene_vlastni): PRŮŠVIH ztrácející náklad se
 * připíše každému hráči, který měl v té situaci aspoň jeden PROPADLÝ slot
 * (sdílená vina za „rozděl nejméně špatně"); ztrátový postih `ztrata_naklad`
 * se připíše postiženému. Personalizuje cíl kupecke-slovo.
 *
 * @param {object[]} events kompletní log runu (včetně run_ended)
 * @param {string} hracId
 */
export function deriveGoalMetrics(events, hracId) {
  const m = {
    doruceno: false,
    pocet_slotu_splnil: 0,
    pocet_slotu_selhal: 0,
    commitnute_stitky: { GANGSTER_viditelna: 0 },
    gamble_pouzit: 0,
    postihy_utrpene: { pocet: 0, lehke: 0, tezke: 0 },
    slozeni_krat: 0,
    kredity_utracene_za: { leceni: 0, smena: 0 },
    pasma_dosazena: Object.fromEntries(BAND_LABELS.map((b) => [b, 0])),
    bedny_ztracene_vlastni: 0,
  };

  /** nodeIndex → sloty [{hrac_id, zasah}] pro atribuci pásma a viny. */
  const slotyUzlu = new Map();

  for (const e of events) {
    switch (e.type) {
      case EVENT.SLOT_RESOLVED: {
        if (!slotyUzlu.has(e.nodeIndex)) slotyUzlu.set(e.nodeIndex, []);
        slotyUzlu.get(e.nodeIndex).push({ hrac_id: e.hrac_id, zasah: e.zasah });
        if (e.hrac_id === hracId) {
          if (e.zasah) m.pocet_slotu_splnil += 1;
          else m.pocet_slotu_selhal += 1;
          if (e.viditelnost === 'viditelna' && (e.stitky ?? []).includes('GANGSTER')) {
            m.commitnute_stitky.GANGSTER_viditelna += 1;
          }
        }
        break;
      }
      case EVENT.BAND_RESOLVED: {
        const sloty = slotyUzlu.get(e.nodeIndex) ?? [];
        const meloKartu = sloty.some((s) => s.hrac_id === hracId);
        if (meloKartu && e.pasmo in m.pasma_dosazena) m.pasma_dosazena[e.pasmo] += 1;
        if ((e.naklad_ztrata ?? 0) > 0 && sloty.some((s) => s.hrac_id === hracId && !s.zasah)) {
          m.bedny_ztracene_vlastni += e.naklad_ztrata;
        }
        break;
      }
      case EVENT.PENALTY_ADDED:
        if (e.hrac_id === hracId) {
          m.postihy_utrpene.pocet += 1;
          if (e.tier === 'lehky') m.postihy_utrpene.lehke += 1;
          else if (e.tier === 'tezky') m.postihy_utrpene.tezke += 1;
          if (e.efekt?.druh === 'ztrata_naklad') m.bedny_ztracene_vlastni += e.efekt.kolik ?? 1;
        }
        break;
      case EVENT.GAMBLE:
        if (e.ci_ruka === hracId) m.gamble_pouzit += 1;
        break;
      case EVENT.CHARACTER_FOLDED:
        if (e.hrac_id === hracId) m.slozeni_krat += 1;
        break;
      case EVENT.CREDIT_FLOW:
        if (e.duvod === CREDIT_DUVOD.LECENI) m.kredity_utracene_za.leceni += Math.abs(e.delta ?? 0);
        else if (e.duvod === CREDIT_DUVOD.SMENA) m.kredity_utracene_za.smena += Math.abs(e.delta ?? 0);
        break;
      case EVENT.RUN_ENDED:
        m.doruceno = e.vysledek === 'DORUCENO';
        break;
    }
  }
  return m;
}

/* ------------------------------------------ */
/* Parser a vyhodnocení `podminka` výrazů      */
/* ------------------------------------------ */

/**
 * Specifikace povolených metrik pro `podminka` (viz hlavička obsah/cile.yaml).
 * `leaf` = holá metrika; `keys` = povolené tečkové podklíče; `bandKeys` =
 * závorkový klíč musí být validní pásmo.
 */
const METRIC_SPEC = {
  doruceno: { leaf: true },
  pocet_slotu_splnil: { leaf: true },
  pocet_slotu_selhal: { leaf: true },
  gamble_pouzit: { leaf: true },
  slozeni_krat: { leaf: true },
  bedny_ztracene_vlastni: { leaf: true },
  commitnute_stitky: { keys: ['GANGSTER_viditelna'] },
  postihy_utrpene: { keys: ['pocet', 'lehke', 'tezke'] },
  kredity_utracene_za: { keys: ['leceni', 'smena'] },
  pasma_dosazena: { bandKeys: true },
};

const OPERATORS = ['==', '!=', '>=', '<=', '>', '<'];

/**
 * Rozloží cestu metriky na segmenty: `a`, `a.b`, `a["b"]`, `a.b["c"]`.
 * @param {string} cesta
 * @returns {string[]}
 */
function pathSegments(cesta) {
  const head = /^[A-Za-z_][A-Za-z0-9_]*/.exec(cesta);
  if (!head) return [];
  /** @type {string[]} */
  const segs = [head[0]];
  let rest = cesta.slice(head[0].length);
  while (rest.length > 0) {
    const dot = /^\.([A-Za-z_][A-Za-z0-9_]*)/.exec(rest);
    const brk = /^\["([^"]+)"\]/.exec(rest);
    if (dot) {
      segs.push(dot[1]);
      rest = rest.slice(dot[0].length);
    } else if (brk) {
      segs.push(brk[1]);
      rest = rest.slice(brk[0].length);
    } else {
      return []; // nerozpoznaný zbytek → neplatná cesta
    }
  }
  return segs;
}

/**
 * Parser výrazů tvaru `metrika op hodnota` spojených `a`/`nebo`.
 * Precedence: `a` váže těsněji než `nebo`. Holá metrika = test pravdivosti.
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
  const segs = pathSegments(name);
  const spec = segs.length > 0 ? METRIC_SPEC[segs[0]] : undefined;
  if (!spec) {
    throw new Error(`neznámá metrika „${name}" ve výrazu „${vyraz}" (povolené: ${Object.keys(METRIC_SPEC).join(', ')})`);
  }
  if (spec.leaf) {
    if (segs.length !== 1) throw new Error(`metrika „${segs[0]}" nemá podklíče (výraz „${vyraz}")`);
  } else if (spec.bandKeys) {
    if (segs.length !== 2 || !BAND_LABELS.includes(segs[1])) {
      throw new Error(`neznámé pásmo „${segs[1] ?? ''}" u „${segs[0]}" ve výrazu „${vyraz}" (povolená: ${BAND_LABELS.join(', ')})`);
    }
  } else if (spec.keys) {
    if (segs.length !== 2 || !spec.keys.includes(segs[1])) {
      throw new Error(`neznámý podklíč „${segs[1] ?? ''}" u „${segs[0]}" ve výrazu „${vyraz}" (povolené: ${spec.keys.join(', ')})`);
    }
  }
  return name;
}

/** @param {string} raw @returns {number|boolean|string} */
function parseValue(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  return raw;
}

/**
 * Vyhodnotí naparsovanou podmínku nad metrikami.
 * @param {ReturnType<typeof parseCondition>} ast
 * @param {object} metriky
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

/** @param {object} metriky @param {string} cesta např. `pasma_dosazena["4/4_HLADCE_LOOT"]` */
function lookupMetric(metriky, cesta) {
  return pathSegments(cesta).reduce((obj, klic) => (obj == null ? undefined : obj[klic]), metriky);
}

/**
 * Obodování tajných cílů na konci runu (payload goal_scored / run_ended).
 * Mechanické cíle se vyhodnotí z metrik; textové se nebodují (splnen null).
 *
 * @param {object[]} events
 * @param {{postavaId: string, cil: object}[]} prirazeni
 */
export function scoreGoals(events, prirazeni) {
  return prirazeni.map(({ postavaId, cil }) => {
    if (cil.overeni_typ === 'textovy') {
      return { postava: postavaId, cil: cil.id, textovy: true, splnen: null, body: 0 };
    }
    const metriky = deriveGoalMetrics(events, postavaId);
    const splnen = evalCondition(parseCondition(cil.podminka), metriky);
    return { postava: postavaId, cil: cil.id, textovy: false, splnen, body: splnen ? cil.body : 0 };
  });
}
