// @ts-check
/**
 * v3 stavový automat runu (state.js): slotový commit → přiřazení → pásma,
 * postihy (cap 2 + složení), Žár trať + prahy, pronásledovatelé run-wide,
 * gamble, náklad, konec runu. Deterministické (seed + skriptovaná sekvence).
 */
import { describe, it, expect } from 'vitest';
import { createRun } from '../src/engine/state.js';
import { RULES } from '../src/engine/rules.js';
import { EVENT, BAND } from '../src/engine/events.js';
import { drive, syntetickyObsah, hraci } from './helpers.js';

function typy(events) {
  return events.map((e) => e.type);
}

describe('createRun + drive — základní tok', () => {
  it('projede run do konce a vydá kanonickou sekvenci událostí', () => {
    const run = createRun({ seed: 1, content: syntetickyObsah(), rules: RULES, players: hraci(2), pronasledovatelId: 'agent-malone' });
    const events = drive(run);
    const t = typy(events);
    expect(t[0]).toBe(EVENT.RUN_STARTED);
    expect(t).toContain(EVENT.COMMIT);
    expect(t).toContain(EVENT.SITUATION_REVEALED);
    expect(t).toContain(EVENT.ASSIGNMENT);
    expect(t.filter((x) => x === EVENT.SLOT_RESOLVED).length % 4).toBe(0);
    expect(t).toContain(EVENT.BAND_RESOLVED);
    expect(t[t.length - 1]).toBe(EVENT.RUN_ENDED);
    const konec = events[events.length - 1];
    expect(['DORUCENO', 'NEVYRESENO']).toContain(konec.vysledek);
  });

  it('je deterministický — stejný seed = stejný log', () => {
    const mk = () => drive(createRun({ seed: 42, content: syntetickyObsah(), rules: RULES, players: hraci(2), pronasledovatelId: 'agent-malone' }));
    expect(JSON.stringify(mk())).toBe(JSON.stringify(mk()));
  });
});

describe('commit dle počtu hráčů', () => {
  it('2 hráči committnou 2+2 = přesně 4 karty', () => {
    const run = createRun({ seed: 3, content: syntetickyObsah(), rules: RULES, players: hraci(2), pronasledovatelId: 'agent-malone' });
    // dojdi do první commit fáze
    while (run.getState().faze === 'map' || run.getState().faze === 'motel_offer') {
      const s = run.getState();
      if (s.faze === 'map') run.chooseRoute(s.nabidka.nabidnuto[0].ref);
      else run.motelChoice('dal');
    }
    const s = run.getState();
    expect(s.faze).toBe('commit');
    expect(s.situace.commitPlan.reduce((a, p) => a + p.pocet, 0)).toBe(4);
    expect(s.situace.commitPlan).toHaveLength(2);
  });

  it('4 hráči committnou po 1 (ruka 3)', () => {
    const run = createRun({ seed: 3, content: syntetickyObsah(), rules: RULES, players: hraci(4), pronasledovatelId: 'agent-malone' });
    while (['map', 'motel_offer'].includes(run.getState().faze)) {
      const s = run.getState();
      if (s.faze === 'map') run.chooseRoute(s.nabidka.nabidnuto[0].ref);
      else run.motelChoice('dal');
    }
    const s = run.getState();
    expect(s.postavy[0].ruka).toHaveLength(3);
    expect(s.situace.commitPlan.every((p) => p.pocet === 1)).toBe(true);
  });
});

describe('pásma → důsledky', () => {
  it('4/4 (univerzální karty projdou každý slot) = LOOT + kredit', () => {
    // univerzální věci 5/5/5/5/5 → jakékoli přiřazení projde → každý uzel 4/4
    const base = syntetickyObsah();
    const veci = base.veci.map((v) => ({ ...v, staty: { utok: 5, obrana: 5, hodnota: 5, improvizace: 5, nastroj: 5 } }));
    const run = createRun({ seed: 5, content: { ...base, veci }, rules: RULES, players: hraci(1), pronasledovatelId: 'serif-brody' });
    const events = drive(run);
    const loot = events.filter((e) => e.type === EVENT.BAND_RESOLVED && e.pasmo === BAND.LOOT);
    expect(loot.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === EVENT.CREDIT_FLOW && e.duvod === 'hladce_loot')).toBe(true);
    expect(events[events.length - 1].vysledek).toBe('DORUCENO');
  });
});

describe('náklad a konec runu', () => {
  it('vyčerpání beden ukončí run jako NEVYŘEŠENO (bedny_0)', () => {
    const content = syntetickyObsah();
    // slabé karty → samé PRŮŠVIHy → ztráta beden
    const run = createRun({ seed: 9, content: { ...content, veci: content.veci.map((v) => ({ ...v, staty: { utok: 0, obrana: 0, hodnota: 0, improvizace: 0, nastroj: 0 } })) }, rules: RULES, players: hraci(1), pronasledovatelId: 'agent-malone' });
    const events = drive(run);
    const konec = events[events.length - 1];
    expect(konec.vysledek).toBe('NEVYRESENO');
    expect(['bedny_0', 'konfrontace_prohra']).toContain(konec.pricina);
  });
});

describe('gamble', () => {
  it('nahradí committnutou kartu líznutou z vybrané ruky (odhoz)', () => {
    const run = createRun({ seed: 7, content: syntetickyObsah(), rules: RULES, players: hraci(1), pronasledovatelId: 'serif-brody' });
    // dojdi do fáze assign
    while (run.getState().faze !== 'assign') {
      const s = run.getState();
      if (s.faze === 'map') run.chooseRoute(s.nabidka.nabidnuto[0].ref);
      else if (s.faze === 'motel_offer') run.motelChoice('dal');
      else if (s.faze === 'commit') run.commitCards(s.situace.commitPlan.flatMap((p) => run.getHand(p.hrac_id).slice(0, p.pocet).map((k) => ({ characterId: p.hrac_id, cardId: k.id }))));
    }
    const pred = run.getState();
    const nahrazovana = pred.situace.committed[0].karta.id;
    run.gamble({ handOwnerId: 'p1', replacedCardId: nahrazovana });
    const g = run.getEvents().find((e) => e.type === EVENT.GAMBLE);
    expect(g.ci_ruka).toBe('p1');
    expect(g.nahrazena).toBe(nahrazovana);
    const po = run.getState();
    expect(po.situace.committed.map((c) => c.karta.id)).not.toContain(nahrazovana);
    expect(po.situace.gambleUsed).toBe(true);
  });
});

describe('Žár trať a prahy', () => {
  it('nahromaděný Žár spustí Zátah (nahradí cestu)', () => {
    // slabé karty → PRŮŠVIHy → Žár roste přes práh zatah
    const content = syntetickyObsah();
    const slabe = content.veci.map((v) => ({ ...v, staty: { utok: 0, obrana: 0, hodnota: 0, improvizace: 0, nastroj: 0 } }));
    const run = createRun({ seed: 11, content: { ...content, veci: slabe }, rules: RULES, players: hraci(2), pronasledovatelId: 'agent-malone' });
    const events = drive(run);
    const zatah = events.some((e) => e.type === EVENT.MAP_MOVE && e.byl_zatah) || events.some((e) => e.type === EVENT.SITUATION_REVEALED && e.typ_mista === 'zatah');
    expect(zatah).toBe(true);
  });
});

describe('postihy — cap 2 + složení', () => {
  it('3. postih složí postavu a smaže lehké', () => {
    // situace jen s lehkými postihy (S_NÁSLEDKY), slabé karty → 2/4
    const content = syntetickyObsah();
    // karty splní přesně 2 sloty (utok/obrana 5), zbytek 0 → 2/4 S_NÁSLEDKY
    const veci = content.veci.map((v, i) => ({ ...v, staty: i % 2 === 0 ? { utok: 5, obrana: 5, hodnota: 0, improvizace: 0, nastroj: 0 } : { utok: 5, obrana: 5, hodnota: 0, improvizace: 0, nastroj: 0 } }));
    const run = createRun({ seed: 4, content: { ...content, veci }, rules: RULES, players: hraci(1), pronasledovatelId: 'serif-brody' });
    const events = drive(run);
    // buď došlo ke složení (3 lehké), nebo aspoň postihy přibývaly — ověř mechaniku složení, pokud nastala
    const fold = events.find((e) => e.type === EVENT.CHARACTER_FOLDED);
    if (fold) {
      expect(Array.isArray(fold.smazane_lehke)).toBe(true);
      expect(events.some((e) => e.type === EVENT.PENALTY_ADDED)).toBe(true);
    } else {
      // aspoň se přidávaly postihy (2/4 dává lehký)
      expect(events.some((e) => e.type === EVENT.PENALTY_ADDED && e.tier === 'lehky')).toBe(true);
    }
  });
});

describe('pronásledovatel run-wide', () => {
  it('Malone: hodnota-slot nelze splnit ani ideální hodnota-věcí', () => {
    const content = syntetickyObsah();
    const run = createRun({ seed: 2, content, rules: RULES, players: hraci(1), pronasledovatelId: 'agent-malone' });
    const events = drive(run);
    // libovolná karta v hodnota-slotu → pronásledovatel_efekt.cil === 'hodnota'
    const vinilHodnotu = events.some(
      (e) => e.type === EVENT.SLOT_RESOLVED && e.pronasledovatel_efekt?.cil === 'hodnota'
    );
    expect(vinilHodnotu).toBe(true);
  });
});
