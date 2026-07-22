// @ts-check
/**
 * Chování stavového automatu runu (state.js): tvrdosti, ridery jako příkazy,
 * prokleté a zoufalé karty, kolaps + hlas z auta, prahy Žáru (Zátah, léčka,
 * konfrontace), konce runu, determinismus.
 *
 * Testy používají syntetický obsah s řízenými zárukami (např. afinita −2 +
 * síla 1 ⇒ hod nikdy nedosáhne na úspěch) — asserce pak platí pro libovolný
 * seed a nejsou závislé na konkrétních hodech.
 */
import { describe, it, expect } from 'vitest';
import { createRun } from '../src/engine/state.js';
import { RULES } from '../src/engine/rules.js';
import {
  syntetickyObsah,
  syntetickeKarty,
  syntetickeUzly,
  prokleteKopie,
  drive,
  hraci,
} from './helpers.js';

/** Obsah, kde každý hod skončí zraněním: lest síla 1, afinita −2 ⇒ max 5. */
function obsahGarantovanaZraneni({ tvrdost = 'zraneni', proklete = prokleteKopie('krec') } = {}) {
  const afinity = { nasili: 0, lest: -2, uplatek: 0, utek: 0 };
  return syntetickyObsah({
    karty: [...syntetickeKarty(20, { tag: 'lest', sila: 1 }), ...proklete],
    uzly: syntetickeUzly({ afinity, tvrdost }),
  });
}

describe('pásma a tvrdosti v běhu', () => {
  it('kolaps: 4. zranění vyřazuje, všichni vyřazení = NEVYŘEŠENO', () => {
    const events = drive(
      createRun({ seed: 11, content: obsahGarantovanaZraneni(), rules: RULES, players: hraci(1) })
    );
    const konec = events.at(-1);
    expect(konec.type).toBe('run_ended');
    expect(konec.vysledek).toBe('NEVYRESENO');
    expect(konec.pricina).toBe('vsichni_vyrazeni');
    const down = events.filter((e) => e.type === 'character_down');
    expect(down).toHaveLength(1);
    expect(down[0].pocetZraneni).toBe(RULES.kolapsPriZraneni);
    // zranění nikdy nepřeteče přes kolaps
    for (const e of events.filter((e) => e.type === 'injury_added')) {
      expect(e.pocetZraneni).toBeLessThanOrEqual(RULES.kolapsPriZraneni);
    }
    // prokletá se líže při 2. a 3. zranění, kolabující 4. už ne
    const lizy = events.filter((e) => e.type === 'cursed_drawn');
    const zraneniDve = events.filter(
      (e) => e.type === 'injury_added' && e.pocetZraneni >= RULES.prokletaOdZraneni && e.pocetZraneni < RULES.kolapsPriZraneni
    );
    expect(lizy.length).toBe(zraneniDve.length);
  });

  it('tvrdost bedna: 0 beden ukončuje run (dosly_bedny), bedny nejdou pod 0', () => {
    for (const seed of [1, 2, 3]) {
      const events = drive(
        createRun({
          seed,
          content: obsahGarantovanaZraneni({ tvrdost: 'bedna' }),
          rules: RULES,
          players: hraci(4),
        })
      );
      const konec = events.at(-1);
      expect(konec.type).toBe('run_ended');
      expect(konec.pricina).toBe('dosly_bedny');
      const ztraty = events.filter((e) => e.type === 'crate_lost');
      expect(ztraty).toHaveLength(RULES.bedenNaStartu);
      expect(ztraty.at(-1).zbyvaBeden).toBe(0);
      expect(ztraty.every((e) => e.duvod === 'tvrdost_uzlu')).toBe(true);
      // po run_ended už nic
      expect(events.filter((e) => e.type === 'run_ended')).toHaveLength(1);
    }
  });

  it('tvrdost zraneni: selhání dává druhé zranění (2 zápisy na jeden hod)', () => {
    const events = drive(
      createRun({ seed: 21, content: obsahGarantovanaZraneni(), rules: RULES, players: hraci(1) })
    );
    const uzelHody = events
      .filter((e) => e.type === 'node_resolved')
      .flatMap((e) => e.hody)
      .filter((h) => h.pasmo === 'selhani' && h.tvrdost_aplikovana === 'zraneni');
    expect(uzelHody.length).toBeGreaterThan(0);
    // aspoň jeden plný zápis (postava nekolabovala v půlce)
    expect(uzelHody.some((h) => h.zraneni_pridana === 2)).toBe(true);
  });

  it('úspěch za cenu = reálné zranění; úspěch bez následků', () => {
    // afinita +2, síla 3 ⇒ minimum 6 = za cenu, jinak úspěch; nikdy selhání
    const afinity = { nasili: 0, lest: 2, uplatek: 0, utek: 0 };
    const content = syntetickyObsah({
      karty: syntetickeKarty(20, { tag: 'lest', sila: 3 }),
      uzly: syntetickeUzly({ afinity, tvrdost: 'zar' }),
    });
    const events = drive(createRun({ seed: 5, content, rules: RULES, players: hraci(2) }));
    const hody = events.filter((e) => e.type === 'node_resolved').flatMap((e) => e.hody);
    expect(hody.length).toBeGreaterThan(0);
    for (const h of hody) {
      expect(['uspech', 'uspech_za_cenu']).toContain(h.pasmo);
      if (h.pasmo === 'uspech') {
        expect(h.zraneni_pridana).toBe(0);
        expect(h.bedny_ztracene_timto_hodem).toBe(0);
      } else {
        expect(h.zraneni_pridana).toBeGreaterThanOrEqual(1);
      }
    }
    // žádné selhání ⇒ žádný Žár za selhání uzlu
    expect(events.some((e) => e.type === 'heat_changed' && e.duvod === 'selhani_v_uzlu')).toBe(false);
  });
});

describe('ridery tagů jako příkazy', () => {
  it('Útěk: volba bedna — bedna padá riderem, tvrdost se uplatní i tak, zranění žádné', () => {
    const afinity = { nasili: 0, lest: 0, uplatek: 0, utek: -2 };
    const content = syntetickyObsah({
      karty: syntetickeKarty(20, { tag: 'utek', sila: 1 }),
      uzly: syntetickeUzly({ afinity, tvrdost: 'bedna' }),
    });
    /** @type {object[]} */
    const nabidnuteRidery = [];
    const events = drive(createRun({ seed: 3, content, rules: RULES, players: hraci(1) }), {
      pickRider: (pending) => {
        nabidnuteRidery.push(pending);
        return 'bedna';
      },
    });
    expect(nabidnuteRidery.length).toBeGreaterThan(0);
    expect(nabidnuteRidery[0]).toMatchObject({ typ: 'utek', volby: ['zraneni', 'bedna'] });
    const hody = events
      .filter((e) => e.type === 'node_resolved')
      .flatMap((e) => e.hody)
      .filter((h) => h.rider?.typ === 'utek' && h.rider?.volba === 'bedna');
    expect(hody.length).toBeGreaterThan(0);
    // plný případ: rider bedna + tvrdost bedna = 2 bedny jedním hodem, bez zranění
    expect(hody.some((h) => h.bedny_ztracene_timto_hodem === 2)).toBe(true);
    for (const h of hody) expect(h.zraneni_pridana).toBe(0);
    expect(events.some((e) => e.type === 'crate_lost' && e.duvod === 'rider_utek')).toBe(true);
  });

  it('Útěk: volba zranění — bedna riderem nepadá', () => {
    const afinity = { nasili: 0, lest: 0, uplatek: 0, utek: -2 };
    const content = syntetickyObsah({
      karty: syntetickeKarty(20, { tag: 'utek', sila: 1 }),
      uzly: syntetickeUzly({ afinity, tvrdost: 'zar' }),
    });
    const events = drive(createRun({ seed: 3, content, rules: RULES, players: hraci(1) }), {
      pickRider: () => 'zraneni',
    });
    expect(events.some((e) => e.type === 'crate_lost' && e.duvod === 'rider_utek')).toBe(false);
    const hody = events
      .filter((e) => e.type === 'node_resolved')
      .flatMap((e) => e.hody)
      .filter((h) => h.rider?.typ === 'utek');
    expect(hody.length).toBeGreaterThan(0);
    for (const h of hody) expect(h.zraneni_pridana).toBeGreaterThanOrEqual(1);
  });

  it('Úplatek: zaplacení bedny povyšuje na úspěch za cenu — bez tvrdosti, nepočítá se jako selhání', () => {
    const afinity = { nasili: 0, lest: 0, uplatek: -2, utek: 0 };
    const content = syntetickyObsah({
      karty: syntetickeKarty(20, { tag: 'uplatek', sila: 1 }),
      uzly: syntetickeUzly({ afinity, tvrdost: 'zraneni' }),
    });
    const events = drive(createRun({ seed: 8, content, rules: RULES, players: hraci(1) }), {
      pickRider: () => 'zaplatit_bednu',
    });
    const povysene = events.filter((e) => e.type === 'check_resolved' && e.povysenoZeSelhani);
    expect(povysene.length).toBeGreaterThan(0);
    for (const ch of povysene) {
      expect(ch.pasmo).toBe('uspech_za_cenu');
      expect(ch.tvrdostAplikovana).toBeNull();
    }
    expect(events.some((e) => e.type === 'crate_lost' && e.duvod === 'rider_uplatek')).toBe(true);
    // všechna selhání se zaplatila ⇒ nikdy nepadl Žár za selhání uzlu
    expect(events.some((e) => e.type === 'heat_changed' && e.duvod === 'selhani_v_uzlu')).toBe(false);
  });
});

describe('prokleté karty', () => {
  it('zákaz tagu (Křeč): postava s aktivní prokletou nesmí hrát Násilí', () => {
    // ruka míchá nasili a lest; zranění garantuje líznutí prokletých
    const afinity = { nasili: -2, lest: -2, uplatek: 0, utek: 0 };
    const content = syntetickyObsah({
      karty: [
        ...syntetickeKarty(10, { tag: 'nasili', sila: 1, hlucna: false }),
        ...syntetickeKarty(10, { tag: 'lest', sila: 1 }),
        ...prokleteKopie('krec'),
      ],
      uzly: syntetickeUzly({ afinity, tvrdost: 'zraneni' }),
    });
    let overeno = 0;
    drive(createRun({ seed: 17, content, rules: RULES, players: hraci(2) }), {
      probe: (s, run) => {
        for (const p of s.postavy.filter((x) => !x.vyrazena)) {
          if (p.aktivniProkleta?.id === 'krec' && p.ruka.some((k) => k.tag === 'lest')) {
            const legal = run.getLegalPlays(p.id);
            expect(legal.every((v) => v.karta.tag !== 'nasili')).toBe(true);
            overeno += 1;
          }
        }
      },
    });
    expect(overeno).toBeGreaterThan(0);
  });

  it('Zbrklost: jen karty s nejvyšší silou mezi povolenými, zahrání je vynucené', () => {
    const afinity = { nasili: 0, lest: -2, uplatek: 0, utek: 0 };
    const content = syntetickyObsah({
      karty: [
        ...syntetickeKarty(10, { tag: 'lest', sila: 1 }),
        ...syntetickeKarty(10, { tag: 'lest', sila: 3, id: 'silna' }),
        ...prokleteKopie('zbrklost'),
      ],
      uzly: syntetickeUzly({ afinity, tvrdost: 'zraneni' }),
    });
    let overeno = 0;
    const events = drive(createRun({ seed: 29, content, rules: RULES, players: hraci(2) }), {
      probe: (s, run) => {
        for (const p of s.postavy.filter((x) => !x.vyrazena)) {
          if (p.aktivniProkleta?.id === 'zbrklost') {
            const maxVRuce = Math.max(...p.ruka.map((k) => k.sila));
            const legal = run.getLegalPlays(p.id).filter((v) => !v.zoufala);
            expect(legal.length).toBeGreaterThan(0);
            for (const v of legal) {
              expect(v.karta.sila).toBe(maxVRuce);
              expect(v.dobrovolna).toBe(false);
            }
            overeno += 1;
          }
        }
      },
    });
    expect(overeno).toBeGreaterThan(0);
    // vynucené zahrání je v logu dobrovolna: false
    expect(events.some((e) => e.type === 'card_played' && e.dobrovolna === false)).toBe(true);
  });

  it('Kocovina: −2 k hodu v modifikátorech', () => {
    // 1 hráč: žádný hlas z auta, modifikátor je čistě z prokleté
    const content = obsahGarantovanaZraneni({ proklete: prokleteKopie('kocovina') });
    /** @type {{postava: string, nodeIndex: number}[]} */
    const zasazene = [];
    const events = drive(createRun({ seed: 31, content, rules: RULES, players: hraci(1) }), {
      probe: (s) => {
        for (const p of s.postavy.filter((x) => !x.vyrazena)) {
          if (p.aktivniProkleta?.id === 'kocovina') {
            zasazene.push({ postava: p.id, nodeIndex: s.nodeIndex });
          }
        }
      },
    });
    expect(zasazene.length).toBeGreaterThan(0);
    for (const z of zasazene) {
      const check = events.find(
        (e) => e.type === 'check_resolved' && e.postava === z.postava && e.nodeIndex === z.nodeIndex
      );
      expect(check.modifikatory).toBe(-2);
    }
  });

  it('Nutkání ochutnat: −2 a hlučnost i u nehlučné karty', () => {
    const content = obsahGarantovanaZraneni({ proklete: prokleteKopie('nutkani-ochutnat') });
    const events = drive(createRun({ seed: 37, content, rules: RULES, players: hraci(2) }));
    // karty lest nejsou hlučné — hlučnost může přijít jen z prokleté
    expect(events.some((e) => e.type === 'heat_changed' && e.duvod === 'hlucna_karta')).toBe(true);
  });

  it('Ztráta důstojnosti: selhání týmu v uzlu = +1 Žár navíc', () => {
    // tvrdost zraneni: Žár nesaturuje (clamp na 10 by +1 navíc spolkl)
    // a 4 hráči zaručí, že tým nekolabuje celý v jednom uzlu
    const content = obsahGarantovanaZraneni({ proklete: prokleteKopie('ztrata-dustojnosti') });
    let vyskyt = false;
    for (const seed of [41, 1, 2, 3]) {
      const events = drive(createRun({ seed, content, rules: RULES, players: hraci(4) }));
      if (events.some((e) => e.type === 'heat_changed' && e.duvod === 'ztrata_dustojnosti')) {
        vyskyt = true;
        break;
      }
    }
    expect(vyskyt).toBe(true);
  });
});

describe('zoufalé karty', () => {
  it('od 3 zranění v nabídce, ignorují postih, hrají se jako nedobrovolné', () => {
    const afinity = { nasili: 0, lest: -2, uplatek: 0, utek: 0 };
    const content = syntetickyObsah({
      karty: [
        ...syntetickeKarty(20, { tag: 'lest', sila: 1 }),
        ...prokleteKopie('krec'),
        {
          id: 'zoufala-lest',
          nazev: 'Zoufalá',
          typ: 'zoufala',
          tag: 'lest',
          sila: 3,
          podminka: '3+ zranění',
          text: 'test',
        },
      ],
      uzly: syntetickeUzly({ afinity, tvrdost: 'zraneni' }),
    });
    const events = drive(createRun({ seed: 43, content, rules: RULES, players: hraci(2) }), {
      probe: (s, run) => {
        for (const p of s.postavy.filter((x) => !x.vyrazena)) {
          const legal = run.getLegalPlays(p.id);
          const zoufale = legal.filter((v) => v.zoufala);
          if (p.zraneni >= RULES.zoufalaOdZraneni) {
            expect(zoufale.length).toBeGreaterThan(0);
            expect(zoufale.every((v) => v.dobrovolna === false)).toBe(true);
          } else {
            expect(zoufale).toHaveLength(0);
          }
        }
      },
      pickPlay: (legal) => legal.find((v) => v.zoufala) ?? legal[0],
    });
    const zoufaleZahrane = events.filter((e) => e.type === 'card_played' && e.zoufala);
    expect(zoufaleZahrane.length).toBeGreaterThan(0);
    for (const z of zoufaleZahrane) {
      expect(z.dobrovolna).toBe(false);
      const check = events.find(
        (e) => e.type === 'check_resolved' && e.postava === z.postava && e.nodeIndex === z.nodeIndex
      );
      expect(check.postihZraneni).toBe(0);
    }
  });
});

describe('politika zoufalých karet (rules.zoufalePolitika)', () => {
  /** Garantovaná zranění + 2 zoufalé lest karty (síla 3). */
  function obsahSeZoufalymi() {
    const afinity = { nasili: 0, lest: -2, uplatek: 0, utek: 0 };
    return syntetickyObsah({
      karty: [
        ...syntetickeKarty(20, { tag: 'lest', sila: 1 }),
        ...prokleteKopie('krec'),
        { id: 'zoufala-a', nazev: 'Zoufalá A', typ: 'zoufala', tag: 'lest', sila: 3, podminka: '3+ zranění', text: 't' },
        { id: 'zoufala-b', nazev: 'Zoufalá B', typ: 'zoufala', tag: 'lest', sila: 3, podminka: '3+ zranění', text: 't' },
      ],
      uzly: syntetickeUzly({ afinity, tvrdost: 'zraneni' }),
    });
  }
  const prefZoufala = (legal) => legal.find((v) => v.zoufala) ?? legal[0];

  it('pool (default): zoufalé se hrají a neubývají', () => {
    let zahranoCelkem = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const events = drive(
        createRun({ seed, content: obsahSeZoufalymi(), rules: RULES, players: hraci(2) }),
        { pickPlay: prefZoufala }
      );
      zahranoCelkem += events.filter((e) => e.type === 'card_played' && e.zoufala).length;
    }
    expect(zahranoCelkem).toBeGreaterThan(0);
  });

  it('pool-once: každá zoufalá jde za run zahrát jen jednou', () => {
    const rules = { ...RULES, zoufalePolitika: 'pool-once' };
    for (const seed of [1, 2, 3, 4, 5]) {
      const events = drive(
        createRun({ seed, content: obsahSeZoufalymi(), rules, players: hraci(2) }),
        { pickPlay: prefZoufala }
      );
      const zoufale = events.filter((e) => e.type === 'card_played' && e.zoufala);
      const poIds = new Map();
      for (const z of zoufale) poIds.set(z.karta.id, (poIds.get(z.karta.id) ?? 0) + 1);
      for (const pocet of poIds.values()) expect(pocet).toBe(1);
      expect(zoufale.length).toBeLessThanOrEqual(2); // v obsahu jsou 2 zoufalé
    }
  });

  it('dealt: každá postava hraje svou rozdanou zoufalou nejvýš jednou', () => {
    const rules = { ...RULES, zoufalePolitika: 'dealt' };
    let zahranoNekde = false;
    for (const seed of [1, 2, 3, 4, 5]) {
      const events = drive(
        createRun({ seed, content: obsahSeZoufalymi(), rules, players: hraci(2) }),
        { pickPlay: prefZoufala }
      );
      const poPostave = new Map();
      for (const z of events.filter((e) => e.type === 'card_played' && e.zoufala)) {
        poPostave.set(z.postava, (poPostave.get(z.postava) ?? 0) + 1);
        zahranoNekde = true;
      }
      for (const pocet of poPostave.values()) expect(pocet).toBe(1);
    }
    expect(zahranoNekde).toBe(true);
  });

  it('none: zoufalé nejsou v nabídce a nikdy se nezahrají', () => {
    const rules = { ...RULES, zoufalePolitika: 'none' };
    const events = drive(
      createRun({ seed: 1, content: obsahSeZoufalymi(), rules, players: hraci(2) }),
      {
        probe: (s, run) => {
          for (const p of s.postavy.filter((x) => !x.vyrazena)) {
            expect(run.getLegalPlays(p.id).every((v) => !v.zoufala)).toBe(true);
          }
        },
        pickPlay: prefZoufala,
      }
    );
    expect(events.some((e) => e.type === 'card_played' && e.zoufala)).toBe(false);
  });

  it('varianty nemění default: explicitní pool + buff 1 dává identický log jako RULES', () => {
    const explicitni = { ...RULES, zoufalePolitika: 'pool', hlasZAutaBonus: 1 };
    const a = drive(createRun({ seed: 13, content: obsahSeZoufalymi(), rules: RULES, players: hraci(2) }));
    const b = drive(createRun({ seed: 13, content: obsahSeZoufalymi(), rules: explicitni, players: hraci(2) }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('hlas z auta s bonusem 0 (kalibrační varianta)', () => {
  it('větev bonus je mechanicky prázdná — žádný hod nedostane kladný modifikátor', () => {
    const rules = { ...RULES, hlasZAutaBonus: 0 };
    for (const seed of [1, 2, 3, 4, 5]) {
      const events = drive(
        createRun({ seed, content: obsahGarantovanaZraneni(), rules, players: hraci(4) }),
        { pickVoice: (s) => ({ volba: 'bonus', cil: s.postavy.find((p) => !p.vyrazena).id }) }
      );
      for (const e of events.filter((x) => x.type === 'check_resolved')) {
        expect(e.modifikatory).toBe(0); // prokleté jsou jen Křeč (bez modu hodu)
      }
    }
  });
});

describe('hlas z auta', () => {
  it('bonus +1 se propíše do hodu cíle; prokletá jde cíli do fronty', () => {
    // hledáme seedy s oknem pro hlas z auta: 4 hráči kolabují rozfázovaně,
    // vyřazení pak volí mezi bonusem a prokletou pro živé spoluhráče
    let overeneBonusy = 0;
    let prokletaDana = false;
    for (let seed = 1; seed <= 40 && !(overeneBonusy > 0 && prokletaDana); seed++) {
      /** @type {{cil: string, nodeIndex: number}[]} */
      const bonusy = [];
      let prokletaTentoRun = false;
      const events = drive(
        createRun({
          seed,
          content: obsahGarantovanaZraneni(),
          rules: RULES,
          players: hraci(4),
        }),
        {
          pickVoice: (s) => {
            const cil = s.postavy.find((p) => !p.vyrazena).id;
            if (!prokletaTentoRun) {
              prokletaTentoRun = true;
              return { volba: 'prokleta', cil };
            }
            bonusy.push({ cil, nodeIndex: s.nodeIndex });
            return { volba: 'bonus', cil };
          },
        }
      );
      if (prokletaTentoRun) prokletaDana = true;
      for (const b of bonusy) {
        const check = events.find(
          (e) => e.type === 'check_resolved' && e.postava === b.cil && e.nodeIndex === b.nodeIndex
        );
        expect(check.modifikatory).toBeGreaterThanOrEqual(RULES.hlasZAutaBonus);
        overeneBonusy += 1;
      }
    }
    // obě větve hlasu z auta se v dávce seedů skutečně použily
    expect(prokletaDana).toBe(true);
    expect(overeneBonusy).toBeGreaterThan(0);
  });
});

describe('prahy Žáru: Zátah, léčka, konfrontace', () => {
  /** Hlučný obsah: Žár roste +2/uzel (2 hráči × hlučná karta), bez selhání z tvrdosti zar. */
  function hlucnyObsah() {
    const afinity = { nasili: 2, lest: 0, uplatek: 0, utek: 0 };
    return syntetickyObsah({
      karty: syntetickeKarty(20, { tag: 'nasili', sila: 3, hlucna: true }),
      uzly: syntetickeUzly({ afinity, tvrdost: 'zraneni' }),
      pronasledovatele: syntetickyObsah().pronasledovatele.map((p) => ({
        ...p,
        lecka: { ...p.lecka, afinity: { ...afinity } },
        konfrontace: { ...p.konfrontace, afinity: { ...afinity } },
      })),
    });
  }

  it('práh 5 nahradí příští nabídku cest Zátahem; práh 7 vloží léčku; práh 10 konfrontaci a přežití sráží Žár na 3', () => {
    let zatahOveren = 0;
    let leckaOverena = 0;
    let konfrontaceOverena = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const events = drive(
        createRun({
          seed,
          content: hlucnyObsah(),
          rules: RULES,
          players: hraci(2),
          pronasledovatelId: 'agent-malone',
        })
      );
      const prah5 = events.findIndex((e) => e.type === 'heat_threshold' && e.prah === RULES.zar.prahy.zatah);
      if (prah5 >= 0) {
        const dalsiNabidka = events.slice(prah5).find((e) => e.type === 'route_offered');
        const konfrontaceMezi = events
          .slice(prah5, dalsiNabidka ? events.indexOf(dalsiNabidka) : undefined)
          .some((e) => e.type === 'confrontation_started');
        if (dalsiNabidka && !konfrontaceMezi) {
          expect(dalsiNabidka.zatah).toBe(true);
          expect(dalsiNabidka.nabidnuto).toEqual(['zatah-test']);
          zatahOveren += 1;
        }
      }
      const lecka = events.find((e) => e.type === 'ambush_inserted');
      if (lecka) {
        expect(events.some((e) => e.type === 'heat_threshold' && e.prah === RULES.zar.prahy.lecka)).toBe(true);
        const uzelLecky = events.slice(events.indexOf(lecka)).find((e) => e.type === 'node_resolved');
        expect(uzelLecky.druh).toBe('lecka');
        expect(uzelLecky.uzel).toBe('agent-malone-lecka');
        leckaOverena += 1;
      }
      const konfrontace = events.find((e) => e.type === 'confrontation_started');
      if (konfrontace) {
        const uzelKonfrontace = events
          .slice(events.indexOf(konfrontace))
          .find((e) => e.type === 'node_resolved');
        expect(uzelKonfrontace.druh).toBe('konfrontace');
        const poKonfrontaci = events.slice(events.indexOf(uzelKonfrontace) + 1);
        if (poKonfrontaci.some((e) => e.type !== 'run_ended')) {
          const reset = poKonfrontaci.find(
            (e) => e.type === 'heat_changed' && e.duvod === 'preziti_konfrontace'
          );
          expect(reset.novaHodnota).toBe(RULES.zar.poPrezitiKonfrontace);
          konfrontaceOverena += 1;
        }
      }
    }
    // scénáře musí v dávce seedů skutečně nastat, jinak test nic neměří
    expect(zatahOveren).toBeGreaterThan(0);
    expect(leckaOverena).toBeGreaterThan(0);
    expect(konfrontaceOverena).toBeGreaterThan(0);
  });

  it('Brody: hlučná karta +2 Žár, Malone +1', () => {
    const content = hlucnyObsah();
    const uMalone = drive(
      createRun({ seed: 9, content, rules: RULES, players: hraci(1), pronasledovatelId: 'agent-malone' })
    ).find((e) => e.type === 'heat_changed' && e.duvod === 'hlucna_karta');
    const uBrodyho = drive(
      createRun({ seed: 9, content, rules: RULES, players: hraci(1), pronasledovatelId: 'serif-brody' })
    ).find((e) => e.type === 'heat_changed' && e.duvod === 'hlucna_karta');
    expect(uMalone.delta).toBe(1);
    expect(uBrodyho.delta).toBe(2);
  });
});

describe('determinismus (ADR-002)', () => {
  it('stejný seed + stejné volby = bit-přesně stejný log', () => {
    const content = obsahGarantovanaZraneni();
    const a = drive(createRun({ seed: 99, content, rules: RULES, players: hraci(3) }));
    const b = drive(createRun({ seed: 99, content, rules: RULES, players: hraci(3) }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it('jiný seed = jiný run', () => {
    const content = obsahGarantovanaZraneni();
    const a = drive(createRun({ seed: 99, content, rules: RULES, players: hraci(3) }));
    const c = drive(createRun({ seed: 100, content, rules: RULES, players: hraci(3) }));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });
});
