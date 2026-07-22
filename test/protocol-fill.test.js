// @ts-check
/**
 * Testy čistého modulu výběru a dosazení fallback šablon (src/ui/protocol-fill.js).
 * Typewriter se netestuje (jen efekt); herní logika je v enginu, ne tady.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { load } from 'js-yaml';
import {
  prijmeni,
  frazeBeden,
  popisZraneni,
  dosad,
  sedi,
  createVyberSablon,
  zapisUzlu,
  zapisFinale,
  NOUZOVY_ZAZNAM,
  opravUvozovkySablon,
} from '../src/ui/protocol-fill.js';

const REALNE_SABLONY = load(
  opravUvozovkySablon(
    fs.readFileSync(new URL('../content/prompty/fallback-sablony.yaml', import.meta.url), 'utf8')
  )
).sablony;

/** Deterministický zdroj náhody: vrací zadanou posloupnost dokola. */
function pevnyRand(hodnoty) {
  let i = 0;
  return () => hodnoty[i++ % hodnoty.length];
}

describe('opravUvozovkySablon (workaround nevalidního YAML v obsahu)', () => {
  it('escapuje vnitřní ASCII uvozovky v text: scalarech na typografické', () => {
    const vstup = '  - id: x\n    text: "postup „{karta}". Dál."';
    const opraveno = opravUvozovkySablon(vstup);
    expect(() => load(opraveno)).not.toThrow();
    expect(load(opraveno)[0].text).toBe('postup „{karta}“. Dál.');
  });
  it('validní řádky nechává beze změny', () => {
    const vstup = '  - id: x\n    text: "bez vnitřních uvozovek"\n    pasmo: uspech';
    expect(opravUvozovkySablon(vstup)).toBe(vstup);
  });
  it('reálný soubor šablon po opravě obsahuje očekávaný počet šablon', () => {
    expect(REALNE_SABLONY.length).toBeGreaterThanOrEqual(20);
  });
});

describe('prijmeni', () => {
  it('vrací poslední slovo celého jména (kontrakt {jmeno} z CLAUDE.md)', () => {
    expect(prijmeni('Vincenc Bartoš')).toBe('Bartoš');
    expect(prijmeni('Frank Kowalski')).toBe('Kowalski');
    expect(prijmeni('  Cesare   Fontana  ')).toBe('Fontana');
    expect(prijmeni('Mazur')).toBe('Mazur');
  });
});

describe('frazeBeden', () => {
  it('skloňuje česky', () => {
    expect(frazeBeden(0)).toBe('žádná bedna');
    expect(frazeBeden(1)).toBe('jedna bedna');
    expect(frazeBeden(2)).toBe('dvě bedny');
    expect(frazeBeden(3)).toBe('tři bedny');
    expect(frazeBeden(4)).toBe('čtyři bedny');
    expect(frazeBeden(5)).toBe('pět beden');
    expect(frazeBeden(6)).toBe('šest beden');
  });
  it('nad slovní zásobou padá na číslici', () => {
    expect(frazeBeden(7)).toBe('7 beden');
  });
});

describe('popisZraneni', () => {
  it('bez tvrdosti je obecné', () => {
    expect(popisZraneni(null)).toBe('zranění blíže neurčené');
    expect(popisZraneni(undefined)).toBe('zranění blíže neurčené');
    expect(popisZraneni('bedna')).toBe('zranění blíže neurčené');
  });
  it('tvrdost obarvuje popis', () => {
    expect(popisZraneni('zraneni')).toContain('vícečetné');
    expect(popisZraneni('zar')).toContain('rozruchu');
  });
});

describe('dosad', () => {
  it('dosazuje všechny známé placeholdery', () => {
    expect(dosad('{jmeno} v {uzel}: {karta}', { jmeno: 'Bartoš', uzel: 'Brod', karta: 'Pěsti' }))
      .toBe('Bartoš v Brod: Pěsti');
  });
  it('neznámý placeholder nechává být', () => {
    expect(dosad('{jmeno} a {neco}', { jmeno: 'Mazur' })).toBe('Mazur a {neco}');
  });
});

describe('sedi (podminka šablony)', () => {
  it('vynechaný klíč = jakkoli', () => {
    expect(sedi({ podminka: undefined }, { zraneni: true, bedna: false })).toBe(true);
    expect(sedi({ podminka: { zraneni: 'ano' } }, { zraneni: true, bedna: true })).toBe(true);
  });
  it('uvedený klíč musí odpovídat', () => {
    expect(sedi({ podminka: { zraneni: 'ano', bedna: 'ne' } }, { zraneni: true, bedna: false }))
      .toBe(true);
    expect(sedi({ podminka: { zraneni: 'ano', bedna: 'ne' } }, { zraneni: true, bedna: true }))
      .toBe(false);
    expect(sedi({ podminka: { zraneni: 'ne' } }, { zraneni: true })).toBe(false);
  });
});

describe('createVyberSablon', () => {
  const sablony = [
    { id: 'a', pasmo: 'uspech', podminka: { zraneni: 'ne', bedna: 'ne' }, text: 'A' },
    { id: 'b', pasmo: 'uspech', podminka: { zraneni: 'ne', bedna: 'ne' }, text: 'B' },
    { id: 'c', pasmo: 'selhani', podminka: { zraneni: 'ano', bedna: 'ne' }, text: 'C' },
    { id: 'd', pasmo: 'selhani', podminka: { zraneni: 'ne', bedna: 'ano' }, text: 'D' },
    { id: 'e', pasmo: 'zatah', text: 'E' },
  ];

  it('vybírá dle pásma a podmínky', () => {
    const vyber = createVyberSablon(sablony, pevnyRand([0]));
    expect(vyber('selhani', { zraneni: true, bedna: false }).id).toBe('c');
    expect(vyber('selhani', { zraneni: false, bedna: true }).id).toBe('d');
    expect(vyber('zatah').id).toBe('e');
  });

  it('nelosuje stejnou šablonu dvakrát po sobě, je-li z čeho vybírat', () => {
    // rand vždy 0 = bez ochrany by pořád padala „a".
    const vyber = createVyberSablon(sablony, pevnyRand([0]));
    const stav = { zraneni: false, bedna: false };
    const prvni = vyber('uspech', stav).id;
    const druha = vyber('uspech', stav).id;
    const treti = vyber('uspech', stav).id;
    expect(druha).not.toBe(prvni);
    expect(treti).not.toBe(druha);
  });

  it('jediná vyhovující šablona se opakovat smí', () => {
    const vyber = createVyberSablon(sablony, pevnyRand([0]));
    expect(vyber('zatah').id).toBe('e');
    expect(vyber('zatah').id).toBe('e');
  });

  it('bez vyhovující šablony vrací nouzový záznam', () => {
    const vyber = createVyberSablon(sablony, pevnyRand([0]));
    expect(vyber('konfrontace')).toEqual({ id: null, text: NOUZOVY_ZAZNAM });
  });
});

describe('zapisUzlu (integrace nad syntetickou událostí node_resolved)', () => {
  const ctx = { jmena: { bartos: 'Vincenc Bartoš', mazur: 'Rudolf Mazur' } };

  /** @param {object} [prepis] */
  function udalost(prepis = {}) {
    return {
      type: 'node_resolved',
      druh: 'uzel',
      uzel: 'farmar-brod',
      nazev: 'Brod u farmy',
      hody: [
        {
          postava: 'bartos',
          karta: { id: 'pesti', nazev: 'Pěsti', tag: 'nasili', sila: 2, hlucna: true },
          pasmo: 'uspech',
          zraneni_pridana: 0,
          bedny_ztracene_timto_hodem: 0,
          tvrdost_aplikovana: null,
          rider: null,
        },
        {
          postava: 'mazur',
          karta: { id: 'uplata', nazev: 'Tučná obálka', tag: 'uplatek', sila: 1, hlucna: false },
          pasmo: 'selhani',
          zraneni_pridana: 1,
          bedny_ztracene_timto_hodem: 1,
          tvrdost_aplikovana: 'bedna',
          rider: null,
        },
      ],
      zbyvaBeden: 4,
      ...prepis,
    };
  }

  it('skládá odstavec na hod, dosazuje příjmení, kartu, uzel a počty', () => {
    const odstavce = zapisUzlu(udalost(), {}, ctx, createVyberSablon(REALNE_SABLONY, pevnyRand([0])));
    expect(odstavce).toHaveLength(2);
    expect(odstavce[0]).toContain('Bartoš');
    expect(odstavce[0]).toContain('Brod u farmy');
    expect(odstavce[0]).toContain('„Pěsti“');
    // {naklad} prvního hodu = stav PŘED ztrátou druhého hodu (5 beden).
    expect(odstavce[0]).toContain('pět beden');
    expect(odstavce[1]).toContain('Mazur');
    expect(odstavce[1]).toContain('jedna bedna');
    expect(odstavce[1]).toContain('čtyři bedny');
    // Žádný nedosazený placeholder nesmí zbýt.
    for (const o of odstavce) expect(o).not.toMatch(/\{\w+\}/);
  });

  it('speciální druh setkání dostává úvodní odstavec, kolaps a hlas z auta se připisují', () => {
    const odstavce = zapisUzlu(
      udalost({ druh: 'lecka', nazev: 'Léčka: Malone' }),
      { kolapsy: [{ postava: 'mazur' }], hlasy: [{ postava: 'bartos' }] },
      ctx,
      createVyberSablon(REALNE_SABLONY, pevnyRand([0]))
    );
    expect(odstavce).toHaveLength(5); // úvod + hlas + 2 hody + kolaps
    expect(odstavce[0]).toContain('léčka');
    expect(odstavce[1]).toContain('Bartoš'); // hlas z auta
    expect(odstavce[4]).toContain('Mazur'); // kolaps
    for (const o of odstavce) expect(o).not.toMatch(/\{\w+\}/);
  });
});

describe('zapisFinale', () => {
  it('DORUČENO i NEVYŘEŠENO mají šablonu a dosazený náklad', () => {
    const vyber = createVyberSablon(REALNE_SABLONY, pevnyRand([0]));
    const doruceno = zapisFinale({ vysledek: 'DORUCENO', zbyvaBeden: 3 }, vyber);
    expect(doruceno[0]).toContain('DORUČENO');
    expect(doruceno[0]).toContain('tři bedny');
    const nevyreseno = zapisFinale({ vysledek: 'NEVYRESENO', zbyvaBeden: 0 }, vyber);
    expect(nevyreseno[0]).toContain('NEVYŘEŠENO');
    expect(nevyreseno[0]).not.toMatch(/\{\w+\}/);
  });
});

describe('reálné šablony pokrývají všechny kombinace, které engine umí vyrobit', () => {
  // Pásma hodů × (zranění, bedna) dosažitelné dle resolučního systému:
  const kombinace = [
    ['uspech', { zraneni: false, bedna: false }],
    ['za_cenu', { zraneni: true, bedna: false }],
    ['za_cenu', { zraneni: true, bedna: true }], // povýšené selhání Úplatku
    ['selhani', { zraneni: true, bedna: false }],
    ['selhani', { zraneni: false, bedna: true }], // rider Útěku: bedna místo zranění
    ['selhani', { zraneni: true, bedna: true }],
  ];
  it.each(kombinace)('%s %o má aspoň jednu šablonu', (pasmo, stav) => {
    const vyber = createVyberSablon(REALNE_SABLONY, pevnyRand([0]));
    expect(vyber(String(pasmo), stav).id).not.toBeNull();
  });

  it.each(['zatah', 'lecka', 'konfrontace', 'kolaps', 'hlas_z_auta', 'finale_doruceno', 'finale_nevyreseno'])(
    'speciální pásmo %s má šablonu',
    (pasmo) => {
      const vyber = createVyberSablon(REALNE_SABLONY, pevnyRand([0]));
      expect(vyber(pasmo).id).not.toBeNull();
    }
  );
});
