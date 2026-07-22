// @ts-check
/**
 * Strategie hráčů pro simulátor (architektura.md §3):
 * - random          … baseline šumu
 * - greedy-affinity … vždy nejlepší tag+síla do afinity
 * - heat-averse     … minimalizuje Žár (vyhýbá se hlučným kartám a tvrdosti zar)
 * - tag-spam:<tag>  … hraje jediný tag — detektor dominantní strategie
 *
 * Rider volby a hlas z auta jsou součástí strategie. Strategie mají VLASTNÍ
 * RNG stream (odvozený ze seedu runu) — nesahají na RNG enginu, determinismus
 * dávky zůstává zachován.
 *
 * Modelová rozhodnutí (heuristiky riderů/hlasu, dokumentováno i v závěrečné
 * zprávě fáze 1):
 * - greedy/tag-spam: Úplatek platí bednu, zbývají-li ≥2; Útěk bere zranění,
 *   dokud má postava <2 zranění, pak bednu (zbývají-li ≥2), jinak zranění.
 * - heat-averse: platí bednu už kvůli Žáru (vyhne se selhání uzlu) při ≥2;
 *   jinak jako greedy.
 * - hlas z auta: všechny kromě random dávají +1 nejzraněnější aktivní postavě;
 *   random volí náhodně (větev i cíl).
 */

import { createRng } from '../src/engine/rng.js';
import { effectiveStrength } from '../src/engine/resolve.js';

/**
 * @param {string} nazev random | greedy-affinity | heat-averse | tag-spam:<tag>
 * @param {number} seed seed runu (strategie si z něj odvodí vlastní stream)
 * @param {{uzly: object[]}} content pro náhled na afinity uzlů při volbě cesty
 */
export function createStrategy(nazev, seed, content) {
  const rng = createRng((seed ^ 0x5f356495) >>> 0);
  const uzelById = new Map(content.uzly.map((u) => [u.id, u]));

  if (nazev === 'random') return randomStrategy(rng);
  if (nazev === 'greedy-affinity') return greedyStrategy(rng, uzelById, { heatAverse: false });
  if (nazev === 'heat-averse') return greedyStrategy(rng, uzelById, { heatAverse: true });
  if (nazev.startsWith('tag-spam:')) {
    const tag = nazev.split(':')[1];
    if (!['nasili', 'lest', 'uplatek', 'utek'].includes(tag)) {
      throw new Error(`Neznámý tag pro tag-spam: „${tag}".`);
    }
    return tagSpamStrategy(rng, uzelById, tag);
  }
  throw new Error(`Neznámá strategie „${nazev}".`);
}

/* ---------------- pomocníci ---------------- */

/** Hodnota zahrání: efektivní síla + afinita (+ u zoufalé odpuštěný postih). */
function playValue(volba, uzel, druhSetkani, pronasledovatelId, zraneni) {
  const eff = effectiveStrength(volba.karta, druhSetkani, pronasledovatelId);
  const afinita = uzel.afinity[volba.karta.tag] ?? 0;
  const odpustenyPostih = volba.zoufala ? Math.min(zraneni, 3) : 0;
  return eff + afinita + odpustenyPostih;
}

function activeChars(state) {
  return state.postavy.filter((p) => !p.vyrazena);
}

function mostInjuredActive(state) {
  const aktivni = activeChars(state);
  return aktivni.reduce((max, p) => (p.zraneni > max.zraneni ? p : max), aktivni[0]);
}

/** Nejlepší dosažitelná hodnota zahrání postavy proti uzlu (z ruky; bez prokletých omezení — aproximace pro volbu cesty). */
function bestHandValue(postava, uzel, pronasledovatelId) {
  let best = -Infinity;
  for (const karta of postava.ruka) {
    const v = playValue({ karta, zoufala: false }, uzel, 'uzel', pronasledovatelId, postava.zraneni);
    if (v > best) best = v;
  }
  return best === -Infinity ? 0 : best;
}

function defaultRider(state, pending, { heatAverse }) {
  const postava = state.postavy.find((p) => p.id === pending.postava);
  if (pending.typ === 'uplatek') {
    return state.zbyvaBeden >= 2 ? 'zaplatit_bednu' : 'nechat_selhani';
  }
  // utek
  if (!pending.volby.includes('bedna')) return 'zraneni';
  if (heatAverse) {
    return postava.zraneni >= 3 && state.zbyvaBeden >= 2 ? 'bedna' : 'zraneni';
  }
  if (postava.zraneni >= 2 && state.zbyvaBeden >= 2) return 'bedna';
  return 'zraneni';
}

function defaultVoice(state) {
  return { volba: 'bonus', cil: mostInjuredActive(state).id };
}

/* ---------------- strategie ---------------- */

/** @param {ReturnType<typeof createRng>} rng */
function randomStrategy(rng) {
  return {
    nazev: 'random',
    chooseRoute(state) {
      return rng.pick(state.nabidka.nabidka);
    },
    choosePlay(state, legal) {
      return rng.pick(legal).karta.id;
    },
    chooseRider(state, pending) {
      return rng.pick(pending.volby);
    },
    chooseVoice(state) {
      const cil = rng.pick(activeChars(state)).id;
      return { volba: rng.pick(['bonus', 'prokleta']), cil };
    },
  };
}

/**
 * greedy-affinity / heat-averse. Heat-averse penalizuje hlučné karty
 * (o cenu Žáru, u Brodyho 2) a cesty s tvrdostí `zar`.
 */
function greedyStrategy(rng, uzelById, { heatAverse }) {
  return {
    nazev: heatAverse ? 'heat-averse' : 'greedy-affinity',
    chooseRoute(state) {
      const kandidati = state.nabidka.nabidka.map((id) => {
        const uzel = uzelById.get(id);
        let skore = activeChars(state).reduce(
          (sum, p) => sum + bestHandValue(p, uzel, state.pronasledovatel.id),
          0
        );
        if (heatAverse && uzel.tvrdost === 'zar') skore -= 2;
        return { id, skore };
      });
      kandidati.sort((a, b) => b.skore - a.skore);
      return kandidati[0].id;
    },
    choosePlay(state, legal, postava) {
      const uzel = state.setkani.uzel;
      const brody = state.pronasledovatel.id === 'serif-brody';
      let best = null;
      let bestSkore = -Infinity;
      for (const volba of legal) {
        let skore = playValue(volba, uzel, state.setkani.druh, state.pronasledovatel.id, postava.zraneni);
        if (heatAverse && volba.karta.hlucna) skore -= brody ? 2 : 1;
        // deterministický tie-break: nehlučná dřív, pak nižší síla (šetří silné karty)
        const lepsi =
          skore > bestSkore ||
          (skore === bestSkore &&
            best &&
            ((best.karta.hlucna && !volba.karta.hlucna) ||
              (best.karta.hlucna === Boolean(volba.karta.hlucna) && volba.karta.sila < best.karta.sila)));
        if (lepsi) {
          best = volba;
          bestSkore = skore;
        }
      }
      return best.karta.id;
    },
    chooseRider(state, pending) {
      return defaultRider(state, pending, { heatAverse });
    },
    chooseVoice(state) {
      return defaultVoice(state);
    },
  };
}

/** tag-spam:<tag> — hraje jediný tag, fallback greedy, cesty dle afinity tagu. */
function tagSpamStrategy(rng, uzelById, tag) {
  const greedy = greedyStrategy(rng, uzelById, { heatAverse: false });
  return {
    nazev: `tag-spam:${tag}`,
    chooseRoute(state) {
      const kandidati = state.nabidka.nabidka.map((id) => ({
        id,
        skore: uzelById.get(id).afinity[tag] ?? 0,
      }));
      kandidati.sort((a, b) => b.skore - a.skore);
      return kandidati[0].id;
    },
    choosePlay(state, legal, postava) {
      const tagove = legal.filter((v) => v.karta.tag === tag);
      if (tagove.length === 0) return greedy.choosePlay(state, legal, postava);
      let best = tagove[0];
      for (const volba of tagove) {
        const eff = effectiveStrength(volba.karta, state.setkani.druh, state.pronasledovatel.id);
        const bestEff = effectiveStrength(best.karta, state.setkani.druh, state.pronasledovatel.id);
        if (eff > bestEff) best = volba;
      }
      return best.karta.id;
    },
    chooseRider(state, pending) {
      return defaultRider(state, pending, { heatAverse: false });
    },
    chooseVoice(state) {
      return defaultVoice(state);
    },
  };
}
