// @ts-check
/**
 * Botí strategie: cíle-driven deviace (D21/4a) a gamble policy K7 (D21/4b).
 */
import { describe, it, expect } from 'vitest';
import { decideAssignment } from '../sim/strategies.js';
import { playRun, PRESETY } from '../sim/run.js';
import { EVENT } from '../src/engine/events.js';
import { syntetickyObsah, hraci } from './helpers.js';

function vec(id, staty, stitek) {
  const base = { utok: 0, obrana: 0, hodnota: 0, improvizace: 0, nastroj: 0 };
  return { id, nazev: id, staty: { ...base, ...staty }, ...(stitek ? { stitek } : {}) };
}

const GANGSTER_PARAMS = {
  chovani_dle_typu: { npc: 'viditelna_role_selze', lecka: 'viditelna_role_selze', lokace: 'vzdy_pass', zatah: 'vzdy_pass', konfrontace: 'vzdy_pass' },
  hlucnost_zar: 1,
};

describe('cíle-driven deviace (D21/4a)', () => {
  const sloty = [
    { slot_index: 0, stat: 'utok', kotva: 3, prah: 3, viditelnost: 'viditelna' },
    { slot_index: 1, stat: 'obrana', kotva: 3, prah: 3, viditelnost: 'viditelna' },
    { slot_index: 2, stat: 'hodnota', kotva: 3, prah: 3, viditelnost: 'viditelna' },
    { slot_index: 3, stat: 'nastroj', kotva: 3, prah: 3, viditelnost: 'skryta' },
  ];
  const committed = [
    { hrac_id: 'p1', karta: vec('zbran', { utok: 5 }, 'GANGSTER') },
    { hrac_id: 'p2', karta: vec('stit', { obrana: 5 }) },
    { hrac_id: 'p3', karta: vec('penize', { hodnota: 5 }) },
    { hrac_id: 'p4', karta: vec('naradi', { nastroj: 5 }) },
  ];

  it('kompetentni dá GANGSTER do viditelného útok-slotu, cíle (cista-ruka) NE', () => {
    const komp = decideAssignment({ strat: 'kompetentni', committed, sloty, stitekParams: GANGSTER_PARAMS, typSituace: 'npc' });
    // GANGSTER je karta 0 → kam ji kompetentni dal?
    const kompSlot = sloty[komp[0]];
    expect(kompSlot.viditelnost).toBe('viditelna');

    const cile = decideAssignment({
      strat: 'cile',
      committed,
      sloty,
      stitekParams: GANGSTER_PARAMS,
      typSituace: 'npc',
      goalByHrac: { p1: 'cista-ruka' },
    });
    const cileSlot = sloty[cile[0]];
    expect(cileSlot.viditelnost).toBe('skryta'); // vyhnul se viditelné roli
  });

  it('dve-jizvy tlačí vlastní kartu do slotu, kde spíš propadne', () => {
    const slotyLow = [
      { slot_index: 0, stat: 'utok', kotva: 2, prah: 2, viditelnost: 'viditelna' },
      { slot_index: 1, stat: 'obrana', kotva: 4, prah: 4, viditelnost: 'viditelna' },
    ];
    const c2 = [
      { hrac_id: 'p1', karta: vec('a', { utok: 3, obrana: 3 }) }, // projde útok(k2), propadne obrana(k4)
      { hrac_id: 'p2', karta: vec('b', { utok: 5, obrana: 5 }) },
    ];
    const komp = decideAssignment({ strat: 'kompetentni', committed: c2, sloty: slotyLow });
    const cile = decideAssignment({ strat: 'cile', committed: c2, sloty: slotyLow, goalByHrac: { p1: 'dve-jizvy' } });
    // cíle posune p1 do slotu, kde propadne (obrana k4) — jiné než kompetentni
    expect(JSON.stringify(cile)).not.toBe(JSON.stringify(komp));
  });
});

describe('gamble policy K7 (D21/4b)', () => {
  it('při 4/4 (univerzální karty) se gamble NEbere', () => {
    const base = syntetickyObsah();
    const veci = base.veci.map((v) => ({ ...v, staty: { utok: 5, obrana: 5, hodnota: 5, improvizace: 5, nastroj: 5 } }));
    const events = playRun({ seed: 1, content: { ...base, veci }, players: hraci(1), pronasledovatelId: 'serif-brody', spec: PRESETY.kompetentni });
    expect(events.some((e) => e.type === EVENT.GAMBLE)).toBe(false);
  });

  it('při odhadu ≤2/4 (slabé karty) gamble aspoň jednou vystřelí', () => {
    const base = syntetickyObsah();
    const veci = base.veci.map((v) => ({ ...v, staty: { utok: 1, obrana: 1, hodnota: 1, improvizace: 1, nastroj: 1 } }));
    const events = playRun({ seed: 2, content: { ...base, veci }, players: hraci(2), pronasledovatelId: 'serif-brody', spec: PRESETY.kompetentni });
    expect(events.some((e) => e.type === EVENT.GAMBLE)).toBe(true);
  });
});
