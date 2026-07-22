// @ts-check
/**
 * Stav runu + příkazy (architektura.md §2.2).
 *
 * API enginu: createRun({seed, content, rules, players, pronasledovatelId?})
 * a příkazy chooseRoute / playCard / chooseVoice / confirmNode / chooseRider.
 * Nic jiného stav nemění. Výstup: read-only snapshot (getState) + append-only
 * událostní log (getEvents). Deterministický: stejný seed + stejná sekvence
 * příkazů = bit-přesně stejný log (ADR-002).
 *
 * Modelová rozhodnutí nad rámec prototyp-mvp.md (dle
 * content/.claude/agent-memory/playtest-facilitator/sim-model-assumptions.md;
 * vlastní odchylky označeny „ENGINE:"):
 * - Sdílený balíček 32 základních karet; ruka 5, po každém setkání doliz na 5.
 *   ENGINE: doliz platí i po vložených setkáních (léčka/konfrontace); prázdný
 *   dobírací balíček se doplní zamícháním odhazu.
 * - Nabídka cest: ENGINE: 2 náhodné RŮZNÉ dosud nenavštívené běžné uzly
 *   (bez omezení na typ); navštívené se v rámci runu neopakují.
 * - Prokletá karta = 1 setkání malusu, pak odhoz; aktivuje se NEJSTARŠÍ
 *   z fronty postavy na začátku setkání (jedna za setkání). Zákaz tagu má
 *   přednost před vynucením (Zbrklost). ENGINE: je-li zákazem zakázaná celá
 *   ruka (a nejsou zoufalé), zákaz se pro volbu karty ignoruje — pravidlo
 *   nesmí hráče vyřadit ze hry. ENGINE: prokletá líznutá hlasem z auta se
 *   řadí do fronty, tj. působí od PŘÍŠTÍHO setkání.
 * - Zoufalé karty = stálý pool (neubývají); hratelné s 3+ zraněními, síla 3,
 *   ignorují postih. ENGINE: zákaz tagu z prokleté platí i na zoufalé;
 *   Zbrklost zoufalou připouští (síla 3 = maximum).
 * - Léčka (práh 7) a konfrontace (práh 10) jsou VKLÁDANÁ extra setkání
 *   (neubírají slot ze 6 uzlů); Zátah (práh 5) NAHRADÍ obě nabízené cesty,
 *   čili běžný slot zabírá. Prahy jsou hranově spouštěné: vystřelí při
 *   překročení zdola a znovu se nabijí, až když Žár klesne pod práh (jediná
 *   cesta dolů je přežitá konfrontace → Žár 3).
 * - ENGINE: pořadí po setkání: konfrontace (práh 10) má přednost před léčkou
 *   (práh 7) — čekající léčka i Zátah se startem konfrontace ruší (situace se
 *   změnila; po přežití je Žár 3, tedy pod oběma prahy).
 * - ENGINE: vložená setkání spuštěná během 6. uzlu se vyhodnotí PŘED razítkem
 *   DORUČENO (Žár tým dožene i v cílové rovince).
 * - ENGINE: postavy jednají v pořadí u stolu (seat order); ztráta beden a Žár
 *   se propisují průběžně, 0 beden ukončuje run okamžitě (zbylé hody
 *   propadají). Kolabující (4.) zranění už prokletou nelíže.
 * - ENGINE: postavy nejsou v obsahu v0.1 (chybí obsah/postavy.yaml) — jména
 *   dodává volající přes `players`.
 */

import { createRng } from './rng.js';
import { CURSED_EFFECTS } from './rules.js';
import { ENCOUNTER_KINDS, noisyHeat, resolveCheck, failureRider } from './resolve.js';
import { EVENT, CRATE_LOSS_REASON, createLog, scoreGoals } from './events.js';

/**
 * @param {object} opts
 * @param {number} opts.seed
 * @param {{karty: object[], uzly: object[], cile: object[],
 *   pronasledovatele: object[], verze: string}} opts.content výstup parseContent()
 * @param {typeof import('./rules.js').RULES} opts.rules
 * @param {{id: string, jmeno?: string}[]} opts.players 1–4 postavy
 * @param {string} [opts.pronasledovatelId] vynucený pronásledovatel (simulátor);
 *   bez něj se losuje z RNG
 */
export function createRun({ seed, content, rules, players, pronasledovatelId }) {
  if (!Array.isArray(players) || players.length < 1 || players.length > 4) {
    throw new Error('createRun: players musí být 1–4 postavy.');
  }
  const rng = createRng(seed);
  const log = createLog();

  /* --- obsah --- */
  const zakladni = content.karty.filter((k) => k.typ === 'zakladni');
  const proklete = content.karty.filter((k) => k.typ === 'prokleta');
  const zoufale = content.karty.filter((k) => k.typ === 'zoufala');
  const bezneUzly = content.uzly.filter((u) => !u.specialni);
  const zatahUzel = content.uzly.find((u) => u.specialni === 'zatah');

  /* --- pronásledovatel (los 1 na startu) --- */
  const pursuer = pronasledovatelId
    ? content.pronasledovatele.find((p) => p.id === pronasledovatelId)
    : rng.pick(content.pronasledovatele);
  if (!pursuer) throw new Error(`createRun: pronásledovatel „${pronasledovatelId}" v obsahu není.`);

  /* --- balíčky --- */
  let drawPile = rng.shuffle(zakladni);
  /** @type {object[]} */
  let discardPile = [];
  let cursedDraw = rng.shuffle(proklete);
  /** @type {object[]} */
  let cursedDiscard = [];

  /* --- postavy --- */
  const characters = players.map((p) => ({
    id: p.id,
    jmeno: p.jmeno ?? p.id,
    zraneni: 0,
    vyrazena: false,
    /** @type {object[]} */ ruka: [],
    /** @type {object[]} */ prokleteFronta: [],
    /** @type {object|null} */ aktivniProkleta: null,
    /** @type {object|null} */ cil: null,
  }));
  for (const c of characters) {
    for (let i = 0; i < rules.velikostRuky; i++) c.ruka.push(drawBasic());
  }

  /* --- tajné cíle (1 na hráče, bez opakování) --- */
  const goalDeck = rng.shuffle(content.cile);
  characters.forEach((c, i) => {
    c.cil = goalDeck[i] ?? null;
  });

  /* --- průběh runu --- */
  let heat = 0;
  let crates = rules.bedenNaStartu;
  let completedNodes = 0;
  /** @type {Set<string>} */
  const visited = new Set();
  /** @type {Set<string>} */
  const firedThresholds = new Set();
  let zatahPending = false;
  let ambushPending = false;
  let confrontationPending = false;

  /** @type {'route'|'play'|'rider'|'ended'} */
  let phase = 'route';
  /** @type {{nabidka: string[], zatah: boolean}|null} */
  let offered = null;
  /** @type {object|null} */
  let encounter = null;
  /** @type {object|null} */
  let pendingRider = null;
  let runOver = false;
  /** @type {{vysledek: string, pricina: string}|null} */
  let endCause = null;
  /** @type {object|null} */
  let result = null;
  let currentNodeIndex = 0;

  log.append(EVENT.RUN_STARTED, 0, {
    seed,
    verzeObsahu: content.verze,
    verzePravidel: rules.verze,
    pronasledovatel: pursuer.id,
    postavy: characters.map((c) => c.id),
    cile: characters.map((c) => ({ postava: c.id, cil: c.cil?.id ?? null })),
  });

  offerRoutes();

  /* ================= interní pomocníci ================= */

  function drawBasic() {
    if (drawPile.length === 0 && discardPile.length > 0) {
      drawPile = rng.shuffle(discardPile);
      discardPile = [];
    }
    return drawPile.pop() ?? null;
  }

  /** @param {ReturnType<typeof characters[number]>} c */
  function drawCursed(c) {
    if (cursedDraw.length === 0 && cursedDiscard.length > 0) {
      cursedDraw = rng.shuffle(cursedDiscard);
      cursedDiscard = [];
    }
    const karta = cursedDraw.pop();
    if (!karta) return; // všech 8 prokletých je právě rozebráno — líznutí propadá
    c.prokleteFronta.push(karta);
    log.append(EVENT.CURSED_DRAWN, currentNodeIndex, {
      postava: c.id,
      pocetZraneni: c.zraneni,
      karta: karta.id,
    });
  }

  /** Přičte zranění; vrací 1, pokud se zranění skutečně zapsalo. */
  function addInjury(c) {
    if (runOver || c.vyrazena) return 0;
    c.zraneni += 1;
    log.append(EVENT.INJURY_ADDED, currentNodeIndex, { postava: c.id, pocetZraneni: c.zraneni });
    if (c.zraneni >= rules.kolapsPriZraneni) {
      c.vyrazena = true;
      log.append(EVENT.CHARACTER_DOWN, currentNodeIndex, { postava: c.id, pocetZraneni: c.zraneni });
      if (characters.every((x) => x.vyrazena)) {
        runOver = true;
        endCause = { vysledek: 'NEVYRESENO', pricina: 'vsichni_vyrazeni' };
      }
    } else if (c.zraneni >= rules.prokletaOdZraneni) {
      drawCursed(c);
    }
    return 1;
  }

  /** @param {string} duvod @param {{id: string}} atribuce čí hod/rider bednu shodil */
  function loseCrate(duvod, atribuce) {
    if (runOver) return 0;
    crates -= 1;
    log.append(EVENT.CRATE_LOST, currentNodeIndex, {
      duvod,
      postava: atribuce.id,
      zbyvaBeden: crates,
    });
    if (crates <= 0) {
      runOver = true;
      endCause = { vysledek: 'NEVYRESENO', pricina: 'dosly_bedny' };
    }
    return 1;
  }

  /** @param {number} delta @param {string} duvod */
  function changeHeat(delta, duvod) {
    if (runOver || delta === 0) return;
    const old = heat;
    heat = Math.max(0, Math.min(rules.zar.max, heat + delta));
    if (heat === old) return;
    log.append(EVENT.HEAT_CHANGED, currentNodeIndex, {
      delta: heat - old,
      duvod,
      novaHodnota: heat,
    });
    updateThresholds();
  }

  /** Hranové spouštění prahů; pod prahem se práh znovu nabije. */
  function updateThresholds() {
    for (const [nazev, prah] of Object.entries(rules.zar.prahy)) {
      if (heat >= prah && !firedThresholds.has(nazev)) {
        firedThresholds.add(nazev);
        log.append(EVENT.HEAT_THRESHOLD, currentNodeIndex, { prah });
        if (nazev === 'zatah') zatahPending = true;
        else if (nazev === 'lecka') ambushPending = true;
        else if (nazev === 'konfrontace') confrontationPending = true;
      } else if (heat < prah) {
        firedThresholds.delete(nazev);
      }
    }
  }

  function offerRoutes() {
    currentNodeIndex = completedNodes + 1;
    if (zatahPending && zatahUzel) {
      zatahPending = false;
      offered = { nabidka: [zatahUzel.id], zatah: true };
    } else {
      const pool = bezneUzly.filter((u) => !visited.has(u.id));
      const vyber = rng.shuffle(pool).slice(0, rules.nabidkaCest);
      offered = { nabidka: vyber.map((u) => u.id), zatah: false };
    }
    phase = 'route';
    log.append(EVENT.ROUTE_OFFERED, currentNodeIndex, {
      nabidnuto: offered.nabidka,
      zatah: offered.zatah,
    });
  }

  /**
   * @param {string} druh hodnota z ENCOUNTER_KINDS
   * @param {object} uzel definice uzlu/mini-uzlu {id, nazev?, uvod, afinity, tvrdost}
   */
  function startEncounter(druh, uzel) {
    currentNodeIndex =
      druh === ENCOUNTER_KINDS.UZEL || druh === ENCOUNTER_KINDS.ZATAH
        ? completedNodes + 1
        : completedNodes;
    const aktivni = characters.filter((c) => !c.vyrazena);
    // Aktivace nejstarší prokleté z fronty (jedna za setkání).
    for (const c of aktivni) {
      c.aktivniProkleta = c.prokleteFronta.length > 0 ? c.prokleteFronta.shift() : null;
    }
    encounter = {
      druh,
      uzel,
      poradi: aktivni.map((c) => c.id),
      /** @type {Map<string, object>} */ zahrane: new Map(),
      /** @type {Map<string, object>} */ hlasy: new Map(),
      hlasujici: characters.filter((c) => c.vyrazena).map((c) => c.id),
      /** @type {Map<string, number>} */ bonusy: new Map(),
      resolveIdx: 0,
      /** @type {object[]} */ hody: [],
      selhaniVUzlu: false,
      /** @type {object|null} */ cekajiciHod: null,
    };
    phase = 'play';
  }

  /** @param {string} postavaId */
  function findCharacter(postavaId) {
    const c = characters.find((x) => x.id === postavaId);
    if (!c) throw new Error(`Neznámá postava „${postavaId}".`);
    return c;
  }

  /**
   * Legální zahrání pro postavu v aktuálním setkání (i pro UI).
   * @param {string} postavaId
   * @returns {{karta: object, zoufala: boolean, dobrovolna: boolean}[]}
   */
  function legalPlays(postavaId) {
    const c = findCharacter(postavaId);
    if (phase !== 'play' || c.vyrazena || !encounter) return [];
    const efekt = c.aktivniProkleta ? CURSED_EFFECTS[c.aktivniProkleta.id] ?? {} : {};
    const zakaz = efekt.zakazTag ?? null;
    const zbrklost = Boolean(efekt.nejvyssiSila);

    let ruka = c.ruka.filter((k) => k.tag !== zakaz);
    let zoufaleVolby =
      c.zraneni >= rules.zoufalaOdZraneni ? zoufale.filter((k) => k.tag !== zakaz) : [];
    if (ruka.length === 0 && zoufaleVolby.length === 0) {
      // Zákaz nelze splnit — pravidlo nesmí hráče vyřadit ze hry (viz hlavička).
      ruka = c.ruka.slice();
    }
    if (zbrklost && ruka.length > 0) {
      const max = Math.max(...ruka.map((k) => k.sila));
      ruka = ruka.filter((k) => k.sila === max);
    }
    return [
      ...ruka.map((karta) => ({ karta, zoufala: false, dobrovolna: !zbrklost })),
      ...zoufaleVolby.map((karta) => ({ karta, zoufala: true, dobrovolna: false })),
    ];
  }

  /* ================= resoluce setkání ================= */

  function resumeResolution() {
    const e = encounter;
    while (!runOver && e.resolveIdx < e.poradi.length) {
      const c = findCharacter(e.poradi[e.resolveIdx]);
      const play = e.zahrane.get(c.id);

      if (!e.cekajiciHod) {
        // Hlučnost: karta, nebo prokletá „Nutkání ochutnat" (počítá se jako hlučná).
        const efekt = c.aktivniProkleta ? CURSED_EFFECTS[c.aktivniProkleta.id] ?? {} : {};
        if (play.karta.hlucna || efekt.hlucna) {
          changeHeat(noisyHeat(pursuer.id, rules), 'hlucna_karta');
          if (runOver) break;
        }
        const modifikatory = (e.bonusy.get(c.id) ?? 0) + (efekt.modHodu ?? 0);
        const res = resolveCheck(
          {
            karta: play.karta,
            zoufala: play.zoufala,
            zraneni: c.zraneni,
            afinita: play.karta.tag ? e.uzel.afinity[play.karta.tag] ?? 0 : 0,
            modifikatory,
            druhSetkani: e.druh,
            pronasledovatelId: pursuer.id,
          },
          rules,
          rng
        );
        e.cekajiciHod = { res };
        if (res.pasmo === 'selhani') {
          const rider = failureRider(play.karta.tag, crates);
          if (rider && !(rider.typ === 'utek' && rider.volby.length === 1)) {
            pendingRider = { postava: c.id, typ: rider.typ, volby: rider.volby };
            phase = 'rider';
            return; // pauza — čeká se na příkaz chooseRider
          }
          finalizeCheck(c, res, rider ? 'zraneni' : null);
        } else {
          finalizeCheck(c, res, null);
        }
      } else {
        // návrat z rider pauzy — volba už je uložená v cekajiciHod.riderVolba
        finalizeCheck(c, e.cekajiciHod.res, e.cekajiciHod.riderVolba ?? null);
      }
      e.cekajiciHod = null;
      e.resolveIdx += 1;
    }
    finishEncounter();
  }

  /**
   * Aplikace následků jednoho hodu (pásma, ridery, tvrdost) + událost
   * check_resolved. `riderVolba` je null mimo selhání s riderem.
   */
  function finalizeCheck(c, res, riderVolba) {
    const e = encounter;
    const play = e.zahrane.get(c.id);
    let pasmo = res.pasmo;
    let povyseno = false;
    let zraneniPridana = 0;
    let bednyZtraceneTimtoHodem = 0;
    /** @type {string|null} */
    let tvrdostAplikovana = null;
    /** @type {object|null} */
    let rider = null;

    if (pasmo === 'uspech_za_cenu') {
      zraneniPridana += addInjury(c);
    } else if (pasmo === 'selhani') {
      if (play.karta.tag === 'uplatek' && riderVolba === 'zaplatit_bednu') {
        // Rider Úplatku: bedna → povýšení na „úspěch za cenu"; bez tvrdosti,
        // nepočítá se jako selhání.
        rider = { typ: 'uplatek', volba: riderVolba };
        bednyZtraceneTimtoHodem += loseCrate(CRATE_LOSS_REASON.RIDER_UPLATEK, c);
        pasmo = 'uspech_za_cenu';
        povyseno = true;
        zraneniPridana += addInjury(c);
      } else {
        e.selhaniVUzlu = true;
        if (play.karta.tag === 'utek') {
          // Rider Útěku: vlastník volí zranění, NEBO −1 bedna; tvrdost i tak.
          rider = { typ: 'utek', volba: riderVolba };
          if (riderVolba === 'bedna') {
            bednyZtraceneTimtoHodem += loseCrate(CRATE_LOSS_REASON.RIDER_UTEK, c);
          } else {
            zraneniPridana += addInjury(c);
          }
        } else {
          if (play.karta.tag === 'uplatek') rider = { typ: 'uplatek', volba: riderVolba };
          zraneniPridana += addInjury(c);
        }
        if (!runOver) {
          tvrdostAplikovana = e.uzel.tvrdost;
          if (tvrdostAplikovana === 'bedna') {
            bednyZtraceneTimtoHodem += loseCrate(CRATE_LOSS_REASON.TVRDOST_UZLU, c);
          } else if (tvrdostAplikovana === 'zar') {
            changeHeat(rules.tvrdostZarPrirustek, 'tvrdost_uzlu');
          } else if (tvrdostAplikovana === 'zraneni') {
            zraneniPridana += addInjury(c);
          }
        }
      }
    }

    log.append(EVENT.CHECK_RESOLVED, currentNodeIndex, {
      postava: c.id,
      hod: res.hod,
      sila: res.sila,
      afinita: res.afinita,
      postihZraneni: res.postih,
      modifikatory: res.modifikatory,
      soucet: res.soucet,
      pasmo,
      povysenoZeSelhani: povyseno,
      tvrdostAplikovana,
      rider,
    });

    e.hody.push({
      postava: c.id,
      karta: {
        id: play.karta.id,
        nazev: play.karta.nazev,
        tag: play.karta.tag ?? null,
        sila: play.karta.sila,
        hlucna: Boolean(play.karta.hlucna),
      },
      dobrovolna: play.dobrovolna,
      zoufala: play.zoufala,
      hod: res.hod,
      soucet: res.soucet,
      pasmo,
      povyseno_ze_selhani: povyseno,
      rider,
      tvrdost_aplikovana: tvrdostAplikovana,
      zraneni_pridana: zraneniPridana,
      bedny_ztracene_timto_hodem: bednyZtraceneTimtoHodem,
    });
  }

  function finishEncounter() {
    const e = encounter;
    pendingRider = null;

    // +1 Žár za uzel s aspoň jedním selháním (max 1× za uzel) + Ztráta důstojnosti.
    if (!runOver && e.selhaniVUzlu) {
      changeHeat(rules.zar.zaUzelSeSelhanim, 'selhani_v_uzlu');
      for (const c of characters) {
        const efekt = c.aktivniProkleta ? CURSED_EFFECTS[c.aktivniProkleta.id] ?? {} : {};
        if (efekt.zarNavicPriSelhaniUzlu) {
          changeHeat(efekt.zarNavicPriSelhaniUzlu, 'ztrata_dustojnosti');
        }
      }
    }

    log.append(EVENT.NODE_RESOLVED, currentNodeIndex, {
      druh: e.druh,
      uzel: e.uzel.id,
      nazev: e.uzel.nazev ?? null,
      pronasledovatel: pursuer.id,
      hody: e.hody,
      selhaniVUzlu: e.selhaniVUzlu,
      zar: heat,
      zbyvaBeden: crates,
      postavy: characters.map((c) => ({
        id: c.id,
        zraneni: c.zraneni,
        vyrazena: c.vyrazena,
      })),
    });

    // Odhoz aktivních prokletých a zahraných karet, doliz ruky.
    for (const c of characters) {
      if (c.aktivniProkleta) {
        cursedDiscard.push(c.aktivniProkleta);
        c.aktivniProkleta = null;
      }
    }
    for (const [postavaId, play] of e.zahrane) {
      void postavaId;
      if (!play.zoufala) discardPile.push(play.karta);
    }

    if (runOver) {
      endRun(endCause);
      return;
    }

    for (const c of characters) {
      if (c.vyrazena) continue;
      while (c.ruka.length < rules.velikostRuky) {
        const karta = drawBasic();
        if (!karta) break;
        c.ruka.push(karta);
      }
    }

    if (e.druh === ENCOUNTER_KINDS.UZEL || e.druh === ENCOUNTER_KINDS.ZATAH) {
      completedNodes += 1;
      visited.add(e.uzel.id);
    }

    if (confrontationPending) {
      confrontationPending = false;
      ambushPending = false;
      zatahPending = false;
      log.append(EVENT.CONFRONTATION_STARTED, currentNodeIndex, { pronasledovatel: pursuer.id });
      startEncounter(ENCOUNTER_KINDS.KONFRONTACE, {
        id: `${pursuer.id}-konfrontace`,
        nazev: `Konfrontace: ${pursuer.nazev}`,
        ...pursuer.konfrontace,
      });
      return;
    }
    if (ambushPending) {
      ambushPending = false;
      log.append(EVENT.AMBUSH_INSERTED, currentNodeIndex, { pronasledovatel: pursuer.id });
      startEncounter(ENCOUNTER_KINDS.LECKA, {
        id: `${pursuer.id}-lecka`,
        nazev: `Léčka: ${pursuer.nazev}`,
        ...pursuer.lecka,
      });
      return;
    }

    if (e.druh === ENCOUNTER_KINDS.KONFRONTACE) {
      // Přežití konfrontace → Žár klesá na 3 (prahy se tím znovu nabijí).
      changeHeat(rules.zar.poPrezitiKonfrontace - heat, 'preziti_konfrontace');
    }

    if (completedNodes >= rules.uzluNaRun) {
      endRun({ vysledek: 'DORUCENO', pricina: 'doruceno' });
      return;
    }
    offerRoutes();
  }

  /** @param {{vysledek: string, pricina: string}} cause */
  function endRun(cause) {
    phase = 'ended';
    encounter = null;
    pendingRider = null;
    const prirazeni = characters
      .filter((c) => c.cil)
      .map((c) => ({ postavaId: c.id, cil: c.cil }));
    const cileSkore = scoreGoals(
      [...log.all(), { type: EVENT.RUN_ENDED, vysledek: cause.vysledek }],
      prirazeni
    );
    result = {
      vysledek: cause.vysledek,
      pricina: cause.pricina,
      pocetUzlu: completedNodes,
      zar: heat,
      zbyvaBeden: crates,
      cile: cileSkore,
    };
    log.append(EVENT.RUN_ENDED, currentNodeIndex, result);
  }

  /* ================= veřejné API ================= */

  return {
    /** Read-only snapshot stavu pro render/strategii (hluboká kopie). */
    getState() {
      return structuredClone({
        faze: phase,
        seed,
        pronasledovatel: { id: pursuer.id, nazev: pursuer.nazev, rusenyTag: pursuer.ruseny_tag },
        zar: heat,
        zbyvaBeden: crates,
        dokoncenoUzlu: completedNodes,
        nodeIndex: currentNodeIndex,
        nabidka: phase === 'route' ? offered : null,
        setkani:
          encounter && (phase === 'play' || phase === 'rider')
            ? {
                druh: encounter.druh,
                uzel: {
                  id: encounter.uzel.id,
                  nazev: encounter.uzel.nazev ?? null,
                  uvod: encounter.uzel.uvod,
                  afinity: encounter.uzel.afinity,
                  tvrdost: encounter.uzel.tvrdost,
                },
                zahranePostavy: [...encounter.zahrane.keys()],
                hlasovaliPostavy: [...encounter.hlasy.keys()],
                hlasujici: encounter.hlasujici,
              }
            : null,
        cekaNaRider: pendingRider,
        postavy: characters.map((c) => ({
          id: c.id,
          jmeno: c.jmeno,
          zraneni: c.zraneni,
          vyrazena: c.vyrazena,
          ruka: c.ruka.map((k) => ({ ...k })),
          aktivniProkleta: c.aktivniProkleta ? { ...c.aktivniProkleta } : null,
          prokletychVeFronte: c.prokleteFronta.length,
          cil: c.cil ? { ...c.cil } : null,
        })),
        vysledek: result,
      });
    },

    /** Append-only událostní log (JSONL-serializovatelný). */
    getEvents() {
      return structuredClone(log.all());
    },

    /** Legální zahrání karty pro postavu (respektuje prokleté a zoufalé). */
    getLegalPlays(postavaId) {
      return structuredClone(legalPlays(postavaId));
    },

    /** Volba cesty (fáze route). */
    chooseRoute(uzelId) {
      if (phase !== 'route') throw new Error(`chooseRoute mimo fázi route (fáze: ${phase}).`);
      if (!offered.nabidka.includes(uzelId)) {
        throw new Error(`Uzel „${uzelId}" není v nabídce (${offered.nabidka.join(', ')}).`);
      }
      const uzel = offered.zatah ? zatahUzel : bezneUzly.find((u) => u.id === uzelId);
      log.append(EVENT.ROUTE_CHOSEN, currentNodeIndex, { volba: uzelId, zatah: offered.zatah });
      const druh = offered.zatah ? ENCOUNTER_KINDS.ZATAH : ENCOUNTER_KINDS.UZEL;
      offered = null;
      startEncounter(druh, uzel);
    },

    /** Zahrání karty postavou (fáze play). Zoufalé karty dle id z poolu. */
    playCard(postavaId, kartaId) {
      if (phase !== 'play') throw new Error(`playCard mimo fázi play (fáze: ${phase}).`);
      const c = findCharacter(postavaId);
      if (c.vyrazena) throw new Error(`Postava „${postavaId}" je vyřazena — nehraje karty.`);
      if (encounter.zahrane.has(postavaId)) {
        throw new Error(`Postava „${postavaId}" už v tomto uzlu kartu zahrála.`);
      }
      const volba = legalPlays(postavaId).find((v) => v.karta.id === kartaId);
      if (!volba) throw new Error(`Karta „${kartaId}" není legální zahrání postavy „${postavaId}".`);
      if (!volba.zoufala) {
        const idx = c.ruka.findIndex((k) => k.id === kartaId);
        c.ruka.splice(idx, 1);
      }
      encounter.zahrane.set(postavaId, volba);
      log.append(EVENT.CARD_PLAYED, currentNodeIndex, {
        postava: postavaId,
        karta: {
          id: volba.karta.id,
          tag: volba.karta.tag ?? null,
          sila: volba.karta.sila,
          hlucna: Boolean(volba.karta.hlucna),
        },
        dobrovolna: volba.dobrovolna,
        zoufala: volba.zoufala,
      });
    },

    /**
     * Hlas z auta (fáze play): vyřazený hráč dá spoluhráči +1 k hodu
     * (`{volba: 'bonus', cil}`), NEBO mu lízne prokletou (`{volba: 'prokleta', cil}`).
     */
    chooseVoice(postavaId, { volba, cil }) {
      if (phase !== 'play') throw new Error(`chooseVoice mimo fázi play (fáze: ${phase}).`);
      const c = findCharacter(postavaId);
      if (!c.vyrazena) throw new Error(`Postava „${postavaId}" není vyřazena — hlas z auta nemá.`);
      if (!encounter.hlasujici.includes(postavaId)) {
        throw new Error(`Postava „${postavaId}" v tomto uzlu hlas z auta nemá.`);
      }
      if (encounter.hlasy.has(postavaId)) {
        throw new Error(`Postava „${postavaId}" už hlas z auta použila.`);
      }
      const target = findCharacter(cil);
      if (target.vyrazena) throw new Error(`Cíl hlasu z auta „${cil}" je vyřazen.`);
      if (volba === 'bonus') {
        encounter.bonusy.set(cil, (encounter.bonusy.get(cil) ?? 0) + rules.hlasZAutaBonus);
      } else if (volba === 'prokleta') {
        drawCursed(target);
      } else {
        throw new Error(`Neznámá volba hlasu z auta „${volba}" (bonus | prokleta).`);
      }
      encounter.hlasy.set(postavaId, { volba, cil });
    },

    /** Potvrzení uzlu — spustí resoluci (může se zastavit na rider volbě). */
    confirmNode() {
      if (phase !== 'play') throw new Error(`confirmNode mimo fázi play (fáze: ${phase}).`);
      const nezahrali = encounter.poradi.filter((id) => !encounter.zahrane.has(id));
      if (nezahrali.length > 0) {
        throw new Error(`Nezahráli: ${nezahrali.join(', ')}.`);
      }
      const nehlasovali = encounter.hlasujici.filter((id) => !encounter.hlasy.has(id));
      if (nehlasovali.length > 0) {
        throw new Error(`Hlas z auta nerozhodnut: ${nehlasovali.join(', ')}.`);
      }
      phase = 'resolving';
      resumeResolution();
    },

    /** Rozhodnutí rider volby (fáze rider) — pokračuje resoluce. */
    chooseRider(postavaId, volba) {
      if (phase !== 'rider') throw new Error(`chooseRider mimo fázi rider (fáze: ${phase}).`);
      if (pendingRider.postava !== postavaId) {
        throw new Error(`Rider volbu má postava „${pendingRider.postava}", ne „${postavaId}".`);
      }
      if (!pendingRider.volby.includes(volba)) {
        throw new Error(`Volba „${volba}" není mezi (${pendingRider.volby.join(', ')}).`);
      }
      encounter.cekajiciHod.riderVolba = volba;
      pendingRider = null;
      phase = 'resolving';
      resumeResolution();
    },
  };
}
