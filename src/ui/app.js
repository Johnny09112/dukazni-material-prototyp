// @ts-check
/**
 * Řízení obrazovek hot-seat UI (architektura §2.4, §6): UI je nejtenčí vrstva —
 * drží jen stav prezentace (jaká obrazovka, co už bylo vyklepáno), veškerý
 * herní stav žije v enginu a UI je re-render nad jeho snapshotem.
 *
 * Náhoda v UI vrstvě (seed bez zadání, losování šablon) smí používat
 * Math.random — deterministický musí být jen engine (ADR-002).
 */
import { load } from 'js-yaml';

import kartyYaml from '../../content/obsah/karty.yaml?raw';
import uzlyYaml from '../../content/obsah/uzly.yaml?raw';
import cileYaml from '../../content/obsah/cile.yaml?raw';
import pronasledovateleYaml from '../../content/obsah/pronasledovatele.yaml?raw';
import postavyYaml from '../../content/obsah/postavy.yaml?raw';
import sablonyYaml from '../../content/prompty/fallback-sablony.yaml?raw';

import { parseContent } from '../content/loader.js';
import { RULES } from '../engine/rules.js';
import { createRun } from '../engine/state.js';
import { EVENT } from '../engine/events.js';
import { effectiveStrength, noisyHeat } from '../engine/resolve.js';

import { createVyberSablon, zapisUzlu, zapisFinale, opravUvozovkySablon } from './protocol-fill.js';
import { obrazovkaSetup } from './screens/setup.js';
import { obrazovkaRun } from './screens/run.js';
import { obrazovkaKonec } from './screens/end.js';
import { h } from './dom.js';

/** @param {HTMLElement} root */
export function initApp(root) {
  const content = parseContent({
    karty: kartyYaml,
    uzly: uzlyYaml,
    cile: cileYaml,
    pronasledovatele: pronasledovateleYaml,
  });
  /** @type {{id: string, jmeno: string, flavor: string}[]} */
  const postavy = load(postavyYaml).postavy;
  const sablony = load(opravUvozovkySablon(sablonyYaml)).sablony;

  /** Stav UI vrstvy (prezentace, ne hra). */
  const S = novyStav();

  function novyStav() {
    return {
      obrazovka: /** @type {'setup'|'run'|'konec'} */ ('setup'),
      setup: { pocet: 2, vybrane: /** @type {string[]} */ ([]), seedText: '' },
      /** @type {ReturnType<typeof createRun>|null} */ run: null,
      /** @type {number|null} */ seed: null,
      /** @type {Record<string, string>} */ jmena: {},
      vyber: createVyberSablon(sablony, Math.random),
      /** Hotové sekce protokolu: {cislo, druh, titulek, odstavce[]}. */
      protokol: /** @type {any[]} */ ([]),
      /** Fronta výsledků uzlů k zobrazení: {udalost, checks, sekce, vyklepano}. */
      fronta: /** @type {any[]} */ ([]),
      lastSeq: 0,
      briefing: false,
      /** @type {string|null} */ odkrytyCil: null,
      /** Hlasy z auta aktuálního uzlu — engine je neloguje, eviduje UI. */
      hlasyUzlu: /** @type {any[]} */ ([]),
      bufferChecks: /** @type {any[]} */ ([]),
      bufferKolapsy: /** @type {any[]} */ ([]),
      /** @type {any|null} */ konec: null,
      finaleVyklepano: false,
    };
  }

  /** Zpracuje nové události z logu enginu do sekcí protokolu a fronty výsledků. */
  function sync() {
    if (!S.run) return;
    for (const udalost of S.run.getEvents()) {
      if (udalost.seq <= S.lastSeq) continue;
      S.lastSeq = udalost.seq;
      if (udalost.type === EVENT.CHECK_RESOLVED) {
        S.bufferChecks.push(udalost);
      } else if (udalost.type === EVENT.CHARACTER_DOWN) {
        S.bufferKolapsy.push(udalost);
      } else if (udalost.type === EVENT.NODE_RESOLVED) {
        const odstavce = zapisUzlu(
          udalost,
          { kolapsy: S.bufferKolapsy, hlasy: S.hlasyUzlu },
          { jmena: S.jmena },
          S.vyber
        );
        const sekce = {
          cislo: S.protokol.length + 1,
          druh: udalost.druh,
          titulek: udalost.nazev ?? udalost.uzel,
          odstavce,
        };
        S.protokol.push(sekce);
        S.fronta.push({ udalost, checks: S.bufferChecks, sekce, vyklepano: false });
        S.bufferChecks = [];
        S.bufferKolapsy = [];
        S.hlasyUzlu = [];
      } else if (udalost.type === EVENT.RUN_ENDED) {
        S.konec = udalost;
        S.protokol.push({
          cislo: null,
          druh: 'finale',
          titulek: udalost.vysledek === 'DORUCENO' ? 'Uzavření spisu — DORUČENO' : 'Odložení spisu — NEVYŘEŠENO',
          odstavce: zapisFinale(udalost, S.vyber),
        });
      }
    }
  }

  /** Obal příkazu enginu: provede, synchronizuje log, překreslí. @param {() => void} fn */
  function prikaz(fn) {
    try {
      fn();
    } catch (chyba) {
      // UI hlídá legálnost předem; sem spadne jen programátorská chyba.
      console.error(chyba);
    }
    sync();
    render();
  }

  const akce = {
    /* --- setup --- */
    zmenPocet(/** @type {number} */ n) {
      S.setup.pocet = n;
      S.setup.vybrane = S.setup.vybrane.slice(0, n);
      render();
    },
    prepniPostavu(/** @type {string} */ id) {
      const i = S.setup.vybrane.indexOf(id);
      if (i >= 0) S.setup.vybrane.splice(i, 1);
      else if (S.setup.vybrane.length < S.setup.pocet) S.setup.vybrane.push(id);
      render();
    },
    zmenSeed(/** @type {string} */ text) {
      S.setup.seedText = text;
      render();
    },
    otevriSpis() {
      const zadany = S.setup.seedText.trim();
      S.seed = zadany === '' ? Math.floor(Math.random() * 0xffffffff) : Number(zadany) >>> 0;
      const players = S.setup.vybrane.map((id) => {
        const p = postavy.find((x) => x.id === id);
        return { id: p.id, jmeno: p.jmeno };
      });
      S.jmena = Object.fromEntries(players.map((p) => [p.id, p.jmeno]));
      S.run = createRun({ seed: S.seed, content, rules: RULES, players });
      S.obrazovka = 'run';
      S.briefing = true;
      sync();
      render();
    },

    /* --- briefing --- */
    odkryjCil(/** @type {string} */ id) {
      S.odkrytyCil = S.odkrytyCil === id ? null : id;
      render();
    },
    vyraz() {
      S.briefing = false;
      S.odkrytyCil = null;
      render();
    },

    /* --- příkazy enginu --- */
    zvolCestu(/** @type {string} */ id) {
      prikaz(() => S.run.chooseRoute(id));
    },
    zahraj(/** @type {string} */ postavaId, /** @type {string} */ kartaId) {
      prikaz(() => S.run.playCard(postavaId, kartaId));
    },
    hlasuj(/** @type {string} */ postavaId, /** @type {string} */ volba, /** @type {string} */ cil) {
      prikaz(() => {
        S.run.chooseVoice(postavaId, { volba, cil });
        S.hlasyUzlu.push({ postava: postavaId, volba, cil });
      });
    },
    potvrd() {
      prikaz(() => S.run.confirmNode());
    },
    rider(/** @type {string} */ postavaId, /** @type {string} */ volba) {
      prikaz(() => S.run.chooseRider(postavaId, volba));
    },

    /* --- tok obrazovek --- */
    pokracuj() {
      S.fronta.shift();
      if (S.fronta.length === 0 && S.konec) S.obrazovka = 'konec';
      render();
    },
    novyRun() {
      Object.assign(S, novyStav());
      render();
    },

    /* --- export událostního logu (surovina lidské brány) --- */
    exportLog() {
      if (!S.run) return;
      const jsonl = S.run.getEvents().map((u) => JSON.stringify(u)).join('\n');
      const blob = new Blob([jsonl], { type: 'application/x-ndjson' });
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: `dukazni-material-run-${S.seed}.jsonl` });
      a.click();
      URL.revokeObjectURL(url);
    },
  };

  function render() {
    /** @type {HTMLElement} */
    let el;
    if (S.obrazovka === 'setup') {
      el = obrazovkaSetup({ postavy, setup: S.setup, akce });
    } else if (S.obrazovka === 'konec') {
      el = obrazovkaKonec({ S, content, akce });
    } else {
      const st = S.run.getState();
      el = obrazovkaRun({
        S,
        st,
        content,
        rules: RULES,
        akce,
        legalni: (postavaId) => S.run.getLegalPlays(postavaId),
        efektivniSila: (karta, druh) => effectiveStrength(karta, druh, st.pronasledovatel.id),
        cenaHlucne: noisyHeat(st.pronasledovatel.id, RULES),
      });
    }
    root.replaceChildren(el);
  }

  render();
}
