// @ts-check
/**
 * Agregace v3 simulačních dávek na metriky brány K1–K9 (prototyp-mvp.md Fáze 0).
 * Vstup = kompletní událostní logy runů; výstup = summary.json + čitelný md.
 */

import { EVENT, BAND, END_PRICINA } from '../src/engine/events.js';

const BANDY = [BAND.LOOT, BAND.HLADCE, BAND.NASLEDKY, BAND.PRUSVIH];

/** Statistiky jednoho runu z jeho event logu. */
export function collectRunStats(events) {
  const konec = events[events.length - 1];
  const bandy = Object.fromEntries(BANDY.map((b) => [b, 0]));
  /** @type {number[]} */ const postihyByOrdinal = [];
  /** @type {{max:number, real:number, gap:number}[]} */ const maxAchievable = [];
  let ordinal = 0;
  let prvniZatahOrdinal = null;
  let gambleCount = 0;
  let postihyCelkem = 0;

  for (const e of events) {
    switch (e.type) {
      case EVENT.SITUATION_REVEALED:
        if (e.typ_mista === 'zatah' && prvniZatahOrdinal === null) prvniZatahOrdinal = ordinal + 1;
        break;
      case EVENT.BAND_RESOLVED:
        ordinal += 1;
        bandy[e.pasmo] = (bandy[e.pasmo] ?? 0) + 1;
        maxAchievable.push({ max: e.max_achievable_zasahy, real: e.zasahy, gap: e.gap });
        break;
      case EVENT.PENALTY_ADDED:
        postihyByOrdinal[ordinal] = (postihyByOrdinal[ordinal] ?? 0) + 1;
        postihyCelkem += 1;
        break;
      case EVENT.GAMBLE:
        gambleCount += 1;
        break;
    }
  }

  return {
    vysledek: konec.vysledek,
    pricina: konec.pricina,
    pocetUzlu: konec.pocet_uzlu,
    zbyvaBeden: konec.zbyva_beden,
    konecnyZar: konec.konecny_zar,
    kredity: konec.kredity_zbytek,
    bandy,
    postihyByOrdinal,
    postihyCelkem,
    maxAchievable,
    prvniZatahOrdinal,
    gambleCount,
    cile: konec.cile ?? [],
  };
}

/** Vytvoří prázdný agregátor. */
export function createAggregate() {
  return {
    pocet: 0,
    doruceno: 0,
    pricinaProher: { [END_PRICINA.BEDNY_0]: 0, [END_PRICINA.KONFRONTACE_PROHRA]: 0, [END_PRICINA.JINA]: 0 },
    bandTotals: Object.fromEntries(BANDY.map((b) => [b, 0])),
    bandCount: 0,
    postihyRano: 0,
    postihyPozde: 0,
    zatahOrdinaly: /** @type {number[]} */ ([]),
    maxPod4: 0,
    maxDo1: 0,
    gapSum: 0,
    maxCount: 0,
    kredityList: /** @type {number[]} */ ([]),
    zarList: /** @type {number[]} */ ([]),
    uzluList: /** @type {number[]} */ ([]),
    gambleList: /** @type {number[]} */ ([]),
    gambleTotal: 0,
    cilePlneni: /** @type {Record<string, {celkem:number, splneno:number}>} */ ({}),
  };
}

/** @param {ReturnType<typeof createAggregate>} agg @param {ReturnType<typeof collectRunStats>} r */
export function addRun(agg, r) {
  agg.pocet += 1;
  if (r.vysledek === 'DORUCENO') agg.doruceno += 1;
  else agg.pricinaProher[r.pricina] = (agg.pricinaProher[r.pricina] ?? 0) + 1;
  for (const b of BANDY) agg.bandTotals[b] += r.bandy[b];
  agg.bandCount += BANDY.reduce((a, b) => a + r.bandy[b], 0);
  for (let o = 1; o <= 2; o++) agg.postihyRano += r.postihyByOrdinal[o] ?? 0;
  for (let o = 3; o <= 4; o++) agg.postihyPozde += r.postihyByOrdinal[o] ?? 0;
  if (r.prvniZatahOrdinal != null) agg.zatahOrdinaly.push(r.prvniZatahOrdinal);
  for (const m of r.maxAchievable) {
    agg.maxCount += 1;
    if (m.max < 4) agg.maxPod4 += 1;
    if (m.max <= 1) agg.maxDo1 += 1;
    agg.gapSum += m.gap;
  }
  agg.kredityList.push(r.kredity);
  agg.zarList.push(r.konecnyZar);
  agg.uzluList.push(r.pocetUzlu);
  agg.gambleList.push(r.gambleCount);
  agg.gambleTotal += r.gambleCount;
  for (const c of r.cile) {
    const slot = (agg.cilePlneni[c.cil_id ?? c.cil] ??= { celkem: 0, splneno: 0 });
    slot.celkem += 1;
    if (c.splnen === true) slot.splneno += 1;
  }
}

const pct = (a, b) => (b === 0 ? 0 : Math.round((a / b) * 1000) / 10);
function median(list) {
  if (list.length === 0) return null;
  const s = [...list].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** @param {ReturnType<typeof createAggregate>} agg */
export function finalizeAggregate(agg) {
  return {
    pocet: agg.pocet,
    winRate: pct(agg.doruceno, agg.pocet),
    pricinaProher: {
      bedny_0: agg.pricinaProher[END_PRICINA.BEDNY_0],
      konfrontace_prohra: agg.pricinaProher[END_PRICINA.KONFRONTACE_PROHRA],
      jina: agg.pricinaProher[END_PRICINA.JINA],
    },
    bandy: Object.fromEntries(BANDY.map((b) => [b, pct(agg.bandTotals[b], agg.bandCount)])),
    snowball: {
      rano_1_2: Math.round((agg.postihyRano / agg.pocet) * 100) / 100,
      pozde_3_4: Math.round((agg.postihyPozde / agg.pocet) * 100) / 100,
      pomer: agg.postihyRano === 0 ? null : Math.round((agg.postihyPozde / agg.postihyRano) * 100) / 100,
    },
    prvniZatahMedian: median(agg.zatahOrdinaly),
    zatahPodilRunu: pct(agg.zatahOrdinaly.length, agg.pocet),
    maxAchievable: {
      pod_4_4: pct(agg.maxPod4, agg.maxCount),
      do_1_4: pct(agg.maxDo1, agg.maxCount),
      prumerny_gap: agg.maxCount === 0 ? 0 : Math.round((agg.gapSum / agg.maxCount) * 100) / 100,
    },
    kreditMedian: median(agg.kredityList),
    zarMedian: median(agg.zarList),
    uzluMedian: median(agg.uzluList),
    gambleMedian: median(agg.gambleList),
    gambleTakeRate: pct(agg.gambleTotal, agg.bandCount),
    cile: Object.fromEntries(Object.entries(agg.cilePlneni).map(([id, v]) => [id, pct(v.splneno, v.celkem)])),
  };
}

/** Čitelný markdown souhrn jedné konfigurace. */
export function renderSummaryMd(meta, fin) {
  const p = fin.pricinaProher;
  const proher = fin.pocet - Math.round((fin.winRate / 100) * fin.pocet);
  return `## ${meta.label}

- **Runů:** ${fin.pocet} | seedy ${meta.seedOd}–${meta.seedDo} | ${meta.players}p | ${meta.pursuer} | strategie \`${meta.strategy}\`
- **K1 win-rate (DORUČENO):** ${fin.winRate} %
- **Rozpad proher** (${proher}): bedny-0 ${p.bedny_0} | konfrontace ${p.konfrontace_prohra} | jiná ${p.jina}
- **Pásma** (% situací): 4/4 ${fin.bandy[BAND.LOOT]} · 3/4 ${fin.bandy[BAND.HLADCE]} · 2/4 ${fin.bandy[BAND.NASLEDKY]} · ≤1/4 ${fin.bandy[BAND.PRUSVIH]}
- **K2 snowball** (postihů/run): uzel 1–2 = ${fin.snowball.rano_1_2}, uzel 3–4 = ${fin.snowball.pozde_3_4} (poměr ${fin.snowball.pomer ?? '—'})
- **K3 první Zátah** (medián pořadí uzlu): ${fin.prvniZatahMedian ?? '—'} | Zátah v ${fin.zatahPodilRunu} % runů
- **K5 max_achievable:** max<4/4 v ${fin.maxAchievable.pod_4_4} % situací · max≤1/4 v ${fin.maxAchievable.do_1_4} % · průměrný gap ${fin.maxAchievable.prumerny_gap}
- **K8 ekonomika:** medián kreditů ${fin.kreditMedian}
- **Žár** (medián konečný): ${fin.zarMedian} | **uzlů** (medián): ${fin.uzluMedian}
- **K7 gamble take-rate:** ${fin.gambleTakeRate} % situací (gate ≤ 20)
- **K9 cíle** (% splnění): ${Object.entries(fin.cile).map(([id, v]) => `${id} ${v}`).join(' · ') || '—'}
`;
}
