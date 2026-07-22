// @ts-check
/**
 * Unit testy čistých resolučních funkcí (resolve.js) — všechna pásma,
 * afinity, postihy zranění, Malone/Brody, ridery selhání.
 */
import { describe, it, expect } from 'vitest';
import { RULES } from '../src/engine/rules.js';
import {
  classifyBand,
  injuryPenalty,
  effectiveStrength,
  noisyHeat,
  resolveCheck,
  failureRider,
  ENCOUNTER_KINDS,
} from '../src/engine/resolve.js';

/** Mock RNG s předepsaným hodem. */
const fixedDie = (value) => ({ die: () => value });

describe('classifyBand — pásma 7+ / 5–6 / ≤4', () => {
  it('hranice pásem přesně dle prototyp-mvp.md', () => {
    expect(classifyBand(4, RULES)).toBe('selhani');
    expect(classifyBand(5, RULES)).toBe('uspech_za_cenu');
    expect(classifyBand(6, RULES)).toBe('uspech_za_cenu');
    expect(classifyBand(7, RULES)).toBe('uspech');
    expect(classifyBand(12, RULES)).toBe('uspech');
    expect(classifyBand(-1, RULES)).toBe('selhani');
  });
});

describe('injuryPenalty — −min(zranění, 3)', () => {
  it('roste se zraněními a stropuje na 3', () => {
    expect(injuryPenalty(0, false, RULES)).toBe(0);
    expect(injuryPenalty(1, false, RULES)).toBe(1);
    expect(injuryPenalty(2, false, RULES)).toBe(2);
    expect(injuryPenalty(3, false, RULES)).toBe(3);
    expect(injuryPenalty(5, false, RULES)).toBe(3);
  });
  it('zoufalá karta postih ignoruje', () => {
    expect(injuryPenalty(3, true, RULES)).toBe(0);
    expect(injuryPenalty(4, true, RULES)).toBe(0);
  });
});

describe('effectiveStrength — rušený tag pronásledovatele', () => {
  const uplatek3 = { tag: 'uplatek', sila: 3 };
  const nasili3 = { tag: 'nasili', sila: 3 };

  it('Malone: Úplatek má sílu 0 na jeho uzlech (Zátah, léčka, konfrontace)', () => {
    for (const druh of [ENCOUNTER_KINDS.ZATAH, ENCOUNTER_KINDS.LECKA, ENCOUNTER_KINDS.KONFRONTACE]) {
      expect(effectiveStrength(uplatek3, druh, 'agent-malone')).toBe(0);
    }
  });
  it('Malone: na běžném uzlu Úplatek platí plnou silou', () => {
    expect(effectiveStrength(uplatek3, ENCOUNTER_KINDS.UZEL, 'agent-malone')).toBe(3);
  });
  it('Malone: jiné tagy neruší', () => {
    expect(effectiveStrength(nasili3, ENCOUNTER_KINDS.KONFRONTACE, 'agent-malone')).toBe(3);
  });
  it('Brody sílu karet nemění', () => {
    expect(effectiveStrength(uplatek3, ENCOUNTER_KINDS.ZATAH, 'serif-brody')).toBe(3);
  });
});

describe('noisyHeat — hlučná karta', () => {
  it('standardně +1, proti Brodymu +2', () => {
    expect(noisyHeat('agent-malone', RULES)).toBe(1);
    expect(noisyHeat('serif-brody', RULES)).toBe(2);
  });
});

describe('resolveCheck — aritmetika hodu', () => {
  const zaklad = {
    karta: { tag: 'lest', sila: 2 },
    zoufala: false,
    zraneni: 0,
    afinita: 2,
    modifikatory: 0,
    druhSetkani: ENCOUNTER_KINDS.UZEL,
    pronasledovatelId: 'agent-malone',
  };

  it('d6 + síla + afinita = součet, pásmo úspěch', () => {
    const res = resolveCheck(zaklad, RULES, fixedDie(4));
    expect(res).toMatchObject({ hod: 4, sila: 2, afinita: 2, postih: 0, soucet: 8, pasmo: 'uspech' });
  });
  it('postih zranění se odečítá (a stropuje na 3)', () => {
    const res = resolveCheck({ ...zaklad, zraneni: 5 }, RULES, fixedDie(4));
    expect(res.postih).toBe(3);
    expect(res.soucet).toBe(5);
    expect(res.pasmo).toBe('uspech_za_cenu');
  });
  it('záporná afinita sráží do selhání', () => {
    const res = resolveCheck({ ...zaklad, afinita: -2 }, RULES, fixedDie(4));
    expect(res.soucet).toBe(4);
    expect(res.pasmo).toBe('selhani');
  });
  it('modifikátory (hlas z auta +1, prokleté −2) vstupují do součtu', () => {
    expect(resolveCheck({ ...zaklad, modifikatory: 1 }, RULES, fixedDie(4)).soucet).toBe(9);
    expect(resolveCheck({ ...zaklad, modifikatory: -2 }, RULES, fixedDie(4)).soucet).toBe(6);
  });
  it('zoufalá karta: hod = d6 + síla + afinita (bez postihu)', () => {
    const res = resolveCheck(
      { ...zaklad, karta: { tag: 'utek', sila: 3 }, zoufala: true, zraneni: 3, afinita: 0 },
      RULES,
      fixedDie(4)
    );
    expect(res.postih).toBe(0);
    expect(res.soucet).toBe(7);
  });
  it('Malone nuluje sílu Úplatku na svém uzlu i v součtu', () => {
    const res = resolveCheck(
      { ...zaklad, karta: { tag: 'uplatek', sila: 3 }, afinita: 0, druhSetkani: ENCOUNTER_KINDS.LECKA },
      RULES,
      fixedDie(4)
    );
    expect(res.sila).toBe(0);
    expect(res.soucet).toBe(4);
  });
});

describe('failureRider — ridery tagů při selhání', () => {
  it('Úplatek: nabízí zaplacení bedny, jen když bedny jsou', () => {
    expect(failureRider('uplatek', 3)).toEqual({
      typ: 'uplatek',
      volby: ['zaplatit_bednu', 'nechat_selhani'],
    });
    expect(failureRider('uplatek', 0)).toBeNull();
  });
  it('Útěk: volba zranění/bedna; bez beden jen zranění', () => {
    expect(failureRider('utek', 2)).toEqual({ typ: 'utek', volby: ['zraneni', 'bedna'] });
    expect(failureRider('utek', 0)).toEqual({ typ: 'utek', volby: ['zraneni'] });
  });
  it('Násilí a Lest rider nemají', () => {
    expect(failureRider('nasili', 3)).toBeNull();
    expect(failureRider('lest', 3)).toBeNull();
  });
});
