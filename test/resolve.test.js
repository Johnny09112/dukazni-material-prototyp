// @ts-check
/**
 * v3 slotová resoluce — čisté funkce (resolve.js). Bez enginu, bez I/O.
 * Kotva ± šum, jednostat vs. kombi, GANGSTER chování, rušení statu
 * pronásledovatelem, pásmo z počtu zásahů, oracle max_achievable, telegraf.
 */
import { describe, it, expect } from 'vitest';
import { createRng } from '../src/engine/rng.js';
import { RULES } from '../src/engine/rules.js';
import { BAND } from '../src/engine/events.js';
import {
  slotPrah,
  resolveSlot,
  bandFromHits,
  maxAchievableZasahy,
  deriveTelegrafSignal,
} from '../src/engine/resolve.js';

/** Zkratka pro věc s pěti staty. */
function vec(id, staty, stitek) {
  const base = { utok: 0, obrana: 0, hodnota: 0, improvizace: 0, nastroj: 0 };
  return { id, nazev: id, staty: { ...base, ...staty }, ...(stitek ? { stitek } : {}) };
}

const GANGSTER_PARAMS = {
  chovani_dle_typu: {
    npc: 'viditelna_role_selze',
    lecka: 'viditelna_role_selze',
    lokace: 'vzdy_pass',
    zatah: 'vzdy_pass',
    konfrontace: 'vzdy_pass',
  },
  hlucnost_zar: 1,
};

/* ---------- kotva ± šum ---------- */

describe('slotPrah — kotva ± šum', () => {
  const R = RULES.sumRozsah; // kalibrace-2: 2

  it('drží prah v [max(0,kotva−R), min(statMax,kotva+R)] a je deterministický dle seedu', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const prah = slotPrah(3, createRng(seed), RULES);
      expect(prah).toBeGreaterThanOrEqual(Math.max(0, 3 - R));
      expect(prah).toBeLessThanOrEqual(Math.min(RULES.statMax, 3 + R));
    }
    expect(slotPrah(3, createRng(7), RULES)).toBe(slotPrah(3, createRng(7), RULES));
  });

  it('pokryje celý rozsah {−R…+R} tam, kde clamp nezasahuje (kotva 3)', () => {
    const videno = new Set();
    for (let seed = 1; seed <= 400; seed++) videno.add(slotPrah(3, createRng(seed), RULES) - 3);
    const ocekavano = Array.from({ length: 2 * R + 1 }, (_, i) => i - R);
    expect([...videno].sort((a, b) => a - b)).toEqual(ocekavano);
  });

  it('clamp: širší šum nedělá beznadějné sloty — prah ∈ [0, statMax] pro každou kotvu (K5)', () => {
    for (let kotva = RULES.kotvaMin; kotva <= RULES.kotvaMax; kotva++) {
      for (let seed = 1; seed <= 300; seed++) {
        const prah = slotPrah(kotva, createRng(seed), RULES);
        expect(prah).toBeGreaterThanOrEqual(0);
        expect(prah).toBeLessThanOrEqual(RULES.statMax);
      }
    }
    // kotva 4 + 2 = 6 se zastropuje na statMax (5), ne na nedosažitelných 6.
    const maxPrah = Math.max(...Array.from({ length: 300 }, (_, i) => slotPrah(RULES.kotvaMax, createRng(i + 1), RULES)));
    expect(maxPrah).toBe(RULES.statMax);
  });
});

/* ---------- resolveSlot: jednostat ---------- */

describe('resolveSlot — jednostat', () => {
  const slot = { slot_index: 0, stat: 'utok', prah: 3, viditelnost: 'viditelna' };

  it('projde, když stat ≥ prah', () => {
    const r = resolveSlot({ karta: vec('a', { utok: 4 }), slot });
    expect(r.zasah).toBe(true);
    expect(r.stat_hodnota).toBe(4);
    expect(r.duvod).toBe('proslo');
  });

  it('selže, když stat < prah', () => {
    const r = resolveSlot({ karta: vec('a', { utok: 2 }), slot });
    expect(r.zasah).toBe(false);
    expect(r.duvod).toBe('nizky_stat');
  });
});

/* ---------- resolveSlot: kombi „oba ≥ prah" ---------- */

describe('resolveSlot — kombi', () => {
  const slot = { slot_index: 1, stat: ['nastroj', 'improvizace'], prah: 2, viditelnost: 'viditelna', typ_prahu: 'kombi_oba' };

  it('projde, jen když oba staty ≥ prah', () => {
    expect(resolveSlot({ karta: vec('a', { nastroj: 3, improvizace: 2 }), slot }).zasah).toBe(true);
  });

  it('selže, když jeden ze dvou statů nedosáhne', () => {
    const r = resolveSlot({ karta: vec('a', { nastroj: 4, improvizace: 1 }), slot });
    expect(r.zasah).toBe(false);
    expect(r.duvod).toBe('kombi_neuplny');
  });
});

/* ---------- resolveSlot: GANGSTER ---------- */

describe('resolveSlot — GANGSTER štítek', () => {
  it('ve viditelné roli npc AUTO-FAIL bez ohledu na staty', () => {
    const slot = { slot_index: 0, stat: 'utok', prah: 3, viditelnost: 'viditelna' };
    const r = resolveSlot({ karta: vec('bouchacka', { utok: 5 }, 'GANGSTER'), slot, stitekParams: GANGSTER_PARAMS, typSituace: 'npc' });
    expect(r.zasah).toBe(false);
    expect(r.stitek_efekt).toBe('auto_fail');
  });

  it('ve skryté roli npc se štítek ignoruje, hodnotí se dle statu', () => {
    const slot = { slot_index: 3, stat: 'utok', prah: 3, viditelnost: 'skryta' };
    const r = resolveSlot({ karta: vec('bouchacka', { utok: 5 }, 'GANGSTER'), slot, stitekParams: GANGSTER_PARAMS, typSituace: 'npc' });
    expect(r.zasah).toBe(true);
    expect(r.stitek_efekt).toBe(null);
  });

  it('v lokaci (vzdy_pass) projde i ve viditelné roli dle statu', () => {
    const slot = { slot_index: 0, stat: 'utok', prah: 3, viditelnost: 'viditelna' };
    const r = resolveSlot({ karta: vec('bouchacka', { utok: 5 }, 'GANGSTER'), slot, stitekParams: GANGSTER_PARAMS, typSituace: 'lokace' });
    expect(r.zasah).toBe(true);
  });

  it('slotová výjimka stitek_citlivy přebije auto-fail (eso i viditelně)', () => {
    const slot = { slot_index: 0, stat: 'utok', prah: 3, viditelnost: 'viditelna', stitek_citlivy: 'GANGSTER' };
    const r = resolveSlot({ karta: vec('bouchacka', { utok: 5 }, 'GANGSTER'), slot, stitekParams: GANGSTER_PARAMS, typSituace: 'npc' });
    expect(r.zasah).toBe(true);
  });
});

/* ---------- resolveSlot: pronásledovatel ruší stat ---------- */

describe('resolveSlot — pronásledovatel ruší stat run-wide', () => {
  const slot = { slot_index: 0, stat: 'hodnota', prah: 3, viditelnost: 'viditelna' };

  it('Malone: hodnota-stat čte jako 0 → jinak úspěšný slot selže', () => {
    const r = resolveSlot({ karta: vec('prsten', { hodnota: 5 }), slot, rusi: { typ: 'stat', cil: 'hodnota' } });
    expect(r.stat_hodnota).toBe(0);
    expect(r.zasah).toBe(false);
    expect(r.pronasledovatel_efekt).toEqual({ typ: 'stat', cil: 'hodnota' });
  });

  it('rušení jiného cíle slot neovlivní', () => {
    const r = resolveSlot({ karta: vec('prsten', { hodnota: 5 }), slot, rusi: { typ: 'stitek', cil: 'GANGSTER' } });
    expect(r.zasah).toBe(true);
    expect(r.pronasledovatel_efekt).toBe(null);
  });
});

/* ---------- pásmo z počtu zásahů ---------- */

describe('bandFromHits', () => {
  it('mapuje počet zásahů na pásmo', () => {
    expect(bandFromHits(4)).toBe(BAND.LOOT);
    expect(bandFromHits(3)).toBe(BAND.HLADCE);
    expect(bandFromHits(2)).toBe(BAND.NASLEDKY);
    expect(bandFromHits(1)).toBe(BAND.PRUSVIH);
    expect(bandFromHits(0)).toBe(BAND.PRUSVIH);
  });
});

/* ---------- oracle max_achievable ---------- */

describe('maxAchievableZasahy — oracle nad committnutými kartami', () => {
  const sloty = [
    { slot_index: 0, stat: 'utok', prah: 3, viditelnost: 'viditelna' },
    { slot_index: 1, stat: 'obrana', prah: 3, viditelnost: 'viditelna' },
    { slot_index: 2, stat: 'hodnota', prah: 3, viditelnost: 'viditelna' },
    { slot_index: 3, stat: 'nastroj', prah: 3, viditelnost: 'skryta' },
  ];

  it('najde optimální rozdělení (4/4 při ideálních specialistech)', () => {
    const karty = [
      vec('u', { utok: 4 }),
      vec('o', { obrana: 4 }),
      vec('h', { hodnota: 4 }),
      vec('n', { nastroj: 4 }),
    ];
    expect(maxAchievableZasahy(karty, sloty)).toBe(4);
  });

  it('odhalí nevyhnutelně špatný slot (max < 4/4)', () => {
    const karty = [
      vec('u', { utok: 4 }),
      vec('u2', { utok: 4 }),
      vec('u3', { utok: 4 }),
      vec('u4', { utok: 4 }), // nikdo neumí obranu/hodnotu/nástroj
    ];
    expect(maxAchievableZasahy(karty, sloty)).toBe(1); // jen útok-slot jde splnit
  });
});

/* ---------- telegraf derivace ---------- */

describe('deriveTelegrafSignal — engine derivuje ze slotů', () => {
  const sloty = [
    { slot_index: 0, stat: 'hodnota', kotva: 3, viditelnost: 'viditelna' },
    { slot_index: 1, stat: 'obrana', kotva: 2, viditelnost: 'viditelna' },
    { slot_index: 2, stat: 'nastroj', kotva: 2, viditelnost: 'viditelna' },
    { slot_index: 3, stat: 'utok', kotva: 3, viditelnost: 'skryta' },
  ];

  it('vydá trend viditelných statů, počet skrytých a verdikt zbraně (npc = jen skrytě)', () => {
    const sig = deriveTelegrafSignal(sloty, GANGSTER_PARAMS, 'npc');
    expect(sig.trend.map((t) => t.stat)).toEqual(['hodnota', 'obrana', 'nastroj']);
    expect(sig.proti_srsti).toBe(1);
    expect(sig.zbran_projde).toBe('jen_skryte');
  });

  it('neprozradí kotvy/prahy (jen staty)', () => {
    const sig = deriveTelegrafSignal(sloty, GANGSTER_PARAMS, 'npc');
    expect(sig.trend[0]).not.toHaveProperty('kotva');
    expect(sig.trend[0]).not.toHaveProperty('prah');
  });

  it('lokace: zbraň projde i viditelně', () => {
    expect(deriveTelegrafSignal(sloty, GANGSTER_PARAMS, 'lokace').zbran_projde).toBe('ano');
  });

  // Kalibrace-2 (D22 bod 3): pozitivní signál „zbraň se ve skrytém slotu vyplatí".
  it('zbran_skryte = true, když nějaký SKRYTÝ slot klíčuje na utok („kdyby přituhlo")', () => {
    expect(deriveTelegrafSignal(sloty, GANGSTER_PARAMS, 'npc').zbran_skryte).toBe(true);
  });

  it('zbran_skryte = false, když je skrytý slot obrana (párovost urednik-vaha/razitko — próza „papír > olovo")', () => {
    const obranaSkryta = [
      { slot_index: 0, stat: 'improvizace', kotva: 3, viditelnost: 'viditelna' },
      { slot_index: 1, stat: 'nastroj', kotva: 3, viditelnost: 'viditelna' },
      { slot_index: 2, stat: 'utok', kotva: 3, viditelnost: 'viditelna' }, // utok je VIDITELNÝ → nesignalizuje skrytou zbraň
      { slot_index: 3, stat: 'obrana', kotva: 2, viditelnost: 'skryta' },
    ];
    expect(deriveTelegrafSignal(obranaSkryta, GANGSTER_PARAMS, 'npc').zbran_skryte).toBe(false);
  });
});
