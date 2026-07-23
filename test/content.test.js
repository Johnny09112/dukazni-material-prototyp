// @ts-check
/**
 * v3 validace obsahu: reálné content/obsah/*.yaml musí projít v3 schématy
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
    veci: precti('veci.yaml'),
    situace: precti('situace.yaml'),
    postihy: precti('postihy.yaml'),
    mista: precti('mista.yaml'),
    stitky: precti('stitky.yaml'),
    pronasledovatele: precti('pronasledovatele.yaml'),
    cile: precti('cile.yaml'),
    postavy: precti('postavy.yaml'),
  };
}

describe('reálný v3 obsah z content/obsah/', () => {
  it('projde validací a odpovídá cílovým počtům MVP', () => {
    const content = parseContent(loadRealYaml());
    expect(content.veci.length).toBeGreaterThanOrEqual(38); // ~40
    expect(content.situace.filter((s) => s.typ === 'npc' || s.typ === 'lokace').length).toBeGreaterThanOrEqual(10);
    expect(content.situace.filter((s) => s.typ === 'zatah')).toHaveLength(1);
    expect(content.postihy.length).toBeGreaterThanOrEqual(12);
    expect(content.stitky.some((s) => s.id === 'GANGSTER')).toBe(true);
    expect(content.mista.filter((m) => m.typ === 'truhla').length).toBeGreaterThanOrEqual(1);
    expect(content.mista.filter((m) => m.typ === 'motel').length).toBeGreaterThanOrEqual(1);
    expect(content.pronasledovatele).toHaveLength(2);
    expect(content.cile).toHaveLength(8);
    expect(content.postavy).toHaveLength(4);
    expect(content.verze).toMatch(/^[0-9a-f]{8}$/);
  });

  it('každá situace i mini-uzel pronásledovatele má přesně 4 sloty', () => {
    const content = parseContent(loadRealYaml());
    for (const s of content.situace) expect(s.sloty).toHaveLength(4);
    for (const p of content.pronasledovatele) {
      expect(p.lecka.sloty).toHaveLength(4);
      expect(p.konfrontace.sloty).toHaveLength(4);
    }
  });
});

describe('v3 validační chyby (česky, se souborem a id)', () => {
  const zaklad = loadRealYaml();

  it('rozbité YAML', () => {
    expect(() => parseContent({ ...zaklad, veci: 'veci:\n  - id: [rozbite' })).toThrow(/veci\.yaml.*YAML/s);
  });

  it('neplatný stat věci (mimo 0–5)', () => {
    const veci = 'veci:\n  - id: spatna-vec\n    nazev: Špatná\n    staty: { utok: 9, obrana: 0, hodnota: 0, improvizace: 0, nastroj: 0 }\n    text: "x"\n';
    expect(() => parseContent({ ...zaklad, veci })).toThrow(/spatna-vec.*stat utok = 9/s);
  });

  it('neznámý štítek u věci', () => {
    const veci = 'veci:\n  - id: vec-stitek\n    nazev: X\n    staty: { utok: 1, obrana: 1, hodnota: 1, improvizace: 1, nastroj: 1 }\n    stitek: NEEXISTUJE\n    text: "x"\n';
    expect(() => parseContent({ ...zaklad, veci })).toThrow(/vec-stitek.*neznámý štítek/s);
  });

  it('situace se špatnou kotvou', () => {
    const situace = 'situace:\n  - id: spatna-situace\n    typ: npc\n    telegraf: "x"\n    text: "{VEC} {VEC} {VEC} {VEC}"\n    sloty:\n      - { role: a, stat: utok, kotva: 0, viditelnost: viditelna }\n      - { role: b, stat: obrana, kotva: 3, viditelnost: viditelna }\n      - { role: c, stat: hodnota, kotva: 3, viditelnost: viditelna }\n      - { role: d, stat: nastroj, kotva: 3, viditelnost: skryta }\n    pasmove_vysledky:\n      s_nasledky: { postih_lehky: [drobna-pokuta] }\n      prusvih: { postih_tezky: [zlomene-zebro] }\n';
    expect(() => parseContent({ ...zaklad, situace })).toThrow(/kotva musí být 2–4/);
  });

  it('postih s neznámým efektem v enginu', () => {
    const postihy = 'postihy:\n  - id: novy-postih\n    nazev: Nový\n    typ: informacni\n    tier: lehky\n    trvani: 2\n    efekt: { druh: teleportace }\n    text: "x"\n';
    expect(() => parseContent({ ...zaklad, postihy })).toThrow(/novy-postih.*nezná efekt/s);
  });

  it('mechanický cíl s neparsovatelnou podmínkou', () => {
    const cile = 'cile:\n  - id: spatny-cil\n    text: "x"\n    overeni: "x"\n    overeni_typ: mechanicky\n    podminka: "pocet_hodu >= 1"\n    body: 2\n';
    expect(() => parseContent({ ...zaklad, cile })).toThrow(/spatny-cil.*neznámá metrika/s);
  });

  it('situace odkazuje na neexistující postih', () => {
    const situace = 'situace:\n  - id: bad-postih\n    typ: npc\n    telegraf: "x"\n    text: "{VEC} {VEC} {VEC} {VEC}"\n    sloty:\n      - { role: a, stat: utok, kotva: 3, viditelnost: viditelna }\n      - { role: b, stat: obrana, kotva: 3, viditelnost: viditelna }\n      - { role: c, stat: hodnota, kotva: 3, viditelnost: viditelna }\n      - { role: d, stat: nastroj, kotva: 3, viditelnost: skryta }\n    pasmove_vysledky:\n      s_nasledky: { postih_lehky: [neexistujici-postih] }\n      prusvih: { postih_tezky: [zlomene-zebro] }\n';
    expect(() => parseContent({ ...zaklad, situace })).toThrow(/neznámý lehký postih/);
  });

  it('duplicitní id napříč soubory', () => {
    const cile = 'cile:\n  - id: GANGSTER\n    text: "x"\n    overeni: "x"\n    overeni_typ: mechanicky\n    podminka: "doruceno"\n    body: 1\n';
    expect(() => parseContent({ ...zaklad, cile })).toThrow(/id „GANGSTER" není unikátní/);
  });
});
