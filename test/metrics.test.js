// @ts-check
/**
 * v3 metriky cílů + parser `podminka` (obsah/cile.yaml, architektura §2.2 v3).
 * Pure — testuje se nad syntetickým událostním logem, bez enginu.
 */
import { describe, it, expect } from 'vitest';
import {
  EVENT,
  parseCondition,
  evalCondition,
  deriveGoalMetrics,
  scoreGoals,
} from '../src/engine/events.js';

/* ---------- parser podmínek ---------- */

describe('parseCondition — v3 metriky', () => {
  it('naparsuje závorkovou metriku pásma', () => {
    const ast = parseCondition('pasma_dosazena["4/4_HLADCE_LOOT"] >= 1');
    expect(ast.skupiny).toHaveLength(1);
    expect(ast.skupiny[0].podminky[0]).toEqual({
      metrika: 'pasma_dosazena["4/4_HLADCE_LOOT"]',
      op: '>=',
      hodnota: 1,
    });
  });

  it('naparsuje tečkovou podmetriku a spojku `a`', () => {
    const ast = parseCondition('postihy_utrpene.tezke == 0 a doruceno');
    expect(ast.skupiny[0].podminky).toHaveLength(2);
    expect(ast.skupiny[0].podminky[1]).toEqual({ metrika: 'doruceno', op: null, hodnota: null });
  });

  it('odmítne neznámou metriku česky', () => {
    expect(() => parseCondition('vymyslena_metrika >= 1')).toThrow(/neznámá metrika/i);
  });

  it('odmítne neznámé pásmo v závorce česky', () => {
    expect(() => parseCondition('pasma_dosazena["9/9_NEEXISTUJE"] >= 1')).toThrow(/pásmo/i);
  });
});

describe('evalCondition', () => {
  const metriky = {
    doruceno: true,
    commitnute_stitky: { GANGSTER_viditelna: 0 },
    pasma_dosazena: { '4/4_HLADCE_LOOT': 2 },
    postihy_utrpene: { pocet: 3, lehke: 2, tezke: 1 },
  };

  it('vyhodnotí tečkovou i závorkovou cestu a spojku', () => {
    expect(evalCondition(parseCondition('commitnute_stitky.GANGSTER_viditelna == 0 a doruceno'), metriky)).toBe(true);
    expect(evalCondition(parseCondition('pasma_dosazena["4/4_HLADCE_LOOT"] >= 1'), metriky)).toBe(true);
    expect(evalCondition(parseCondition('postihy_utrpene.tezke == 0 a doruceno'), metriky)).toBe(false);
  });
});

/* ---------- odvození metrik z v3 logu ---------- */

/**
 * Minimální syntetický v3 log jednoho uzlu: commit + situation_revealed +
 * assignment + 4× slot_resolved + band_resolved (+ volitelně další).
 */
function unlogNode(nodeIndex, { pasmo, zasahy, slotHrac, naklad_ztrata = 0 }) {
  const events = [];
  let seq = 100 * nodeIndex;
  const push = (type, payload) => events.push({ seq: ++seq, type, nodeIndex, ...payload });
  push(EVENT.SLOT_RESOLVED, { slot_index: 0, hrac_id: slotHrac[0].hrac, viditelnost: 'viditelna', stitky: slotHrac[0].stitky ?? [], zasah: slotHrac[0].zasah });
  push(EVENT.SLOT_RESOLVED, { slot_index: 1, hrac_id: slotHrac[1].hrac, viditelnost: 'viditelna', stitky: slotHrac[1].stitky ?? [], zasah: slotHrac[1].zasah });
  push(EVENT.SLOT_RESOLVED, { slot_index: 2, hrac_id: slotHrac[2].hrac, viditelnost: 'viditelna', stitky: slotHrac[2].stitky ?? [], zasah: slotHrac[2].zasah });
  push(EVENT.SLOT_RESOLVED, { slot_index: 3, hrac_id: slotHrac[3].hrac, viditelnost: 'skryta', stitky: slotHrac[3].stitky ?? [], zasah: slotHrac[3].zasah });
  push(EVENT.BAND_RESOLVED, { zasahy, pasmo, naklad_ztrata, zbyva_beden: 5 });
  return events;
}

describe('deriveGoalMetrics — v3', () => {
  it('počítá splněné/selhané sloty a pásma per hráč', () => {
    const log = [
      ...unlogNode(1, {
        pasmo: '4/4_HLADCE_LOOT',
        zasahy: 4,
        slotHrac: [
          { hrac: 'p1', zasah: true },
          { hrac: 'p2', zasah: true },
          { hrac: 'p1', zasah: true },
          { hrac: 'p2', zasah: true },
        ],
      }),
      { seq: 999, type: EVENT.RUN_ENDED, nodeIndex: 1, vysledek: 'DORUCENO', pricina: 'dojezd' },
    ];
    const m = deriveGoalMetrics(log, 'p1');
    expect(m.pocet_slotu_splnil).toBe(2);
    expect(m.pocet_slotu_selhal).toBe(0);
    expect(m.pasma_dosazena['4/4_HLADCE_LOOT']).toBe(1);
    expect(m.doruceno).toBe(true);
  });

  it('počítá GANGSTER do viditelné role', () => {
    const log = unlogNode(1, {
      pasmo: '2/4_S_NASLEDKY',
      zasahy: 2,
      slotHrac: [
        { hrac: 'p1', zasah: false, stitky: ['GANGSTER'] }, // viditelná → počítá se
        { hrac: 'p2', zasah: true },
        { hrac: 'p1', zasah: true },
        { hrac: 'p2', zasah: true, stitky: ['GANGSTER'] }, // skrytá → nepočítá se
      ],
    });
    expect(deriveGoalMetrics(log, 'p1').commitnute_stitky.GANGSTER_viditelna).toBe(1);
    expect(deriveGoalMetrics(log, 'p2').commitnute_stitky.GANGSTER_viditelna).toBe(0);
  });

  it('atribuuje ztracené bedny hráči s propadlým slotem v PRŮŠVIHu', () => {
    const log = unlogNode(1, {
      pasmo: '≤1/4_PRUSVIH',
      zasahy: 1,
      naklad_ztrata: 1,
      slotHrac: [
        { hrac: 'p1', zasah: false },
        { hrac: 'p2', zasah: true }, // p2 slot prošel → bez viny
        { hrac: 'p1', zasah: false },
        { hrac: 'p2', zasah: false }, // p2 má i propadlý slot → vina
      ],
    });
    expect(deriveGoalMetrics(log, 'p1').bedny_ztracene_vlastni).toBe(1);
    expect(deriveGoalMetrics(log, 'p2').bedny_ztracene_vlastni).toBe(1);
  });

  it('počítá postihy (tier), gamble a složení per hráč', () => {
    const log = [
      { seq: 1, type: EVENT.PENALTY_ADDED, nodeIndex: 1, hrac_id: 'p1', postih_id: 'x', kategorie: 'informacni', tier: 'lehky', efekt: { druh: 'hide_staty' } },
      { seq: 2, type: EVENT.PENALTY_ADDED, nodeIndex: 2, hrac_id: 'p1', postih_id: 'y', kategorie: 'zamkovy', tier: 'tezky', efekt: { druh: 'lock_gamble' } },
      { seq: 3, type: EVENT.GAMBLE, nodeIndex: 2, ci_ruka: 'p1', tazena: 'k', nahrazena: 'j', do_slotu: 0 },
      { seq: 4, type: EVENT.CHARACTER_FOLDED, nodeIndex: 3, hrac_id: 'p1' },
      { seq: 5, type: EVENT.RUN_ENDED, nodeIndex: 3, vysledek: 'DORUCENO' },
    ];
    const m = deriveGoalMetrics(log, 'p1');
    expect(m.postihy_utrpene).toEqual({ pocet: 2, lehke: 1, tezke: 1 });
    expect(m.gamble_pouzit).toBe(1);
    expect(m.slozeni_krat).toBe(1);
  });
});

/* ---------- scoreGoals ---------- */

describe('scoreGoals', () => {
  const log = [
    ...unlogNode(1, {
      pasmo: '4/4_HLADCE_LOOT',
      zasahy: 4,
      slotHrac: [
        { hrac: 'p1', zasah: true },
        { hrac: 'p1', zasah: true },
        { hrac: 'p1', zasah: true },
        { hrac: 'p1', zasah: true },
      ],
    }),
    { seq: 999, type: EVENT.RUN_ENDED, nodeIndex: 1, vysledek: 'DORUCENO' },
  ];

  it('oboduje mechanický cíl z podmínky', () => {
    const cile = [{ postavaId: 'p1', cil: { id: 'plny-zasah', overeni_typ: 'mechanicky', podminka: 'pasma_dosazena["4/4_HLADCE_LOOT"] >= 1 a doruceno', body: 3 } }];
    const [score] = scoreGoals(log, cile);
    expect(score).toMatchObject({ postava: 'p1', cil: 'plny-zasah', textovy: false, splnen: true, body: 3 });
  });

  it('textový cíl nechá na člověku (splnen null, body 0)', () => {
    const cile = [{ postavaId: 'p1', cil: { id: 'mozek-operace', overeni_typ: 'textovy', body: 3 } }];
    const [score] = scoreGoals(log, cile);
    expect(score).toMatchObject({ textovy: true, splnen: null, body: 0 });
  });
});
