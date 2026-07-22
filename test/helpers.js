// @ts-check
/**
 * Sdílení pro testy: syntetický obsah s řízenými zárukami (garantovaná
 * selhání, čistá hlučnost…) a deterministický driver runu s možností sond.
 */

/** @param {number} pocet @param {object} sablona */
export function syntetickeKarty(pocet, sablona) {
  return Array.from({ length: pocet }, (_, i) => ({
    id: `${sablona.tag ?? 'karta'}-${sablona.sila ?? 1}-${i}`,
    nazev: 'Testovka',
    typ: 'zakladni',
    sila: 1,
    text: 'test',
    ...sablona,
    ...(sablona.id ? { id: `${sablona.id}-${i}` } : {}),
  }));
}

/** Uzly s jednotnou afinitou a tvrdostí (8 běžných + 1 Zátah). */
export function syntetickeUzly({ afinity, tvrdost, zatahAfinity }) {
  const uzly = Array.from({ length: 8 }, (_, i) => ({
    id: `uzel-${i}`,
    nazev: `Uzel ${i}`,
    uvod: 'test',
    afinity,
    tvrdost,
  }));
  uzly.push({
    id: 'zatah-test',
    nazev: 'Zátah',
    uvod: 'test',
    afinity: zatahAfinity ?? afinity,
    tvrdost,
    specialni: 'zatah',
  });
  return uzly;
}

/** @param {object} [prepis] */
export function syntetickyObsah(prepis = {}) {
  const afinity = { nasili: 0, lest: 0, uplatek: 0, utek: 0 };
  return {
    karty: syntetickeKarty(20, { tag: 'lest', sila: 1 }),
    uzly: syntetickeUzly({ afinity, tvrdost: 'zar' }),
    cile: [],
    pronasledovatele: [
      {
        id: 'agent-malone',
        nazev: 'Malone',
        ruseny_tag: 'uplatek',
        pravidlo: 'test',
        flavor: 'test',
        lecka: { uvod: 'test', afinity: { ...afinity }, tvrdost: 'zar' },
        konfrontace: { uvod: 'test', afinity: { ...afinity }, tvrdost: 'zraneni' },
      },
      {
        id: 'serif-brody',
        nazev: 'Brody',
        ruseny_tag: 'nasili',
        pravidlo: 'test',
        flavor: 'test',
        lecka: { uvod: 'test', afinity: { ...afinity }, tvrdost: 'zar' },
        konfrontace: { uvod: 'test', afinity: { ...afinity }, tvrdost: 'zraneni' },
      },
    ],
    verze: 'test',
    ...prepis,
  };
}

/** N prokletých kopií jednoho efektu — deterministická aktivace v testech. */
export function prokleteKopie(id, pocet = 8) {
  return Array.from({ length: pocet }, () => ({
    id,
    nazev: id,
    typ: 'prokleta',
    tag: null,
    sila: 0,
    text: 'test',
  }));
}

/**
 * Deterministický driver: bez zadání volí první legální možnost.
 *
 * @param {ReturnType<import('../src/engine/state.js').createRun>} run
 * @param {object} [opts]
 * @param {(legal: object[], postava: object, state: object) => object} [opts.pickPlay]
 * @param {(pending: object, state: object) => string} [opts.pickRider]
 * @param {(state: object, postavaId: string) => {volba: string, cil: string}} [opts.pickVoice]
 * @param {(state: object) => string} [opts.pickRoute]
 * @param {(state: object, run: object) => void} [opts.probe] sonda na začátku každé play fáze
 * @returns {object[]} kompletní událostní log
 */
export function drive(run, opts = {}) {
  const pickPlay = opts.pickPlay ?? ((legal) => legal[0]);
  const pickRider = opts.pickRider ?? ((pending) => pending.volby[0]);
  const pickVoice =
    opts.pickVoice ??
    ((state) => ({ volba: 'bonus', cil: state.postavy.find((p) => !p.vyrazena).id }));
  let pojistka = 0;

  for (;;) {
    const s = run.getState();
    if (s.faze === 'ended') return run.getEvents();
    if (++pojistka > 3000) throw new Error(`drive: run se nezastavil (fáze ${s.faze}).`);

    if (s.faze === 'route') {
      run.chooseRoute(opts.pickRoute ? opts.pickRoute(s) : s.nabidka.nabidka[0]);
    } else if (s.faze === 'play') {
      opts.probe?.(s, run);
      for (const id of s.setkani.hlasujici) {
        if (!s.setkani.hlasovaliPostavy.includes(id)) {
          run.chooseVoice(id, pickVoice(run.getState(), id));
        }
      }
      for (const postava of s.postavy.filter((p) => !p.vyrazena)) {
        if (s.setkani.zahranePostavy.includes(postava.id)) continue;
        const legal = run.getLegalPlays(postava.id);
        run.playCard(postava.id, pickPlay(legal, postava, run.getState()).karta.id);
      }
      run.confirmNode();
    } else if (s.faze === 'rider') {
      run.chooseRider(s.cekaNaRider.postava, pickRider(s.cekaNaRider, s));
    }
  }
}

/** Hráči postava-1..N. */
export function hraci(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `postava-${i + 1}` }));
}
