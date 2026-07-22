// @ts-check
/**
 * Agregace a report simulačních dávek (architektura.md §3): summary.json
 * + čitelný summary.md — win-rate a příčiny konce, histogram uzlu prahů Žáru,
 * křivka zranění per uzel (snowball), křivka beden, kanály ztrát beden,
 * splnitelnost cílů, srovnávací tabulka strategií.
 */

/**
 * Vytáhne z událostního logu jednoho runu statistiky pro agregaci.
 * @param {object[]} events kompletní log runu
 */
export function collectRunStats(events) {
  const stats = {
    vysledek: null,
    pricina: null,
    pocetUzlu: 0,
    /** @type {{prah: number, nodeIndex: number}[]} */
    prahy: [],
    /** @type {Record<number, number>} zranění přidaná v uzlu N */
    zraneniPerNode: {},
    /** @type {Record<number, number>} bedny po dokončení uzlu N */
    bednyPoUzlu: {},
    /** @type {Record<string, number>} */
    ztratyKanaly: {},
    /** @type {object[]} */
    cile: [],
    kolapsy: 0,
    lecky: 0,
    konfrontace: 0,
    zatahy: 0,
    zoufaleZahrane: 0,
  };

  for (const e of events) {
    switch (e.type) {
      case 'card_played':
        if (e.zoufala) stats.zoufaleZahrane += 1;
        break;
      case 'heat_threshold':
        stats.prahy.push({ prah: e.prah, nodeIndex: e.nodeIndex });
        break;
      case 'injury_added':
        stats.zraneniPerNode[e.nodeIndex] = (stats.zraneniPerNode[e.nodeIndex] ?? 0) + 1;
        break;
      case 'crate_lost':
        stats.ztratyKanaly[e.duvod] = (stats.ztratyKanaly[e.duvod] ?? 0) + 1;
        break;
      case 'character_down':
        stats.kolapsy += 1;
        break;
      case 'ambush_inserted':
        stats.lecky += 1;
        break;
      case 'confrontation_started':
        stats.konfrontace += 1;
        break;
      case 'route_chosen':
        if (e.zatah) stats.zatahy += 1;
        break;
      case 'node_resolved':
        if (e.druh === 'uzel' || e.druh === 'zatah') {
          stats.bednyPoUzlu[e.nodeIndex] = e.zbyvaBeden;
        }
        break;
      case 'run_ended':
        stats.vysledek = e.vysledek;
        stats.pricina = e.pricina;
        stats.pocetUzlu = e.pocetUzlu;
        stats.cile = e.cile;
        break;
    }
  }
  return stats;
}

/**
 * Agregát jedné konfigurace (strategie × pronásledovatel × varianta pravidel).
 * @param {string} strategie @param {string} pronasledovatel
 * @param {string} [varianta] popisek varianty rules (např. "zoufale=pool,buff=1")
 */
export function createAggregate(strategie, pronasledovatel, varianta = '') {
  return {
    strategie,
    pronasledovatel,
    varianta,
    zoufaleZahrane: 0,
    runs: 0,
    doruceno: 0,
    priciny: /** @type {Record<string, number>} */ ({}),
    delkyRunu: /** @type {Record<number, number>} */ ({}),
    /** histogramy uzlu 1./2./3. překročení prahu Žáru */
    prahHistogramy: [{}, {}, {}].map(() => /** @type {Record<number, number>} */ ({})),
    runsBezPrahu: 0,
    zraneniPerNode: /** @type {Record<number, {sum: number, runs: number}>} */ ({}),
    bednyPoUzlu: /** @type {Record<number, {sum: number, runs: number}>} */ ({}),
    ztratyKanaly: /** @type {Record<string, number>} */ ({}),
    cile: /** @type {Record<string, {prirazeno: number, splneno: number, textovy: boolean}>} */ ({}),
    kolapsyCelkem: 0,
    runsSKolapsem: 0,
    lecky: 0,
    konfrontace: 0,
    zatahy: 0,
  };
}

/** @param {ReturnType<typeof createAggregate>} agg @param {ReturnType<typeof collectRunStats>} s */
export function addRun(agg, s) {
  agg.runs += 1;
  if (s.vysledek === 'DORUCENO') agg.doruceno += 1;
  agg.priciny[s.pricina] = (agg.priciny[s.pricina] ?? 0) + 1;
  agg.delkyRunu[s.pocetUzlu] = (agg.delkyRunu[s.pocetUzlu] ?? 0) + 1;

  s.prahy.slice(0, 3).forEach((p, i) => {
    agg.prahHistogramy[i][p.nodeIndex] = (agg.prahHistogramy[i][p.nodeIndex] ?? 0) + 1;
  });
  if (s.prahy.length === 0) agg.runsBezPrahu += 1;

  for (const [node, pocet] of Object.entries(s.zraneniPerNode)) {
    const z = (agg.zraneniPerNode[node] ??= { sum: 0, runs: 0 });
    z.sum += pocet;
  }
  // jmenovatel křivek: kolik runů daný uzel vůbec odehrálo
  for (let n = 1; n <= Math.max(s.pocetUzlu, 1); n++) {
    (agg.zraneniPerNode[n] ??= { sum: 0, runs: 0 }).runs += 1;
  }
  for (const [node, bedny] of Object.entries(s.bednyPoUzlu)) {
    const b = (agg.bednyPoUzlu[node] ??= { sum: 0, runs: 0 });
    b.sum += bedny;
    b.runs += 1;
  }
  for (const [kanal, pocet] of Object.entries(s.ztratyKanaly)) {
    agg.ztratyKanaly[kanal] = (agg.ztratyKanaly[kanal] ?? 0) + pocet;
  }
  for (const c of s.cile) {
    const zaznam = (agg.cile[c.cil] ??= { prirazeno: 0, splneno: 0, textovy: c.textovy });
    zaznam.prirazeno += 1;
    if (c.splnen === true) zaznam.splneno += 1;
  }
  agg.kolapsyCelkem += s.kolapsy;
  if (s.kolapsy > 0) agg.runsSKolapsem += 1;
  agg.lecky += s.lecky;
  agg.konfrontace += s.konfrontace;
  agg.zatahy += s.zatahy;
  agg.zoufaleZahrane += s.zoufaleZahrane;
}

/** Medián uzlu prvního prahu Žáru (jen runy, kde práh padl). */
export function medianFirstThreshold(agg) {
  const hist = agg.prahHistogramy[0];
  const celkem = Object.values(hist).reduce((a, b) => a + b, 0);
  if (celkem === 0) return null;
  const cilovy = celkem / 2;
  let kumulativ = 0;
  for (const node of Object.keys(hist).map(Number).sort((a, b) => a - b)) {
    kumulativ += hist[node];
    if (kumulativ >= cilovy) return node;
  }
  return null;
}

/** @param {ReturnType<typeof createAggregate>} agg */
export function finalizeAggregate(agg) {
  const pct = (x) => (agg.runs > 0 ? +((100 * x) / agg.runs).toFixed(1) : 0);
  return {
    strategie: agg.strategie,
    pronasledovatel: agg.pronasledovatel,
    varianta: agg.varianta,
    zoufaleNaRun: agg.runs > 0 ? +(agg.zoufaleZahrane / agg.runs).toFixed(2) : 0,
    runs: agg.runs,
    dorucenoPct: pct(agg.doruceno),
    priciny: Object.fromEntries(
      Object.entries(agg.priciny).map(([k, v]) => [k, pct(v)])
    ),
    delkyRunu: agg.delkyRunu,
    medianPrvnihoPrahu: medianFirstThreshold(agg),
    runsBezPrahuPct: pct(agg.runsBezPrahu),
    prahHistogramy: agg.prahHistogramy,
    zraneniKrivka: krivka(agg.zraneniPerNode),
    bednyKrivka: krivka(agg.bednyPoUzlu),
    ztratyKanaly: agg.ztratyKanaly,
    cile: Object.fromEntries(
      Object.entries(agg.cile).map(([id, c]) => [
        id,
        {
          prirazeno: c.prirazeno,
          splneno: c.splneno,
          splnenoPct: c.textovy
            ? null
            : c.prirazeno > 0
              ? +((100 * c.splneno) / c.prirazeno).toFixed(1)
              : null,
          textovy: c.textovy,
        },
      ])
    ),
    kolapsyNaRun: agg.runs > 0 ? +(agg.kolapsyCelkem / agg.runs).toFixed(2) : 0,
    runsSKolapsemPct: pct(agg.runsSKolapsem),
    leckyNaRun: agg.runs > 0 ? +(agg.lecky / agg.runs).toFixed(2) : 0,
    konfrontaceNaRun: agg.runs > 0 ? +(agg.konfrontace / agg.runs).toFixed(2) : 0,
    zatahyNaRun: agg.runs > 0 ? +(agg.zatahy / agg.runs).toFixed(2) : 0,
  };
}

/** @param {Record<number, {sum: number, runs: number}>} data */
function krivka(data) {
  return Object.fromEntries(
    Object.keys(data)
      .map(Number)
      .sort((a, b) => a - b)
      .map((n) => [n, data[n].runs > 0 ? +(data[n].sum / data[n].runs).toFixed(2) : 0])
  );
}

/**
 * Čitelný summary.md (česky) ze seznamu finalizovaných agregátů.
 * @param {object} meta {seedOd, runsNaKonfiguraci, hracu, verzeObsahu, verzePravidel}
 * @param {ReturnType<typeof finalizeAggregate>[]} vysledky
 */
export function renderSummaryMd(meta, vysledky) {
  const r = [];
  r.push('# Simulační dávka — souhrn');
  r.push('');
  r.push(`- Runů na konfiguraci: **${meta.runsNaKonfiguraci}**, hráčů: **${meta.hracu}**, seedy od ${meta.seedOd}`);
  r.push(`- Verze obsahu: \`${meta.verzeObsahu}\`, pravidla: ${meta.verzePravidel}`);
  r.push('');
  r.push('## Srovnání konfigurací');
  r.push('');
  r.push('| Varianta | Strategie | Pronásledovatel | DORUČENO % | došly bedny % | všichni vyřazeni % | medián 1. prahu Žáru (uzel) | zoufalé/run | kolapsů/run | samou-modrinu % | obetni-beranek % |');
  r.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const v of vysledky) {
    r.push(
      `| ${v.varianta || '—'} | ${v.strategie} | ${v.pronasledovatel} | ${v.dorucenoPct} | ${v.priciny.dosly_bedny ?? 0} | ${v.priciny.vsichni_vyrazeni ?? 0} | ${v.medianPrvnihoPrahu ?? '—'} | ${v.zoufaleNaRun} | ${v.kolapsyNaRun} | ${v.cile['samou-modrinu']?.splnenoPct ?? '—'} | ${v.cile['obetni-beranek']?.splnenoPct ?? '—'} |`
    );
  }
  r.push('');
  for (const v of vysledky) {
    r.push(`## ${v.varianta ? `${v.varianta} · ` : ''}${v.strategie} × ${v.pronasledovatel}`);
    r.push('');
    r.push(`- Runů: ${v.runs}, DORUČENO ${v.dorucenoPct} %, bez prahu Žáru ${v.runsBezPrahuPct} % runů`);
    r.push(`- Histogram uzlu 1. prahu: ${histText(v.prahHistogramy[0])}`);
    r.push(`- Histogram uzlu 2. prahu: ${histText(v.prahHistogramy[1])}`);
    r.push(`- Histogram uzlu 3. prahu: ${histText(v.prahHistogramy[2])}`);
    r.push(`- Zranění přidaná per uzel (křivka snowballu): ${krivkaText(v.zraneniKrivka)}`);
    r.push(`- Bedny po uzlu (průměr): ${krivkaText(v.bednyKrivka)}`);
    r.push(`- Kanály ztrát beden: ${kanalyText(v.ztratyKanaly)}`);
    r.push(`- Splnitelnost cílů: ${cileText(v.cile)}`);
    r.push('');
  }
  return r.join('\n');
}

function histText(hist) {
  const klice = Object.keys(hist).map(Number).sort((a, b) => a - b);
  if (klice.length === 0) return '—';
  return klice.map((k) => `uzel ${k}: ${hist[k]}`).join(', ');
}

function krivkaText(krivkaData) {
  const klice = Object.keys(krivkaData).map(Number).sort((a, b) => a - b);
  if (klice.length === 0) return '—';
  return klice.map((k) => `u${k}: ${krivkaData[k]}`).join(', ');
}

function kanalyText(kanaly) {
  const zaznamy = Object.entries(kanaly);
  if (zaznamy.length === 0) return '—';
  const celkem = zaznamy.reduce((a, [, v]) => a + v, 0);
  return zaznamy
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}: ${v} (${((100 * v) / celkem).toFixed(0)} %)`)
    .join(', ');
}

function cileText(cile) {
  const zaznamy = Object.entries(cile);
  if (zaznamy.length === 0) return '—';
  return zaznamy
    .sort()
    .map(([id, c]) =>
      c.textovy ? `${id}: textový (nebodováno)` : `${id}: ${c.splnenoPct} % (${c.splneno}/${c.prirazeno})`
    )
    .join(', ');
}
