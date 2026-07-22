// @ts-check
/**
 * Headless simulátor — CLI dávky runů nad enginem (architektura.md §3).
 *
 * Použití:
 *   npm run sim -- --runs 2000 --players 4 \
 *     --strategy greedy-affinity,random,tag-spam:utek \
 *     --pursuer agent-malone,serif-brody --seed 1 [--events] [--out logs/moje-davka] \
 *     [--zoufale pool,pool-once,dealt,none] [--buff 1,0]
 *
 * Osy --zoufale (politika zoufalých karet) a --buff (bonus hlasu z auta)
 * vytvářejí varianty `rules` objektu (ADR-003) — kalibrace bez forku kódu.
 * Default: zoufale=pool, buff=1 (současná pravidla).
 *
 * Každá dávka = {verze obsahu, verze pravidel, strategie, pronásledovatel,
 * rozsah seedů} — plně reprodukovatelná. Výstup: <out>/summary.json +
 * <out>/summary.md; s flagem --events navíc kompletní událostní logy JSONL
 * (1 řádek = 1 událost, soubor na konfiguraci). Pozn.: JSONL je opt-in
 * (velké dávky = stovky MB), summary agreguje vždy ze všech runů.
 *
 * Simulátor nevolá LLM ani fallback šablony — protokol je pro matematiku
 * irelevantní. Textové cíle se nebodují (v summary označeny „textový").
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseContent } from '../src/content/loader.js';
import { RULES } from '../src/engine/rules.js';
import { createRun } from '../src/engine/state.js';
import { createStrategy } from './strategies.js';
import {
  collectRunStats,
  createAggregate,
  addRun,
  finalizeAggregate,
  renderSummaryMd,
} from './report.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

/* ---------------- CLI ---------------- */

function parseArgs(argv) {
  const args = {
    runs: 100,
    players: 4,
    strategy: 'greedy-affinity',
    pursuer: 'agent-malone,serif-brody',
    seed: 1,
    events: false,
    out: null,
    zoufale: 'pool',
    buff: '1',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--runs') args.runs = Number(argv[++i]);
    else if (a === '--players') args.players = Number(argv[++i]);
    else if (a === '--strategy') args.strategy = argv[++i];
    else if (a === '--pursuer') args.pursuer = argv[++i];
    else if (a === '--seed') args.seed = Number(argv[++i]);
    else if (a === '--events') args.events = true;
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--zoufale') args.zoufale = argv[++i];
    else if (a === '--buff') args.buff = argv[++i];
    else throw new Error(`Neznámý argument „${a}".`);
  }
  if (!Number.isInteger(args.runs) || args.runs < 1) throw new Error('--runs musí být kladné celé číslo.');
  if (!Number.isInteger(args.players) || args.players < 1 || args.players > 4) {
    throw new Error('--players musí být 1–4.');
  }
  return args;
}

/* ---------------- obsah ---------------- */

/** Obsah se čte ze submodulu content/, přepsatelné přes CONTENT_DIR (ADR-005). */
function loadContent() {
  const contentDir = process.env.CONTENT_DIR
    ? path.resolve(process.env.CONTENT_DIR)
    : path.join(REPO_ROOT, 'content');
  const obsahDir = path.join(contentDir, 'obsah');
  const precti = (soubor) => fs.readFileSync(path.join(obsahDir, soubor), 'utf8');
  return parseContent({
    karty: precti('karty.yaml'),
    uzly: precti('uzly.yaml'),
    cile: precti('cile.yaml'),
    pronasledovatele: precti('pronasledovatele.yaml'),
  });
}

/* ---------------- jeden run ---------------- */

/**
 * Odehraje jeden run danou strategií (všichni hráči táhnou stejnou strategií).
 * @returns {object[]} kompletní událostní log runu
 */
export function playRun({ seed, content, rules, players, pronasledovatelId, strategyName }) {
  const strategy = createStrategy(strategyName, seed, content);
  const run = createRun({ seed, content, rules, players, pronasledovatelId });
  let pojistka = 0;

  for (;;) {
    const state = run.getState();
    if (state.faze === 'ended') break;
    if (++pojistka > 5000) {
      throw new Error(`Run seed=${seed} se nezastavil (fáze ${state.faze}) — pravděpodobný bug enginu.`);
    }
    if (state.faze === 'route') {
      run.chooseRoute(strategy.chooseRoute(state));
    } else if (state.faze === 'play') {
      const cekajiciHlasy = state.setkani.hlasujici.filter(
        (id) => !state.setkani.hlasovaliPostavy.includes(id)
      );
      for (const id of cekajiciHlasy) {
        run.chooseVoice(id, strategy.chooseVoice(run.getState(), id));
      }
      const aktivni = state.postavy.filter((p) => !p.vyrazena);
      for (const postava of aktivni) {
        if (state.setkani.zahranePostavy.includes(postava.id)) continue;
        const legal = run.getLegalPlays(postava.id);
        run.playCard(postava.id, strategy.choosePlay(run.getState(), legal, postava));
      }
      run.confirmNode();
    } else if (state.faze === 'rider') {
      run.chooseRider(
        state.cekaNaRider.postava,
        strategy.chooseRider(state, state.cekaNaRider)
      );
    }
  }
  return run.getEvents();
}

/* ---------------- dávka ---------------- */

function main() {
  const args = parseArgs(process.argv.slice(2));
  const content = loadContent();
  const strategie = args.strategy.split(',').map((s) => s.trim()).filter(Boolean);
  const pronasledovatele = args.pursuer.split(',').map((s) => s.trim()).filter(Boolean);
  for (const p of pronasledovatele) {
    if (!content.pronasledovatele.some((x) => x.id === p)) {
      throw new Error(`Pronásledovatel „${p}" v obsahu není (k dispozici: ${content.pronasledovatele.map((x) => x.id).join(', ')}).`);
    }
  }
  const politikyZoufalych = args.zoufale.split(',').map((s) => s.trim()).filter(Boolean);
  const povolenePolitiky = ['pool', 'pool-once', 'dealt', 'loot-node', 'loot-injury', 'none'];
  for (const z of politikyZoufalych) {
    if (!povolenePolitiky.includes(z)) {
      throw new Error(`Neznámá politika zoufalých „${z}" (povolené: ${povolenePolitiky.join(', ')}).`);
    }
  }
  const buffy = args.buff.split(',').map((s) => Number(s.trim()));
  for (const b of buffy) {
    if (!Number.isInteger(b) || b < 0) {
      throw new Error(`--buff musí být nezáporná celá čísla (má „${args.buff}").`);
    }
  }

  const players = Array.from({ length: args.players }, (_, i) => ({
    id: `postava-${i + 1}`,
    jmeno: `Postava ${i + 1}`,
  }));

  const outDir = path.resolve(
    REPO_ROOT,
    args.out ?? path.join('logs', `sim-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  );
  fs.mkdirSync(outDir, { recursive: true });

  const zacatek = Date.now();
  const vysledky = [];

  for (const politikaZoufalych of politikyZoufalych) {
    for (const buff of buffy) {
      // Varianta pravidel jako data (ADR-003) — žádný fork resoluce.
      const rules = { ...RULES, zoufalePolitika: politikaZoufalych, hlasZAutaBonus: buff };
      const varianta = `zoufale=${politikaZoufalych},buff=${buff}`;
      for (const strategyName of strategie) {
        for (const pronasledovatelId of pronasledovatele) {
          const agg = createAggregate(strategyName, pronasledovatelId, varianta);
          /** @type {fs.WriteStream|null} */
          let eventsStream = null;
          if (args.events) {
            const soubor = `events-${varianta.replace(/[^a-z0-9-]/gi, '_')}-${strategyName.replace(/[^a-z0-9-]/gi, '_')}-${pronasledovatelId}.jsonl`;
            eventsStream = fs.createWriteStream(path.join(outDir, soubor));
          }
          for (let i = 0; i < args.runs; i++) {
            const seed = args.seed + i;
            const events = playRun({
              seed,
              content,
              rules,
              players,
              pronasledovatelId,
              strategyName,
            });
            addRun(agg, collectRunStats(events));
            if (eventsStream) {
              for (const e of events) {
                eventsStream.write(
                  `${JSON.stringify({ varianta, strategie: strategyName, pronasledovatel: pronasledovatelId, ...e })}\n`
                );
              }
            }
          }
          eventsStream?.end();
          vysledky.push(finalizeAggregate(agg));
          console.log(
            `hotovo: ${varianta} · ${strategyName} × ${pronasledovatelId} — DORUČENO ${vysledky.at(-1).dorucenoPct} % (${args.runs} runů)`
          );
        }
      }
    }
  }

  const meta = {
    seedOd: args.seed,
    runsNaKonfiguraci: args.runs,
    hracu: args.players,
    verzeObsahu: content.verze,
    verzePravidel: RULES.verze,
    varianty: { zoufale: politikyZoufalych, buff: buffy },
    trvaniMs: Date.now() - zacatek,
  };
  fs.writeFileSync(
    path.join(outDir, 'summary.json'),
    JSON.stringify({ meta, vysledky }, null, 2)
  );
  fs.writeFileSync(path.join(outDir, 'summary.md'), renderSummaryMd(meta, vysledky));
  console.log(`\nSouhrn zapsán do ${outDir} (summary.json, summary.md) za ${meta.trvaniMs} ms.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
