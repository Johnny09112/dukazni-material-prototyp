// @ts-check
/**
 * Botí strategie pro v3 simulátor (architektura.md §3, prototyp-mvp.md Fáze 0).
 *
 * Tři osy (kombinují se):
 * - COMMIT (proti telegrafu, naslepo): informovany (čte trend viditelných statů
 *   s fidelitou p) / naivni / monokultura (jeden stat — detektor K4b).
 * - PŘIŘAZENÍ do slotů: oracle (zná prahy → horní mez max_achievable) /
 *   memorizacni (zná stabilní kotvy, ne per-instance šum) / kompetentni (zná
 *   staty, ne prahy) / greedy / random / cile (bias k vlastnímu cíli).
 * - EKONOMIKA v motelu: adaptivni / lecit / smenit / hoard.
 *
 * Info-postih hide_staty → ε-greedy přiřazení (ε = spec.epsilon). Bot má VLASTNÍ
 * RNG stream (odvozený ze seedu runu) — nesahá na RNG enginu, determinismus
 * dávky zůstává. Bot NEZNÁ nic, co by hráč u stolu neviděl, kromě explicitních
 * „vševědoucích" strategií (oracle/memorizacni) sloužících jako měřicí meze.
 */

import { createRng } from '../src/engine/rng.js';
import { resolveSlot } from '../src/engine/resolve.js';

/** @param {number} seed */
export function createStrategy(spec, seed) {
  const s = {
    commit: 'informovany',
    assign: 'kompetentni',
    econ: 'adaptivni',
    fidelita: 0.7,
    epsilon: 0.4,
    monoStat: 'utok',
    gamble: false,
    ...spec,
  };
  const rng = createRng((seed ^ 0x9e3779b9) >>> 0);

  return {
    spec: s,

    /* -------- mapa -------- */
    pickRoute(state) {
      const n = state.nabidka.nabidnuto;
      return n[rng.int(n.length)].ref;
    },

    /* -------- motel -------- */
    pickMotelOffer(state) {
      const maTezky = state.postavy.some((p) => p.postihy.some((x) => x.tier === 'tezky'));
      if (s.econ === 'hoard') return 'dal';
      if (s.econ === 'lecit' || s.econ === 'adaptivni') {
        if (maTezky && state.kredity >= 6) return 'ukryt';
      }
      if (s.econ === 'smenit' && state.kredity >= 3) return 'ukryt';
      return 'dal';
    },

    motelActions(state, run) {
      // Léčení těžkých postihů (lecit/adaptivni), pak volitelně směna nejslabší karty.
      if (s.econ === 'lecit' || s.econ === 'adaptivni') {
        for (const p of state.postavy) {
          for (const x of p.postihy.filter((y) => y.tier === 'tezky')) {
            if (run.getState().kredity >= 6) run.spendCredits({ sluzba: 'leceni', hracId: p.id, postihId: x.id });
          }
        }
      }
      if (s.econ === 'smenit' || s.econ === 'adaptivni') {
        const st = run.getState();
        if (st.kredity >= 3) {
          const p = st.postavy.find((x) => x.ruka.length > 0);
          if (p) {
            const nejslabsi = p.ruka.reduce((a, b) => (statSum(a) <= statSum(b) ? a : b));
            run.spendCredits({ sluzba: 'smena', hracId: p.id, kartaId: nejslabsi.id });
          }
        }
      }
      run.leaveMotel();
    },

    /* -------- commit (naslepo dle telegrafu) -------- */
    commit(state, run) {
      const signal = state.situace.signal;
      const demanded = effectiveDemand(signal, s, rng);
      const out = [];
      for (const plan of state.situace.commitPlan) {
        const ruka = run.getHand(plan.hrac_id).slice();
        const skore = (k) => commitScore(k, demanded, s);
        ruka.sort((a, b) => skore(b) - skore(a));
        for (let i = 0; i < plan.pocet; i++) out.push({ characterId: plan.hrac_id, cardId: ruka[i].id });
      }
      run.commitCards(out);
    },

    /* -------- gamble policy (K7) + přiřazení do slotů -------- */
    assign(state, run) {
      // Gamble: odhad zásahů vs kotva; ≤2/4 → jednou líznout záchranu (ne při ≥3/4).
      if (s.gamble !== false && !state.situace.gambleUsed) {
        const locked = state.postavy.some((p) => p.postihy.some((x) => x.efekt?.druh === 'lock_gamble'));
        if (!locked && estimateHitsVsKotva(state) <= 2) {
          const owner = chooseGambleHand(state);
          const replaced = weakestCommittedId(state);
          if (owner && replaced) {
            run.gamble({ handOwnerId: owner, replacedCardId: replaced });
            state = run.getState();
          }
        }
      }

      const sloty = state.situace.odhaleno.sloty;
      const committed = state.situace.committed;
      const goalByHrac = Object.fromEntries(state.postavy.map((p) => [p.id, p.cil?.id ?? null]));
      const postizen = state.postavy.some((p) => p.postihy.some((x) => x.efekt?.druh === 'hide_staty'));
      const opts = {
        strat: s.assign,
        committed,
        sloty,
        rusi: state.pronasledovatel?.rusi ?? null,
        stitekParams: state.situace.stitekParams ?? null,
        typSituace: state.situace.typ,
        goalByHrac,
        rng,
      };
      const mapping = postizen && rng.next() < s.epsilon ? randomMapping(committed.length, sloty.length, rng) : decideAssignment(opts);
      const list = mapping.map((slotIdx, cardIdx) => ({ slotIndex: sloty[slotIdx].slot_index, cardId: committed[cardIdx].karta.id }));
      run.assignToSlots(list);
      run.confirmNode();
    },
  };
}

/* ================= gamble heuristiky ================= */

/** Odhad zásahů: nejlepší rozdělení vůči KOTVĚ (bot nezná per-instance šum). */
function estimateHitsVsKotva(state) {
  const committed = state.situace.committed;
  const sloty = state.situace.odhaleno.sloty;
  const rusi = state.pronasledovatel?.rusi ?? null;
  const stitekParams = state.situace.stitekParams ?? null;
  const typSituace = state.situace.typ;
  const map = decideAssignment({ strat: 'memorizacni', committed, sloty, rusi, stitekParams, typSituace });
  let hits = 0;
  map.forEach((slotPos, cardIdx) => {
    const slot = sloty[slotPos];
    if (resolveSlot({ karta: committed[cardIdx].karta, slot: { ...slot, prah: slot.kotva }, rusi, stitekParams, typSituace }).zasah) hits += 1;
  });
  return hits;
}

/** Čí ruka poskytne gamble: hazardérův cíl preferuje vlastní, jinak nejplnější ruka. */
function chooseGambleHand(state) {
  const haz = state.postavy.find((p) => p.cil?.id === 'hazarder' && p.ruka.length > 0);
  if (haz) return haz.id;
  const plne = state.postavy.filter((p) => p.ruka.length > 0).sort((a, b) => b.ruka.length - a.ruka.length);
  return plne[0]?.id ?? null;
}

/** Nejslabší committnutá karta (nejnižší součet statů) → nahradí ji gamble. */
function weakestCommittedId(state) {
  const c = state.situace.committed;
  if (c.length === 0) return null;
  return c.reduce((a, b) => (statSum(a.karta) <= statSum(b.karta) ? a : b)).karta.id;
}

/* ================= commit heuristiky ================= */

function statSum(k) {
  return Object.values(k.staty).reduce((a, b) => a + b, 0);
}

/** Efektivní poptávka statů z telegrafu (fidelita p → občas špatný signál). */
function effectiveDemand(signal, s, rng) {
  const staty = ['utok', 'obrana', 'hodnota', 'improvizace', 'nastroj'];
  if (s.commit === 'monokultura') return [s.monoStat];
  if (s.commit === 'naivni') return [];
  // informovany: trend viditelných statů, zašuměný fidelitou
  const trend = signal.trend.flatMap((t) => (Array.isArray(t.stat) ? t.stat : [t.stat]));
  if (rng.next() < s.fidelita) return trend;
  return [staty[rng.int(staty.length)]]; // špatný odhad
}

function commitScore(k, demanded, s) {
  if (s.commit === 'naivni') return statSum(k);
  if (demanded.length === 0) return statSum(k);
  return demanded.reduce((a, stat) => a + (k.staty[stat] ?? 0), 0);
}

/* ================= přiřazovací heuristiky ================= */

/** Všechny permutace [0..n-1] (n ≤ 4). */
function permutace(n) {
  const arr = Array.from({ length: n }, (_, i) => i);
  const out = [];
  const gen = (k, a) => {
    if (k === 1) return out.push(a.slice());
    for (let i = 0; i < k; i++) {
      gen(k - 1, a);
      const j = k % 2 === 0 ? i : 0;
      [a[j], a[k - 1]] = [a[k - 1], a[j]];
    }
  };
  gen(n, arr);
  return out;
}

/** mapping[indexKarty] = pozice slotu; karty jdou na náhodný podmnožinový výběr slotů. */
function randomMapping(pocetKaret, pocetSlotu, rng) {
  return rng.shuffle(Array.from({ length: pocetSlotu }, (_, i) => i)).slice(0, pocetKaret);
}

/**
 * Bias cíle-driven bota: bonus/postih per (karta VLASTNÍKA cíle, slot). Vytváří
 * měřitelnou odchylku od kompetentního (týmově-optimálního) přiřazení.
 */
function goalBias(karta, slot, goalId) {
  if (!goalId) return 0;
  const LAMBDA = 3;
  const rawStaty = Array.isArray(slot.stat) ? slot.stat : [slot.stat];
  const pass = Math.min(...rawStaty.map((st) => karta.staty[st] ?? 0)) >= slot.kotva; // odhad vs kotva
  const gangsterVisible = karta.stitek === 'GANGSTER' && slot.viditelnost === 'viditelna';
  switch (goalId) {
    case 'cista-ruka':
      return gangsterVisible ? -100 : 0; // NIKDY zbraň do viditelné role
    case 'dve-jizvy':
      return pass ? -LAMBDA : LAMBDA; // toleruj/vyhledej vlastní propad (chce postihy)
    case 'muj-den':
    case 'bez-jizvy':
    case 'kupecke-slovo':
    case 'plny-zasah':
      return pass ? LAMBDA : -LAMBDA; // tlač vlastní průchod
    default:
      return 0; // hazarder (řeší gamble), mozek-operace (textový)
  }
}

/**
 * Vrací `mapping[indexKarty] = pozice slotu` — přiřazení dle strategie.
 * ČISTÁ funkce (testovatelná bez enginu).
 *
 * @param {object} p {strat, committed:[{hrac_id,karta}], sloty, rusi, stitekParams, typSituace, goalByHrac, rng}
 */
export function decideAssignment({ strat, committed, sloty, rusi = null, stitekParams = null, typSituace = null, goalByHrac = {}, rng = null }) {
  const karty = committed.map((c) => c.karta);
  const M = karty.length;
  if (strat === 'random') return randomMapping(M, sloty.length, rng);

  const passVsPrah = (k, slot) => (resolveSlot({ karta: k, slot, rusi, stitekParams, typSituace }).zasah ? 1 : 0);
  const passVsKotva = (k, slot) => (resolveSlot({ karta: k, slot: { ...slot, prah: slot.kotva }, rusi, stitekParams, typSituace }).zasah ? 1 : 0);
  const rawStat = (k, slot) => {
    const staty = Array.isArray(slot.stat) ? slot.stat : [slot.stat];
    return Math.min(...staty.map((st) => (rusi?.typ === 'stat' && rusi.cil === st ? 0 : k.staty[st] ?? 0)));
  };

  if (strat === 'greedy') {
    const zbyleSloty = sloty.map((_, i) => i);
    const mapping = new Array(M);
    for (let cardIdx = 0; cardIdx < M; cardIdx++) {
      let best = 0;
      for (let j = 1; j < zbyleSloty.length; j++) {
        if (rawStat(karty[cardIdx], sloty[zbyleSloty[j]]) > rawStat(karty[cardIdx], sloty[zbyleSloty[best]])) best = j;
      }
      mapping[cardIdx] = zbyleSloty.splice(best, 1)[0];
    }
    return mapping;
  }

  const base = strat === 'oracle' ? passVsPrah : strat === 'memorizacni' ? passVsKotva : rawStat;
  const scoreFn =
    strat === 'cile'
      ? (k, slot, i) => rawStat(k, slot) + goalBias(k, slot, goalByHrac[committed[i].hrac_id])
      : (k, slot) => base(k, slot);

  let bestMap = null;
  let bestScore = -Infinity;
  for (const perm of permutace(sloty.length)) {
    let sc = 0;
    for (let i = 0; i < M; i++) sc += scoreFn(karty[i], sloty[perm[i]], i);
    if (sc > bestScore) {
      bestScore = sc;
      bestMap = perm.slice(0, M);
    }
  }
  return bestMap;
}
