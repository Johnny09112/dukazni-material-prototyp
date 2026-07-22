// @ts-check
/**
 * Validace obsahu: reálné content/obsah/*.yaml musí projít schématy
 * (rozbitý YAML od content-generatora spadne v testu, ne za běhu hry) +
 * negativní případy s konkrétními českými hláškami.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseContent } from '../src/content/loader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const obsahDir = path.join(__dirname, '..', 'content', 'obsah');

export function loadRealYaml() {
  const precti = (soubor) => fs.readFileSync(path.join(obsahDir, soubor), 'utf8');
  return {
    karty: precti('karty.yaml'),
    uzly: precti('uzly.yaml'),
    cile: precti('cile.yaml'),
    pronasledovatele: precti('pronasledovatele.yaml'),
  };
}

describe('reálný obsah z content/obsah/', () => {
  it('projde validací a odpovídá cílovým počtům MVP', () => {
    const content = parseContent(loadRealYaml());
    expect(content.karty.filter((k) => k.typ === 'zakladni')).toHaveLength(32);
    expect(content.karty.filter((k) => k.typ === 'prokleta')).toHaveLength(8);
    expect(content.karty.filter((k) => k.typ === 'zoufala')).toHaveLength(4);
    expect(content.uzly.filter((u) => !u.specialni)).toHaveLength(14);
    expect(content.uzly.filter((u) => u.specialni === 'zatah')).toHaveLength(1);
    expect(content.cile).toHaveLength(8);
    expect(content.pronasledovatele).toHaveLength(2);
    expect(content.verze).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('validační chyby (česky, se souborem a id)', () => {
  const zaklad = loadRealYaml();

  it('rozbité YAML', () => {
    expect(() => parseContent({ ...zaklad, karty: 'karty:\n  - id: [rozbite' })).toThrow(/karty\.yaml.*YAML/s);
  });
  it('neplatná síla základní karty', () => {
    const karty = 'karty:\n  - id: spatna-karta\n    nazev: Špatná\n    typ: zakladni\n    tag: lest\n    sila: 5\n    text: "x"\n';
    expect(() => parseContent({ ...zaklad, karty })).toThrow(/spatna-karta.*síla musí být 1–3/s);
  });
  it('prokletá karta bez známého efektu v enginu', () => {
    const karty = 'karty:\n  - id: nova-prokleta\n    nazev: Nová\n    typ: prokleta\n    tag:\n    sila: 0\n    text: "x"\n';
    expect(() => parseContent({ ...zaklad, karty })).toThrow(/nova-prokleta.*nezná mechanický efekt/s);
  });
  it('uzel s neplatnou tvrdostí a afinitou', () => {
    const uzly =
      'uzly:\n  - id: spatny-uzel\n    nazev: X\n    uvod: "x"\n    afinity: {nasili: 1, lest: 0, uplatek: 2}\n    tvrdost: pokuta\n  - id: druhy\n    nazev: Y\n    uvod: "y"\n    afinity: {nasili: 0, lest: 0, uplatek: 0, utek: 0}\n    tvrdost: zar\n  - id: zatah-x\n    nazev: Zátah\n    uvod: "z"\n    afinity: {nasili: 0, lest: 0, uplatek: 0, utek: 0}\n    tvrdost: zar\n    specialni: zatah\n';
    expect(() => parseContent({ ...zaklad, uzly })).toThrow(/spatny-uzel/);
    expect(() => parseContent({ ...zaklad, uzly })).toThrow(/tvrdost „pokuta"/);
    expect(() => parseContent({ ...zaklad, uzly })).toThrow(/postrádají tag „utek"/);
  });
  it('chybějící Zátah-uzel', () => {
    const uzly =
      'uzly:\n  - id: jeden\n    nazev: X\n    uvod: "x"\n    afinity: {nasili: 0, lest: 0, uplatek: 0, utek: 0}\n    tvrdost: zar\n  - id: dva\n    nazev: Y\n    uvod: "y"\n    afinity: {nasili: 0, lest: 0, uplatek: 0, utek: 0}\n    tvrdost: bedna\n';
    expect(() => parseContent({ ...zaklad, uzly })).toThrow(/přesně 1 speciální Zátah-uzel/);
  });
  it('mechanický cíl s neparsovatelnou podmínkou', () => {
    const cile =
      'cile:\n  - id: spatny-cil\n    text: "x"\n    overeni: "x"\n    overeni_typ: mechanicky\n    podminka: "pocet_hodu >= 1"\n    body: 2\n';
    expect(() => parseContent({ ...zaklad, cile })).toThrow(/spatny-cil.*neznámá metrika/s);
  });
  it('textový cíl s podmínkou je chyba', () => {
    const cile =
      'cile:\n  - id: spatny-textovy\n    text: "x"\n    overeni: "x"\n    overeni_typ: textovy\n    podminka: "doruceno"\n    body: 2\n';
    expect(() => parseContent({ ...zaklad, cile })).toThrow(/spatny-textovy.*nesmí mít pole podminka/s);
  });
  it('léčka pronásledovatele musí mít tvrdost zar', () => {
    const pronasledovatele =
      'pronasledovatele:\n  - id: agent-malone\n    nazev: Malone\n    ruseny_tag: uplatek\n    pravidlo: "x"\n    flavor: "x"\n    lecka:\n      uvod: "x"\n      afinity: {nasili: 0, lest: 0, uplatek: 0, utek: 0}\n      tvrdost: bedna\n    konfrontace:\n      uvod: "x"\n      afinity: {nasili: 0, lest: 0, uplatek: 0, utek: 0}\n      tvrdost: zraneni\n';
    expect(() => parseContent({ ...zaklad, pronasledovatele })).toThrow(/lecka musí být „zar"/);
  });
  it('duplicitní id napříč soubory', () => {
    const cile =
      'cile:\n  - id: zatah\n    text: "x"\n    overeni: "x"\n    overeni_typ: mechanicky\n    podminka: "doruceno"\n    body: 1\n';
    expect(() => parseContent({ ...zaklad, cile })).toThrow(/id „zatah" není unikátní/);
  });
});
