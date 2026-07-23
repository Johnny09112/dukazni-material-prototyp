// @ts-check
/**
 * Headless v3 simulátor — CLI dávky slotových runů nad enginem (architektura §3,
 * prototyp-mvp.md Fáze 0). Měří metriky brány K1–K9.
 *
 * Použití:
 *   npm run sim -- --runs 2000 --players 4 --strategy kompetentni \
 *     --pursuer agent-malone,serif-brody --seed 1 [--events] [--out logs/moje-davka]
 *
 * `--strategy` je preset (random | naivni | kompetentni | cile | oracle |
 * memorizacni | monokultura) NEBO ho lze složit z os --commit/--assign/--econ.
 * Každá dávka = {verze obsahu, verze pravidel, strategie, pronásledovatel,
 * rozsah seedů} — plně reprodukovatelná. Simulátor nevolá LLM ani fallbacky.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseContent } from '../src/content/loader.js';
import { RULES } from '../src/engine/rules.js';
import { createRun } from '../src/engine/state.js';
import { createStrategy } from './strategies.js';
import { collectRunStats, createAggregate, addRun, finalizeAggregate, renderSummaryMd } from './report.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

/** Presety strategií (osy commit × assign × econ). */
export const PRESETY = {
  random: { commit: 'naivni', assign: 'random', econ: 'hoard', gamble: false },
  naivni: { commit: 'naivni', assign: 'greedy', econ: 'adaptivni', gamble: true },
  kompetentni: { commit: 'informovany', assign: 'kompetentni', econ: 'adaptivni', gamble: true },
  cile: { commit: 'informovany', assign: 'cile', econ: 'adaptivni', gamble: true },
  oracle: { commit: 'informovany', assign: 'oracle', econ: 'adaptivni', gamble: true },
  memorizacni: { commit: 'informovany', assign: 'memorizacni', econ: 'adaptivni', gamble: true },
  monokultura: { commit: 'monokultura', assign: 'kompetentni', econ: 'adaptivni', gamble: true },
};

/* ---------------- obsah ---------------- */

/** Obsah se čte ze submodulu content/, přepsatelné přes CONTENT_DIR (ADR-005). */
export function loadContent() {
  const contentDir = process.env.CONTENT_DIR ? path.resolve(process.env.CONTENT_DIR) : path.join(REPO_ROOT, 'content');
  const obsahDir = path.join(contentDir, 'obsah');
  const precti = (soubor) => fs.readFileSync(path.join(obsahDir, soubor), 'utf8');
  return parseContent({
    veci: precti('veci.yaml'),
    situace: precti('situace.yaml'),
    postihy: precti('postihy.yaml'),
    mista: precti('mista.yaml'),
    stitky: precti('stitky.yaml'),
    pronasledovatele: precti('pronasledovatele.yaml'),
    cile: precti('cile.yaml'),
    postavy: precti('postavy.yaml'),
  });
}

/* ---------------- jeden run ---------------- */

/**
 * Odehraje jeden run danou strategií (všichni hráči táhnou stejnou strategií).
 * @param {object} opts {seed, content, rules, players, pronasledovatelId, spec}
 * @returns {object[]} kompletní událostní log runu
 */
export function playRun({ seed, content, rules = RULES, players, pronasledovatelId, spec }) {
  const run = createRun({ seed, content, rules, players, pronasledovatelId });
  const strat = createStrategy(spec, seed);
  let pojistka = 0;
  for (;;) {
    const s = run.getState();
    if (s.faze === 'ended') return run.getEvents();
    if (++pojistka > 5000) throw new Error(`playRun: run se nezastavil (fáze ${s.faze}, seed ${seed}).`);
    switch (s.faze) {
      case 'map':
        run.chooseRoute(strat.pickRoute(s));
        break;
      case 'motel_offer':
        run.motelChoice(strat.pickMotelOffer(s));
        break;
      case 'motel':
        strat.motelActions(s, run);
        break;
      case 'commit':
        strat.commit(s, run);
        break;
      case 'assign':
        strat.assign(s, run);
        break;
      default:
        throw new Error(`playRun: neznámá fáze „${s.faze}".`);
    }
  }
}

/** Odehraje dávku runů jedné konfigurace a vrátí finalizovaný souhrn. */
export function runBatch({ content, players, pronasledovatelId, spec, strategyLabel, seedOd, runs, events, rules = RULES }) {
  const agg = createAggregate();
  const jsonl = [];
  const hraci = content.postavy.slice(0, players).map((p) => ({ id: p.id, jmeno: p.jmeno }));
  for (let i = 0; i < runs; i++) {
    const seed = seedOd + i;
    const log = playRun({ seed, content, rules, players: hraci, pronasledovatelId, spec });
    addRun(agg, collectRunStats(log));
    if (events) for (const e of log) jsonl.push(JSON.stringify(e));
  }
  return {
    fin: finalizeAggregate(agg),
    jsonl,
    meta: { players, pursuer: pronasledovatelId, strategy: strategyLabel, seedOd, seedDo: seedOd + runs - 1 },
  };
}

/* ---------------- CLI ---------------- */

function parseArgs(argv) {
  const args = { runs: 200, players: 4, strategy: 'kompetentni', pursuer: 'agent-malone,serif-brody', seed: 1, events: false, out: null, commit: null, assign: null, econ: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--runs') args.runs = Number(argv[++i]);
    else if (a === '--players') args.players = Number(argv[++i]);
    else if (a === '--strategy') args.strategy = argv[++i];
    else if (a === '--pursuer') args.pursuer = argv[++i];
    else if (a === '--seed') args.seed = Number(argv[++i]);
    else if (a === '--events') args.events = true;
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--commit') args.commit = argv[++i];
    else if (a === '--assign') args.assign = argv[++i];
    else if (a === '--econ') args.econ = argv[++i];
    else throw new Error(`Neznámý argument „${a}".`);
  }
  if (!Number.isInteger(args.runs) || args.runs < 1) throw new Error('--runs musí být kladné celé číslo.');
  if (!Number.isInteger(args.players) || args.players < 1 || args.players > 4) throw new Error('--players musí být 1–4.');
  return args;
}

function specFromArgs(args) {
  const base = PRESETY[args.strategy] ?? PRESETY.kompetentni;
  return { ...base, ...(args.commit ? { commit: args.commit } : {}), ...(args.assign ? { assign: args.assign } : {}), ...(args.econ ? { econ: args.econ } : {}) };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const content = loadContent();
  const spec = specFromArgs(args);
  const pursuers = args.pursuer.split(',').map((s) => s.trim()).filter(Boolean);
  const casti = [`# v3 simulační dávka — strategie \`${args.strategy}\``];
  const jsonAll = {};
  for (const pursuer of pursuers) {
    const { fin, jsonl, meta } = runBatch({
      content,
      players: args.players,
      pronasledovatelId: pursuer,
      spec,
      strategyLabel: args.strategy,
      seedOd: args.seed,
      runs: args.runs,
      events: args.events,
    });
    const label = `${args.players}p · ${pursuer} · ${args.strategy}`;
    casti.push(renderSummaryMd({ ...meta, label }, fin));
    jsonAll[`${args.players}p_${pursuer}_${args.strategy}`] = fin;
    if (args.out && args.events) {
      fs.mkdirSync(path.join(REPO_ROOT, args.out), { recursive: true });
      fs.writeFileSync(path.join(REPO_ROOT, args.out, `events_${pursuer}.jsonl`), jsonl.join('\n'));
    }
  }
  const md = casti.join('\n');
  if (args.out) {
    fs.mkdirSync(path.join(REPO_ROOT, args.out), { recursive: true });
    fs.writeFileSync(path.join(REPO_ROOT, args.out, 'summary.md'), md);
    fs.writeFileSync(path.join(REPO_ROOT, args.out, 'summary.json'), JSON.stringify({ verzeObsahu: content.verze, verzePravidel: RULES.verze, konfigurace: jsonAll }, null, 2));
    console.log(`Hotovo → ${args.out}/summary.md`);
  } else {
    console.log(md);
  }
}

// Spustit jen jako CLI (ne při importu z testů).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
