// @ts-check
/**
 * Parser a vyhodnocení `podminka` výrazů tajných cílů + odvození metrik
 * z událostního logu (events.js).
 */
import { describe, it, expect } from 'vitest';
import {
  parseCondition,
  evalCondition,
  deriveGoalMetrics,
  scoreGoals,
} from '../src/engine/events.js';

const metriky = {
  zraneni: 3,
  kolaps: false,
  doruceno: true,
  ztracene_bedny: 2,
  ztracene_bedny_vlastni: 0,
  tag_prvni_karty: 'utek',
  pocet_tag: { nasili: 0, lest: 2, uplatek: 1, utek: 3 },
  max_sila_karty: 2,
  zar_prah: 7,
};

const vyhodnot = (vyraz, m = metriky) => evalCondition(parseCondition(vyraz), m);

describe('parseCondition + evalCondition', () => {
  it('porovnání čísel', () => {
    expect(vyhodnot('zraneni >= 3')).toBe(true);
    expect(vyhodnot('zraneni > 3')).toBe(false);
    expect(vyhodnot('ztracene_bedny_vlastni == 0')).toBe(true);
    expect(vyhodnot('max_sila_karty <= 2')).toBe(true);
    expect(vyhodnot('zar_prah < 7')).toBe(false);
  });
  it('holá metrika = test pravdivosti', () => {
    expect(vyhodnot('doruceno')).toBe(true);
    expect(vyhodnot('kolaps')).toBe(false);
  });
  it('porovnání s booleanem a řetězcem (tagem)', () => {
    expect(vyhodnot('kolaps == false')).toBe(true);
    expect(vyhodnot('tag_prvni_karty == utek')).toBe(true);
    expect(vyhodnot('tag_prvni_karty != nasili')).toBe(true);
  });
  it('tečková metrika pocet_tag.<tag>', () => {
    expect(vyhodnot('pocet_tag.nasili == 0')).toBe(true);
    expect(vyhodnot('pocet_tag.utek >= 1')).toBe(true);
  });
  it('spojka `a` (všechny musí platit)', () => {
    expect(vyhodnot('zraneni >= 3 a doruceno')).toBe(true);
    expect(vyhodnot('zraneni >= 3 a kolaps')).toBe(false);
    expect(
      vyhodnot('pocet_tag.nasili >= 1 a pocet_tag.lest >= 1 a pocet_tag.uplatek >= 1 a pocet_tag.utek >= 1')
    ).toBe(false);
  });
  it('spojka `nebo` + precedence: `a` váže těsněji', () => {
    expect(vyhodnot('kolaps nebo doruceno')).toBe(true);
    // (kolaps a doruceno) nebo (zraneni >= 3) → true díky pravé větvi
    expect(vyhodnot('kolaps a doruceno nebo zraneni >= 3')).toBe(true);
    // (kolaps) nebo (doruceno a zraneni > 5) → false obě větve
    expect(vyhodnot('kolaps nebo doruceno a zraneni > 5')).toBe(false);
  });
  it('chyby: neznámá metrika, neznámý operátor, nesmyslný člen', () => {
    expect(() => parseCondition('pocet_hodu >= 1')).toThrow(/neznámá metrika/);
    expect(() => parseCondition('zraneni ~ 3')).toThrow(/neznámý operátor/);
    expect(() => parseCondition('zraneni >= ')).toThrow(/nesrozumitelný člen|prázdná/);
    expect(() => parseCondition('')).toThrow(/prázdná/);
  });
});

describe('deriveGoalMetrics — odvození z událostního logu', () => {
  const events = [
    { type: 'run_started', seq: 1 },
    { type: 'card_played', postava: 'a', karta: { id: 'x', tag: 'utek', sila: 1 }, dobrovolna: true },
    { type: 'card_played', postava: 'a', karta: { id: 'y', tag: 'nasili', sila: 3 }, dobrovolna: false },
    { type: 'card_played', postava: 'b', karta: { id: 'z', tag: 'lest', sila: 2 }, dobrovolna: true },
    { type: 'injury_added', postava: 'a', pocetZraneni: 1 },
    { type: 'injury_added', postava: 'a', pocetZraneni: 2 },
    { type: 'crate_lost', duvod: 'rider_utek', postava: 'a', zbyvaBeden: 5 },
    { type: 'crate_lost', duvod: 'tvrdost_uzlu', postava: 'b', zbyvaBeden: 4 },
    { type: 'heat_threshold', prah: 5 },
    { type: 'heat_threshold', prah: 7 },
    { type: 'character_down', postava: 'b', pocetZraneni: 4 },
    { type: 'run_ended', vysledek: 'DORUCENO' },
  ];

  it('metriky postavy a (vlastník)', () => {
    const m = deriveGoalMetrics(events, 'a');
    expect(m).toMatchObject({
      zraneni: 2,
      kolaps: false,
      doruceno: true,
      ztracene_bedny: 2,
      ztracene_bedny_vlastni: 1,
      tag_prvni_karty: 'utek',
      max_sila_karty: 1, // síla 3 byla vynucená (dobrovolna: false)
      zar_prah: 7,
    });
    expect(m.pocet_tag).toEqual({ nasili: 1, lest: 0, uplatek: 0, utek: 1 });
  });
  it('metriky postavy b (kolaps, cizí bedny)', () => {
    const m = deriveGoalMetrics(events, 'b');
    expect(m.kolaps).toBe(true);
    expect(m.ztracene_bedny_vlastni).toBe(1);
    expect(m.tag_prvni_karty).toBe('lest');
  });

  it('scoreGoals: mechanický cíl se boduje, textový je nebodovaný (splnen: null)', () => {
    const skore = scoreGoals(events, [
      {
        postavaId: 'a',
        cil: { id: 'nohy-na-ramena', overeni_typ: 'mechanicky', podminka: 'tag_prvni_karty == utek', body: 1 },
      },
      {
        postavaId: 'b',
        cil: { id: 'mozek-operace', overeni_typ: 'textovy', body: 3 },
      },
    ]);
    expect(skore[0]).toMatchObject({ cil: 'nohy-na-ramena', splnen: true, body: 1, textovy: false });
    expect(skore[1]).toMatchObject({ cil: 'mozek-operace', splnen: null, body: 0, textovy: true });
  });
});
