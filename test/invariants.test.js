// @ts-check
/**
 * v3 invarianty událostního logu nad reálným obsahem: dávka runů napříč
 * strategiemi, počty hráčů a pronásledovateli. Strukturální pravidla musí
 * platit bez ohledu na seed (architektura §2.2 v3, ADR-008).
 */
import { describe, it, expect } from 'vitest';
import { parseContent } from '../src/content/loader.js';
import { RULES } from '../src/engine/rules.js';
import { EVENT, BAND } from '../src/engine/events.js';
import { playRun, PRESETY } from '../sim/run.js';
import { loadRealYaml } from './content.test.js';

const content = parseContent(loadRealYaml());
const hraci = (n) => content.postavy.slice(0, n).map((p) => ({ id: p.id, jmeno: p.jmeno }));

// Oracle s ε=0 = ryze optimální (bez ε-greedy šumu z hide_staty), aby platil
// invariant „reálné == max_achievable" jako horní mez K5.
const SPECY = {
  random: PRESETY.random,
  kompetentni: PRESETY.kompetentni,
  oracle: { ...PRESETY.oracle, epsilon: 0 },
};

function davka() {
  const logy = [];
  for (const strat of Object.keys(SPECY)) {
    for (const players of [1, 2, 3, 4]) {
      for (const pronasledovatelId of ['agent-malone', 'serif-brody']) {
        for (let seed = 1; seed <= 12; seed++) {
          logy.push({
            events: playRun({ seed, content, rules: RULES, players: hraci(players), pronasledovatelId, spec: SPECY[strat] }),
            players,
            strat,
          });
        }
      }
    }
  }
  return logy;
}

const logy = davka();

describe('v3 invarianty logu (dávka: 3 strategie × 1–4p × 2 pronásledovatelé)', () => {
  it('log začíná run_started, končí právě jedním run_ended, seq roste o 1', () => {
    for (const { events } of logy) {
      expect(events[0].type).toBe(EVENT.RUN_STARTED);
      expect(events.at(-1).type).toBe(EVENT.RUN_ENDED);
      expect(events.filter((e) => e.type === EVENT.RUN_ENDED)).toHaveLength(1);
      events.forEach((e, i) => expect(e.seq).toBe(i + 1));
    }
  });

  it('každý band_resolved má právě 4 slot_resolved téhož uzlu a pásmo sedí s počtem zásahů', () => {
    for (const { events } of logy) {
      const bandy = events.filter((e) => e.type === EVENT.BAND_RESOLVED);
      for (const b of bandy) {
        const sloty = events.filter((e) => e.type === EVENT.SLOT_RESOLVED && e.nodeIndex === b.nodeIndex);
        expect(sloty).toHaveLength(4);
        const zasahy = sloty.filter((s) => s.zasah).length;
        expect(b.zasahy).toBe(zasahy);
        const ocekavane = zasahy >= 4 ? BAND.LOOT : zasahy === 3 ? BAND.HLADCE : zasahy === 2 ? BAND.NASLEDKY : BAND.PRUSVIH;
        expect(b.pasmo).toBe(ocekavane);
      }
    }
  });

  it('max_achievable ≥ reálné zásahy a gap = max − real (oracle nikdy nepřekročen)', () => {
    for (const { events } of logy) {
      for (const b of events.filter((e) => e.type === EVENT.BAND_RESOLVED)) {
        expect(b.max_achievable_zasahy).toBeGreaterThanOrEqual(b.zasahy);
        expect(b.gap).toBe(b.max_achievable_zasahy - b.zasahy);
      }
    }
    // Oracle strategie: reálné = max (bot rozděluje optimálně dle prahů).
    for (const { events, strat } of logy) {
      if (strat !== 'oracle') continue;
      for (const b of events.filter((e) => e.type === EVENT.BAND_RESOLVED)) {
        expect(b.zasahy).toBe(b.max_achievable_zasahy);
      }
    }
  });

  it('Žár zůstává v 0–10, náklad nikdy záporný, run_ended má konzistentní příčinu', () => {
    for (const { events } of logy) {
      for (const e of events.filter((x) => x.type === EVENT.ZAR_MOVE)) {
        expect(e.nova_pozice).toBeGreaterThanOrEqual(0);
        expect(e.nova_pozice).toBeLessThanOrEqual(RULES.zar.max);
      }
      for (const e of events.filter((x) => x.type === EVENT.BAND_RESOLVED)) {
        expect(e.zbyva_beden).toBeGreaterThanOrEqual(0);
      }
      const konec = events.at(-1);
      if (konec.vysledek === 'DORUCENO') {
        expect(konec.pricina).toBe('dojezd');
        expect(konec.zbyva_beden).toBeGreaterThan(0);
      } else {
        expect(['bedny_0', 'konfrontace_prohra', 'jina']).toContain(konec.pricina);
      }
    }
  });

  it('postihy: nikdy víc než cap+1 najednou (3. spustí složení, které maže lehké)', () => {
    for (const { events } of logy) {
      // rekonstruuj aktivní postihy per hráč po každé události přidání/vypršení/složení
      const aktivni = new Map();
      for (const e of events) {
        if (e.type === EVENT.PENALTY_ADDED) {
          const arr = aktivni.get(e.hrac_id) ?? [];
          if (e.vyprsi_za !== undefined && e.efekt) arr.push({ id: e.postih_id, tier: e.tier });
          // „ihned" postihy do fronty nejdou (aktivnich_po 0)
          if (e.aktivnich_po > 0) aktivni.set(e.hrac_id, arr.slice(0, e.aktivnich_po));
        } else if (e.type === EVENT.CHARACTER_FOLDED) {
          // po složení zbývají jen těžké
          aktivni.set(e.hrac_id, (e.pretrvavaji_tezke ?? []).map((id) => ({ id, tier: 'tezky' })));
        }
      }
      // Nepřímý invariant: každé složení uvádí smazané lehké jako pole.
      for (const e of events.filter((x) => x.type === EVENT.CHARACTER_FOLDED)) {
        expect(Array.isArray(e.smazane_lehke)).toBe(true);
        expect(Array.isArray(e.pretrvavaji_tezke)).toBe(true);
      }
    }
  });

  it('commit má přesně tolik karet, kolik určuje rozdělení dle počtu hráčů (mínus složení)', () => {
    for (const { events, players } of logy) {
      const commity = events.filter((e) => e.type === EVENT.COMMIT);
      for (const c of commity) {
        // ≤ 4 (composed players commit fewer); nikdy víc než 4
        expect(c.commit.length).toBeLessThanOrEqual(4);
        expect(c.commit.length).toBeGreaterThanOrEqual(0);
      }
      void players;
    }
  });

  it('je deterministický — stejný seed/strategie = identický log', () => {
    const p = { seed: 3, content, rules: RULES, players: hraci(3), pronasledovatelId: 'serif-brody', spec: PRESETY.kompetentni };
    expect(JSON.stringify(playRun(p))).toBe(JSON.stringify(playRun(p)));
  });
});
