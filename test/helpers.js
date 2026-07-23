// @ts-check
/**
 * Sdílení pro v3 testy: syntetický slotový obsah s řízenými zárukami
 * a deterministický driver runu, který projede všechny fáze
 * (map → commit → assign → confirm → …).
 */

/** Věc s pěti staty (default 0). */
export function vec(id, staty = {}, extra = {}) {
  const base = { utok: 0, obrana: 0, hodnota: 0, improvizace: 0, nastroj: 0 };
  return { id, nazev: id, staty: { ...base, ...staty }, svet: 'sdilena', premiova: false, text: 'x', ...extra };
}

/**
 * Balík věcí: N specialistů na každý stat (silných), aby šla situace splnit.
 * Volitelně pár GANGSTER zbraní.
 */
export function balikVeci({ naStat = 8, gangster = 2 } = {}) {
  const staty = ['utok', 'obrana', 'hodnota', 'improvizace', 'nastroj'];
  const out = [];
  for (const s of staty) {
    for (let i = 0; i < naStat; i++) out.push(vec(`${s}-${i}`, { [s]: 5 }));
  }
  for (let i = 0; i < gangster; i++) out.push(vec(`zbran-${i}`, { utok: 5 }, { stitek: 'GANGSTER' }));
  return out;
}

/** Situace se 4 sloty na dané staty (default útok/obrana/hodnota/nástroj). */
export function situace(id, opts = {}) {
  const { typ = 'npc', staty = ['utok', 'obrana', 'hodnota', 'nastroj'], kotva = 3, skryty = 3 } = opts;
  return {
    id,
    typ,
    svet: '1930',
    telegraf: 'test',
    text: 'x',
    sloty: staty.map((s, i) => ({
      role: `role-${i}`,
      stat: s,
      kotva,
      viditelnost: i === skryty ? 'skryta' : 'viditelna',
    })),
    pasmove_vysledky: {
      hladce_loot: { loot: 'karta' },
      s_nasledky: { postih_lehky: ['lehky-info'] },
      prusvih: { postih_tezky: ['tezky-lock'] },
    },
  };
}

/** Minimální validní v3 obsah pro engine (ne přes loader — přímo). */
export function syntetickyObsah(prepis = {}) {
  const stitky = [
    {
      id: 'GANGSTER',
      nazev: 'Gangster',
      parametry: {
        chovani_dle_typu: { npc: 'viditelna_role_selze', lecka: 'viditelna_role_selze', lokace: 'vzdy_pass', zatah: 'vzdy_pass', konfrontace: 'vzdy_pass' },
        hlucnost_zar: 1,
      },
    },
  ];
  const postihy = [
    { id: 'lehky-info', nazev: 'Lehký', typ: 'informacni', tier: 'lehky', trvani: 2, efekt: { druh: 'hide_staty' } },
    { id: 'tezky-lock', nazev: 'Těžký', typ: 'zamkovy', tier: 'tezky', trvani: 'do_vyleceni', efekt: { druh: 'lock_gamble' } },
  ];
  const pronasledovatele = [
    mkPursuer('agent-malone', { typ: 'stat', cil: 'hodnota' }),
    mkPursuer('serif-brody', { typ: 'stitek', cil: 'GANGSTER' }),
  ];
  const mista = [
    { id: 'truhla-a', typ: 'truhla', svet: '1930', text: 'x', odmena: { kredity_rozsah: [4, 6], vyber_karty: true } },
    { id: 'motel-a', typ: 'motel', svet: '1930', text: 'x', sluzby: { smena_karty: 3, leceni_tezkeho: 6 } },
  ];
  return {
    veci: balikVeci(),
    situace: [situace('s1'), situace('s2'), situace('s3'), situace('s4'), situace('s5'), situace('s6'), situace('s7'), situace('s8'), situace('zatah', { typ: 'zatah' })],
    postihy,
    stitky,
    mista,
    pronasledovatele,
    cile: [],
    postavy: [{ id: 'bartos', jmeno: 'Vincenc Bartoš' }, { id: 'kowalski', jmeno: 'Frank Kowalski' }],
    verze: 'test',
    ...prepis,
  };
}

function mkPursuer(id, rusi) {
  const situ = (t) => ({
    typ: t,
    svet: '1930',
    telegraf: 'test',
    text: 'x',
    sloty: ['utok', 'obrana', 'improvizace', 'utok'].map((s, i) => ({ role: `r${i}`, stat: s, kotva: 3, viditelnost: i === 3 ? 'skryta' : 'viditelna' })),
    pasmove_vysledky: { hladce_loot: { loot: 'karta' }, s_nasledky: { postih_lehky: ['lehky-info'] }, prusvih: { postih_tezky: ['tezky-lock'] } },
  });
  return {
    id,
    nazev: id,
    rusi: { ...rusi, pravidlo: 'test' },
    flavor: 'test',
    lecka: situ('lecka'),
    konfrontace: situ('konfrontace'),
  };
}

/** Hráči postava-1..N (nebo z obsahu). */
export function hraci(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}` }));
}

/**
 * Deterministický driver: bez zadání committne první legální karty, přiřadí je
 * do slotů popořadě, potvrdí; na mapě volí první nabídku; motel „dál".
 *
 * @param {ReturnType<import('../src/engine/state.js').createRun>} run
 * @param {object} [opts]
 * @param {(legal, hrac, state) => object} [opts.pickCommit]
 * @param {(state) => {slotIndex:number, cardId:string}[]} [opts.pickAssign]
 * @param {(state) => string} [opts.pickRoute]
 * @param {(state) => 'ukryt'|'dal'} [opts.pickMotel]
 * @param {(state, run) => void} [opts.probe]
 * @returns {object[]} kompletní událostní log
 */
export function drive(run, opts = {}) {
  let pojistka = 0;
  for (;;) {
    const s = run.getState();
    if (s.faze === 'ended') return run.getEvents();
    if (++pojistka > 5000) throw new Error(`drive: run se nezastavil (fáze ${s.faze}).`);

    if (s.faze === 'map') {
      run.chooseRoute(opts.pickRoute ? opts.pickRoute(s) : s.nabidka.nabidnuto[0].ref);
    } else if (s.faze === 'motel_offer') {
      run.motelChoice(opts.pickMotel ? opts.pickMotel(s) : 'dal');
    } else if (s.faze === 'motel') {
      run.leaveMotel();
    } else if (s.faze === 'commit') {
      opts.probe?.(s, run);
      const commit = [];
      for (const plan of s.situace.commitPlan) {
        const legal = run.getHand(plan.hrac_id);
        for (let i = 0; i < plan.pocet; i++) {
          const karta = opts.pickCommit ? opts.pickCommit(legal, plan.hrac_id, s) : legal[i];
          commit.push({ characterId: plan.hrac_id, cardId: karta.id });
        }
      }
      run.commitCards(commit);
    } else if (s.faze === 'assign') {
      const assign = opts.pickAssign
        ? opts.pickAssign(s)
        : s.situace.committed.map((c, i) => ({ slotIndex: i, cardId: c.karta.id }));
      run.assignToSlots(assign);
      run.confirmNode();
    }
  }
}
