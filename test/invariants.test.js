// @ts-check
/**
 * Invarianty událostního logu nad reálným obsahem: dávka náhodných i greedy
 * runů, u nichž musí platit strukturální pravidla bez ohledu na seed.
 */
import { describe, it, expect } from 'vitest';
import { parseContent } from '../src/content/loader.js';
import { RULES } from '../src/engine/rules.js';
import { playRun } from '../sim/run.js';
import { loadRealYaml } from './content.test.js';
import { hraci } from './helpers.js';

const content = parseContent(loadRealYaml());

function davka() {
  /** @type {object[][]} */
  const logy = [];
  for (const strategyName of ['random', 'greedy-affinity']) {
    for (const pronasledovatelId of ['agent-malone', 'serif-brody']) {
      for (let seed = 1; seed <= 25; seed++) {
        logy.push(
          playRun({ seed, content, rules: RULES, players: hraci(4), pronasledovatelId, strategyName })
        );
      }
    }
  }
  return logy;
}

describe('invarianty logu (100 runů: random + greedy × oba pronásledovatelé)', () => {
  const logy = davka();

  it('log začíná run_started, končí právě jedním run_ended, seq roste o 1', () => {
    for (const events of logy) {
      expect(events[0].type).toBe('run_started');
      expect(events.at(-1).type).toBe('run_ended');
      expect(events.filter((e) => e.type === 'run_ended')).toHaveLength(1);
      events.forEach((e, i) => expect(e.seq).toBe(i + 1));
    }
  });

  it('Žár drží 0–10, bedny klesají monotónně a nikdy pod 0', () => {
    for (const events of logy) {
      for (const e of events) {
        if (e.type === 'heat_changed') {
          expect(e.novaHodnota).toBeGreaterThanOrEqual(0);
          expect(e.novaHodnota).toBeLessThanOrEqual(RULES.zar.max);
        }
      }
      let bedny = RULES.bedenNaStartu;
      for (const e of events.filter((x) => x.type === 'crate_lost')) {
        bedny -= 1;
        expect(e.zbyvaBeden).toBe(bedny);
      }
      expect(bedny).toBeGreaterThanOrEqual(0);
    }
  });

  it('DORUČENO právě po 6 uzlech; příčiny konce odpovídají stavu', () => {
    for (const events of logy) {
      const konec = events.at(-1);
      if (konec.vysledek === 'DORUCENO') {
        expect(konec.pricina).toBe('doruceno');
        expect(konec.pocetUzlu).toBe(RULES.uzluNaRun);
      } else {
        expect(['dosly_bedny', 'vsichni_vyrazeni']).toContain(konec.pricina);
        if (konec.pricina === 'dosly_bedny') expect(konec.zbyvaBeden).toBe(0);
      }
    }
  });

  it('zranění nepřeteče kolaps; character_down přesně při 4. zranění', () => {
    for (const events of logy) {
      for (const e of events.filter((x) => x.type === 'injury_added')) {
        expect(e.pocetZraneni).toBeLessThanOrEqual(RULES.kolapsPriZraneni);
      }
      for (const e of events.filter((x) => x.type === 'character_down')) {
        expect(e.pocetZraneni).toBe(RULES.kolapsPriZraneni);
      }
    }
  });

  it('hody v node_resolved: úspěch bez následků, tvrdost bedna = ztracená bedna v hodu', () => {
    for (const events of logy) {
      const hody = events.filter((e) => e.type === 'node_resolved').flatMap((e) => e.hody);
      for (const h of hody) {
        expect(h.bedny_ztracene_timto_hodem).toBeGreaterThanOrEqual(0);
        expect(h.bedny_ztracene_timto_hodem).toBeLessThanOrEqual(2);
        if (h.pasmo === 'uspech') {
          expect(h.zraneni_pridana).toBe(0);
          expect(h.bedny_ztracene_timto_hodem).toBe(0);
          expect(h.tvrdost_aplikovana).toBeNull();
        }
        if (h.tvrdost_aplikovana === 'bedna') {
          expect(h.bedny_ztracene_timto_hodem).toBeGreaterThanOrEqual(1);
        }
        if (h.povyseno_ze_selhani) {
          expect(h.pasmo).toBe('uspech_za_cenu');
          expect(h.tvrdost_aplikovana).toBeNull();
        }
      }
    }
  });

  it('crate_lost nese atribuci postavy a platný důvod', () => {
    const povolene = ['hod_selhani', 'rider_uplatek', 'rider_utek', 'tvrdost_uzlu'];
    for (const events of logy) {
      const postavy = new Set(events[0].postavy);
      for (const e of events.filter((x) => x.type === 'crate_lost')) {
        expect(povolene).toContain(e.duvod);
        expect(postavy.has(e.postava)).toBe(true);
      }
    }
  });

  it('aritmetika hodů: součet, pásmo, afinita dle uzlu, Maloneovo nulování síly', () => {
    const uzelById = new Map(content.uzly.map((u) => [u.id, u]));
    for (const events of logy) {
      const pronasledovatel = events[0].pronasledovatel;
      const pursuerDef = content.pronasledovatele.find((p) => p.id === pronasledovatel);
      // checky setkání předcházejí jeho node_resolved — párování je sekvenční 1:1
      /** @type {object[]} */
      let fronta = [];
      /** @type {[object, object, object][]} */
      const pary = [];
      for (const e of events) {
        if (e.type === 'check_resolved') fronta.push(e);
        if (e.type === 'node_resolved') {
          expect(fronta.length).toBe(e.hody.length);
          e.hody.forEach((h, i) => pary.push([e, h, fronta[i]]));
          fronta = [];
        }
      }
      for (const [node, h, check] of pary) {
        const afinity =
          node.druh === 'lecka'
            ? pursuerDef.lecka.afinity
            : node.druh === 'konfrontace'
              ? pursuerDef.konfrontace.afinity
              : uzelById.get(node.uzel).afinity;
        {
          expect(check.postava).toBe(h.postava);
          expect(check.hod).toBe(h.hod);
          // součet = d6 + síla + afinita − postih + modifikátory
          expect(check.soucet).toBe(
            check.hod + check.sila + check.afinita - check.postihZraneni + check.modifikatory
          );
          // afinita odpovídá uzlu a tagu karty
          expect(check.afinita).toBe(afinity[h.karta.tag] ?? 0);
          // pásmo odpovídá součtu (povýšení mění selhání na úspěch za cenu)
          const zPasma =
            check.soucet >= RULES.prahUspechu
              ? 'uspech'
              : check.soucet >= RULES.prahUspechuZaCenu
                ? 'uspech_za_cenu'
                : 'selhani';
          if (check.povysenoZeSelhani) {
            expect(zPasma).toBe('selhani');
            expect(check.pasmo).toBe('uspech_za_cenu');
          } else {
            expect(check.pasmo).toBe(zPasma);
          }
          // Malone: Úplatek má sílu 0 na jeho uzlech, jinak síla karty
          const jehoUzel = ['zatah', 'lecka', 'konfrontace'].includes(node.druh);
          if (pronasledovatel === 'agent-malone' && jehoUzel && h.karta.tag === 'uplatek') {
            expect(check.sila).toBe(0);
          } else {
            expect(check.sila).toBe(h.karta.sila);
          }
        }
      }
    }
  });

  it('Žár: hodnota jde rekonstruovat z delt a nikdy neuteče mimo 0–10', () => {
    for (const events of logy) {
      let zar = 0;
      for (const e of events) {
        if (e.type === 'heat_changed') {
          zar += e.delta;
          expect(zar).toBe(e.novaHodnota);
        }
        if (e.type === 'node_resolved') expect(e.zar).toBe(zar);
      }
    }
  });

  it('run_ended.cile: mechanické cíle mají bool, textové null a 0 bodů', () => {
    for (const events of logy) {
      const konec = events.at(-1);
      expect(konec.cile).toHaveLength(4);
      for (const c of konec.cile) {
        if (c.textovy) {
          expect(c.splnen).toBeNull();
          expect(c.body).toBe(0);
        } else {
          expect(typeof c.splnen).toBe('boolean');
        }
      }
    }
  });
});
