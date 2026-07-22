// @ts-check
/**
 * Obrazovka runu: okraj spisu (stálý panel) + briefing / volba cesty /
 * tah hráčů / rozepsaný výsledek s protokolem. Žádná herní logika —
 * jen render snapshotu enginu a odesílání příkazů (architektura §2.4).
 */
import { h } from '../dom.js';
import { vyklepej } from '../typewriter.js';
import { TAG_LABEL, PASMO_LABEL, DRUH_LABEL, tvrdostLabel, znamenko } from '../labels.js';

/**
 * @typedef {object} RunCtx
 * @property {object} S stav aplikace (viz app.js)
 * @property {object} st snapshot enginu (getState())
 * @property {object} content validovaný obsah (parseContent)
 * @property {object} rules RULES (jen data pro popisky)
 * @property {Record<string, any>} akce
 * @property {(postavaId: string) => object[]} legalni getLegalPlays
 * @property {(karta: object, druh: string) => number} efektivniSila
 * @property {number} cenaHlucne kolik Žáru stojí hlučná karta u tohoto pronásledovatele
 */

/** @param {RunCtx} ctx */
export function obrazovkaRun(ctx) {
  const { S, st } = ctx;
  /** @type {any} */
  let obsah;
  /** @type {any} */
  let modal = null;

  if (S.briefing) {
    obsah = pohledBriefing(ctx);
  } else if (S.fronta.length > 0) {
    obsah = pohledVysledky(ctx);
  } else if (st.faze === 'route') {
    obsah = pohledCesty(ctx);
  } else {
    obsah = pohledTahu(ctx);
    if (st.faze === 'rider') modal = modalRider(ctx);
    else modal = modalHlasu(ctx);
  }

  return h(
    'div',
    { class: 'plocha' },
    okrajSpisu(ctx),
    h('main', { class: 'list' }, obsah),
    modal
  );
}

/* ================= okraj spisu ================= */

/** @param {RunCtx} ctx */
function okrajSpisu(ctx) {
  const { S, st, rules, akce } = ctx;
  const prahy = /** @type {[string, number][]} */ (Object.entries(rules.zar.prahy));
  const prahU = (/** @type {number} */ n) => prahy.find(([, p]) => p === n)?.[0];
  const prahLabel = { zatah: 'Zátah', lecka: 'léčka', konfrontace: 'konfrontace' };

  return h(
    'aside',
    { class: 'okraj' },
    h('p', { class: 'formular-popisek' }, 'Okraj spisu'),
    h('p', { class: 'okraj-seed' }, `spisová značka ${S.seed}`),

    h(
      'section',
      { class: 'okraj-blok' },
      h('h3', { class: 'formular-popisek' }, 'Pronásledovatel'),
      h('strong', {}, st.pronasledovatel.nazev),
      h('p', { class: 'napoveda' }, `ruší tag: ${TAG_LABEL[st.pronasledovatel.rusenyTag]}`)
    ),

    h(
      'section',
      { class: 'okraj-blok' },
      h('h3', { class: 'formular-popisek' }, `Žár ${st.zar} / ${rules.zar.max}`),
      h(
        'div',
        { class: 'zar-draha' },
        Array.from({ length: rules.zar.max }, (_, i) => {
          const hodnota = i + 1;
          const jePrah = prahU(hodnota);
          return h(
            'div',
            {
              class: `zar-dilek${hodnota <= st.zar ? ' zaplneny' : ''}${jePrah ? ' prah' : ''}`,
              title: jePrah ? `práh ${hodnota}: ${prahLabel[jePrah]}` : `Žár ${hodnota}`,
            },
            jePrah ? h('span', { class: 'zar-prah-popisek' }, String(hodnota)) : null
          );
        })
      ),
      h(
        'p',
        { class: 'napoveda' },
        `prahy: ${prahy.map(([k, p]) => `${p} ${prahLabel[k]}`).join(' · ')}`
      )
    ),

    h(
      'section',
      { class: 'okraj-blok' },
      h('h3', { class: 'formular-popisek' }, `Náklad ${st.zbyvaBeden} / ${rules.bedenNaStartu}`),
      h(
        'div',
        { class: 'bedny-rada' },
        Array.from({ length: rules.bedenNaStartu }, (_, i) =>
          h('span', { class: `bedna${i < st.zbyvaBeden ? '' : ' ztracena'}` }, '▮')
        )
      )
    ),

    h(
      'section',
      { class: 'okraj-blok' },
      h('h3', { class: 'formular-popisek' }, 'Podezřelí'),
      st.postavy.map((/** @type {any} */ p) =>
        h(
          'div',
          { class: `okraj-postava${p.vyrazena ? ' vyrazena' : ''}` },
          h(
            'div',
            { class: 'okraj-postava-radka' },
            h('strong', {}, p.jmeno),
            p.vyrazena ? h('span', { class: 'razitko razitko-male' }, 'vyřazen') : null
          ),
          h(
            'p',
            { class: 'napoveda' },
            `zranění: ${'✚'.repeat(p.zraneni) || 'žádné'}`,
            p.aktivniProkleta ? ` · prokletá: ${p.aktivniProkleta.nazev}` : '',
            p.prokletychVeFronte > 0 ? ` · ve frontě ${p.prokletychVeFronte}` : '',
            p.zoufalaVRuce ? ` · zoufalá v záloze` : ''
          )
        )
      )
    ),

    h(
      'section',
      { class: 'okraj-blok' },
      h('h3', { class: 'formular-popisek' }, `Trasa: uzel ${Math.min(st.dokoncenoUzlu + 1, rules.uzluNaRun)} / ${rules.uzluNaRun}`)
    ),

    h('button', { class: 'tlacitko okraj-export', onclick: () => akce.exportLog() }, 'Exportovat log (JSONL)')
  );
}

/* ================= briefing ================= */

/** @param {RunCtx} ctx */
function pohledBriefing(ctx) {
  const { S, st, content, akce } = ctx;
  const pronasledovatel = content.pronasledovatele.find(
    (/** @type {any} */ p) => p.id === st.pronasledovatel.id
  );

  return h(
    'div',
    {},
    h(
      'header',
      { class: 'spis-hlavicka' },
      h('p', { class: 'formular-popisek' }, 'Spis otevřen'),
      h('h1', {}, 'Los pronásledovatele')
    ),
    h(
      'section',
      { class: 'uzel-karta pronasledovatel-karta' },
      h('span', { class: 'razitko' }, 'v patách'),
      h('h2', {}, pronasledovatel.nazev),
      h('p', { class: 'uzel-uvod' }, pronasledovatel.flavor),
      h('p', { class: 'pravidlo' }, pronasledovatel.pravidlo)
    ),
    h(
      'section',
      { class: 'formular-blok' },
      h('h2', { class: 'formular-popisek' }, 'Tajné cíle — ostatní se nedívají'),
      h(
        'div',
        { class: 'radka-voleb' },
        st.postavy.map((/** @type {any} */ p) =>
          h(
            'button',
            {
              class: `tlacitko${S.odkrytyCil === p.id ? ' aktivni' : ''}`,
              onclick: () => akce.odkryjCil(p.id),
            },
            S.odkrytyCil === p.id ? `Schovat (${p.jmeno})` : `Jsem ${p.jmeno}`
          )
        )
      ),
      S.odkrytyCil
        ? (() => {
            const p = st.postavy.find((/** @type {any} */ x) => x.id === S.odkrytyCil);
            return h(
              'div',
              { class: 'cil-karta' },
              h('p', { class: 'formular-popisek' }, `tajný cíl — ${p.jmeno}${p.cil ? ` (${p.cil.body} b.)` : ''}`),
              h('p', {}, p.cil ? p.cil.text : 'Cíl nebyl přidělen (došly karty cílů).')
            );
          })()
        : h('p', { class: 'napoveda' }, 'Každý si svůj cíl prohlédne sám a zase ho schová.')
    ),
    h(
      'footer',
      { class: 'formular-paticka' },
      h('button', { class: 'tlacitko tlacitko-hlavni', onclick: () => akce.vyraz() }, 'Vyrazit na trasu')
    )
  );
}

/* ================= volba cesty ================= */

/** @param {RunCtx} ctx */
function pohledCesty(ctx) {
  const { st, content, rules, akce } = ctx;
  const uzly = st.nabidka.nabidka.map((/** @type {string} */ id) =>
    content.uzly.find((/** @type {any} */ u) => u.id === id)
  );

  return h(
    'div',
    {},
    h(
      'header',
      { class: 'spis-hlavicka' },
      h('p', { class: 'formular-popisek' }, `úsek ${st.dokoncenoUzlu + 1} z ${rules.uzluNaRun}`),
      h('h1', {}, st.nabidka.zatah ? 'Zátah! Jiná cesta není' : 'Volba cesty'),
      st.nabidka.zatah
        ? h('p', { class: 'napoveda' }, `Žár dosáhl prahu — ${st.pronasledovatel.nazev} přehradil obě cesty.`)
        : h('p', { class: 'napoveda' }, 'Afinity a tvrdost jsou vidět předem. Stůl se radí, kliká kdokoli.')
    ),
    h(
      'div',
      { class: 'mrizka-cest' },
      uzly.map((/** @type {any} */ uzel) =>
        h(
          'button',
          {
            class: `uzel-karta${st.nabidka.zatah ? ' zatah' : ''}`,
            onclick: () => akce.zvolCestu(uzel.id),
          },
          st.nabidka.zatah ? h('span', { class: 'razitko' }, 'zátah') : null,
          h('h2', {}, uzel.nazev),
          tabulkaAfinit(uzel.afinity, st.pronasledovatel.rusenyTag),
          h('p', { class: 'tvrdost' }, tvrdostLabel(uzel.tvrdost, rules))
        )
      )
    )
  );
}

/** @param {Record<string, number>} afinity @param {string} [rusenyTag] */
function tabulkaAfinit(afinity, rusenyTag) {
  return h(
    'div',
    { class: 'afinity' },
    Object.keys(TAG_LABEL).map((tag) =>
      h(
        'span',
        {
          class: `afinita${afinity[tag] > 0 ? ' plus' : ''}${afinity[tag] < 0 ? ' minus' : ''}`,
          title: tag === rusenyTag ? `${TAG_LABEL[tag]} — tag ruší pronásledovatel` : TAG_LABEL[tag],
        },
        `${TAG_LABEL[tag]} ${znamenko(afinity[tag])}`
      )
    )
  );
}

/* ================= tah hráčů ================= */

/** @param {RunCtx} ctx */
function pohledTahu(ctx) {
  const { st, content, rules, akce, legalni } = ctx;
  const setkani = st.setkani;
  const druhLabel = DRUH_LABEL[setkani.druh];
  const pronasledovatel = content.pronasledovatele.find(
    (/** @type {any} */ p) => p.id === st.pronasledovatel.id
  );
  const aktivni = st.postavy.filter((/** @type {any} */ p) => !p.vyrazena);
  const pripraveno =
    aktivni.every((/** @type {any} */ p) => setkani.zahranePostavy.includes(p.id)) &&
    setkani.hlasujici.every((/** @type {string} */ id) => setkani.hlasovaliPostavy.includes(id));

  return h(
    'div',
    {},
    h(
      'header',
      { class: 'spis-hlavicka' },
      h('p', { class: 'formular-popisek' }, druhLabel ? `vložené setkání — ${druhLabel}` : `úsek ${st.nodeIndex} z ${rules.uzluNaRun}`),
      h('h1', {}, setkani.uzel.nazev ?? setkani.uzel.id),
      druhLabel ? h('span', { class: 'razitko' }, druhLabel) : null
    ),
    h(
      'section',
      { class: 'uzel-karta' },
      h('p', { class: 'uzel-uvod' }, setkani.uzel.uvod),
      tabulkaAfinit(setkani.uzel.afinity, st.pronasledovatel.rusenyTag),
      h('p', { class: 'tvrdost' }, tvrdostLabel(setkani.uzel.tvrdost, rules)),
      druhLabel ? h('p', { class: 'pravidlo' }, pronasledovatel.pravidlo) : null
    ),
    h(
      'section',
      { class: 'postavy-tah' },
      st.postavy.map((/** @type {any} */ p) => panelPostavy(p, ctx))
    ),
    h(
      'footer',
      { class: 'formular-paticka' },
      h(
        'button',
        { class: 'tlacitko tlacitko-hlavni', disabled: !pripraveno, onclick: () => akce.potvrd() },
        'Vyrazit — vyhodnotit uzel'
      ),
      pripraveno
        ? null
        : h('p', { class: 'napoveda' }, 'Každý aktivní podezřelý vyloží jednu kartu; vlastník kliká sám.')
    )
  );

  /** @param {any} p @param {RunCtx} c */
  function panelPostavy(p, c) {
    const zahrano = setkani.zahranePostavy.includes(p.id);
    if (p.vyrazena) {
      const hlasoval = setkani.hlasovaliPostavy.includes(p.id);
      const maHlas = setkani.hlasujici.includes(p.id);
      return h(
        'div',
        { class: 'panel-postavy vyrazena' },
        h('h3', {}, p.jmeno, ' ', h('span', { class: 'razitko razitko-male' }, 'vyřazen')),
        h('p', { class: 'napoveda' }, maHlas ? (hlasoval ? 'hlas z auta použit' : 'čeká na hlas z auta') : 'leží v korbě')
      );
    }
    const legalniVolby = legalni(p.id);
    const legalniId = new Set(legalniVolby.map((v) => v.karta.id));
    const postih = Math.min(p.zraneni, c.rules.maxPostihZraneni);

    return h(
      'div',
      { class: `panel-postavy${zahrano ? ' zahrano' : ''}` },
      h(
        'div',
        { class: 'okraj-postava-radka' },
        h('h3', {}, p.jmeno),
        h('span', { class: 'napoveda' }, `zranění ${p.zraneni} (postih −${postih})`)
      ),
      p.aktivniProkleta
        ? h('p', { class: 'prokleta-banner' }, `PROKLETÁ: ${p.aktivniProkleta.nazev} — ${p.aktivniProkleta.text}`)
        : null,
      zahrano
        ? h('p', { class: 'napoveda' }, 'karta vyložena')
        : h(
            'div',
            { class: 'ruka' },
            p.ruka.map((/** @type {any} */ k) => kartaTlacitko(k, false, legalniId.has(k.id))),
            legalniVolby
              .filter((v) => v.zoufala)
              .map((v) => kartaTlacitko(v.karta, true, true)),
            p.zoufalaVRuce && !legalniVolby.some((v) => v.zoufala)
              ? h(
                  'div',
                  { class: 'karta zoufala neaktivni' },
                  h('strong', {}, p.zoufalaVRuce.nazev),
                  h('span', { class: 'napoveda' }, `zoufalá — ${p.zoufalaVRuce.podminka}`)
                )
              : null
          )
    );

    /** @param {any} k @param {boolean} zoufala @param {boolean} legalniKarta */
    function kartaTlacitko(k, zoufala, legalniKarta) {
      const sila = c.efektivniSila(k, setkani.druh);
      const silaZmenena = sila !== k.sila;
      return h(
        'button',
        {
          class: `karta${zoufala ? ' zoufala' : ''}${k.hlucna ? ' hlucna' : ''}${legalniKarta ? '' : ' neaktivni'}`,
          disabled: !legalniKarta,
          title: legalniKarta
            ? k.text
            : `${k.text} — kartu blokuje prokletá (zákaz tagu / vynucená síla)`,
          onclick: () => c.akce.zahraj(p.id, k.id),
        },
        h('strong', {}, k.nazev),
        h(
          'span',
          { class: 'karta-meta' },
          `${TAG_LABEL[k.tag] ?? '—'} · síla ${silaZmenena ? `0 (${k.sila} ruší ${st.pronasledovatel.nazev})` : k.sila}`
        ),
        k.hlucna ? h('span', { class: 'karta-hlucna' }, `HLUČNÁ +${c.cenaHlucne} Žár`) : null,
        zoufala ? h('span', { class: 'karta-zoufala-stitek' }, 'ZOUFALÁ — bez postihu zranění') : null
      );
    }
  }
}

/* ================= modály ================= */

/** @param {RunCtx} ctx volba hlasu z auta (vlastník vyřazené postavy) */
function modalHlasu(ctx) {
  const { st, rules, akce } = ctx;
  const setkani = st.setkani;
  const naRade = setkani.hlasujici.find(
    (/** @type {string} */ id) => !setkani.hlasovaliPostavy.includes(id)
  );
  if (!naRade) return null;
  const hlasujici = st.postavy.find((/** @type {any} */ p) => p.id === naRade);
  const cile = st.postavy.filter((/** @type {any} */ p) => !p.vyrazena);

  return modal(
    `Hlas z auta — rozhoduje ${hlasujici.jmeno}`,
    h('p', { class: 'napoveda' }, 'Vyřazený z korby zasáhne do dění: pomůže, nebo přitíží.'),
    cile.map((/** @type {any} */ p) =>
      h(
        'div',
        { class: 'radka-voleb' },
        h(
          'button',
          { class: 'tlacitko', onclick: () => akce.hlasuj(naRade, 'bonus', p.id) },
          `+${rules.hlasZAutaBonus} k hodu pro ${p.jmeno}`
        ),
        h(
          'button',
          { class: 'tlacitko tlacitko-varovne', onclick: () => akce.hlasuj(naRade, 'prokleta', p.id) },
          `prokletá karta pro ${p.jmeno}`
        )
      )
    )
  );
}

/** @param {RunCtx} ctx rider volba vlastníka po selhání */
function modalRider(ctx) {
  const { st, akce } = ctx;
  const rider = st.cekaNaRider;
  const postava = st.postavy.find((/** @type {any} */ p) => p.id === rider.postava);
  const popisy = /** @type {Record<string, [string, string]>} */ ({
    zaplatit_bednu: ['Odhodit 1 bednu', 'povýší selhání na „úspěch za cenu“ — zranění ano, tvrdost ne'],
    nechat_selhani: ['Nechat selhání', 'zranění + tvrdost uzlu, +1 Žár za selhání v uzlu'],
    zraneni: ['Utrpět zranění', 'tvrdost uzlu se uplatní i tak'],
    bedna: ['Obětovat 1 bednu', 'zranění žádné; tvrdost uzlu se uplatní i tak'],
  });

  return modal(
    `${rider.typ === 'uplatek' ? 'Úplatek selhal' : 'Útěk selhal'} — rozhoduje ${postava.jmeno}`,
    h(
      'p',
      { class: 'napoveda' },
      rider.typ === 'uplatek'
        ? 'Hod skončil selháním (≤4). Obálka může ještě něco zachránit.'
        : 'Hod skončil selháním (≤4). Utéct se dá po svých, nebo přes bednu.'
    ),
    rider.volby.map((/** @type {string} */ volba) =>
      h(
        'div',
        { class: 'radka-voleb' },
        h(
          'button',
          { class: 'tlacitko', onclick: () => akce.rider(rider.postava, volba) },
          popisy[volba][0]
        ),
        h('span', { class: 'napoveda' }, popisy[volba][1])
      )
    )
  );
}

/** @param {string} titulek @param {...any} deti */
function modal(titulek, ...deti) {
  return h(
    'div',
    { class: 'modal-pozadi' },
    h('div', { class: 'modal' }, h('h2', {}, titulek), deti)
  );
}

/* ================= výsledky uzlu + protokol ================= */

/** @param {RunCtx} ctx */
function pohledVysledky(ctx) {
  const { S, akce } = ctx;
  const polozka = S.fronta[0];
  const { udalost, checks, sekce } = polozka;

  const protokol = h('div', { class: 'protokol-list' });
  if (polozka.vyklepano) {
    for (const odstavec of sekce.odstavce) {
      protokol.append(h('p', { class: 'protokol-odstavec' }, odstavec));
    }
  } else {
    polozka.vyklepano = true;
    vyklepej(protokol, sekce.odstavce);
  }

  return h(
    'div',
    {},
    h(
      'header',
      { class: 'spis-hlavicka' },
      h('p', { class: 'formular-popisek' }, 'výsledek — hráč vždy ví proč'),
      h('h1', {}, `List ${sekce.cislo} — ${sekce.titulek}`)
    ),
    h(
      'section',
      { class: 'rozpis-hodu' },
      udalost.hody.map((/** @type {any} */ hod, /** @type {number} */ i) =>
        radekHodu(hod, checks[i], ctx)
      )
    ),
    h(
      'section',
      { class: 'formular-blok' },
      h('h2', { class: 'formular-popisek' }, 'Protokol vyšetřovatele (klik přeskočí klepání)'),
      protokol
    ),
    h(
      'footer',
      { class: 'formular-paticka' },
      h('button', { class: 'tlacitko tlacitko-hlavni', onclick: () => akce.pokracuj() }, 'Pokračovat')
    )
  );
}

/** @param {any} hod @param {any} check @param {RunCtx} ctx */
function radekHodu(hod, check, ctx) {
  const jmeno = ctx.st.postavy.find((/** @type {any} */ p) => p.id === hod.postava)?.jmeno ?? hod.postava;
  /** @param {string} label @param {number} hodnota */
  const termin = (label, hodnota) =>
    hodnota < 0 ? ` − ${label} ${-hodnota}` : ` + ${label} ${hodnota}`;
  let vypocet = `d6 ${check.hod}`;
  vypocet += termin('síla', check.sila);
  vypocet += termin('afinita', check.afinita);
  vypocet += ` − zranění ${check.postihZraneni}`;
  if (check.modifikatory !== 0) vypocet += termin('úpravy', check.modifikatory);
  vypocet += ` = ${check.soucet}`;

  /** @type {string[]} */
  const nasledky = [];
  if (hod.povyseno_ze_selhani) nasledky.push('selhání povýšeno úplatkem');
  if (hod.rider?.typ === 'utek') {
    nasledky.push(hod.rider.volba === 'bedna' ? 'útěk: obětována bedna' : 'útěk: přijato zranění');
  }
  if (hod.zraneni_pridana > 0) nasledky.push(`+${hod.zraneni_pridana} zranění`);
  if (hod.bedny_ztracene_timto_hodem > 0) nasledky.push(`−${hod.bedny_ztracene_timto_hodem} bedna`);
  if (hod.tvrdost_aplikovana) nasledky.push(`tvrdost uzlu: ${tvrdostLabel(hod.tvrdost_aplikovana, ctx.rules)}`);

  return h(
    'div',
    { class: `hod-radek ${hod.pasmo}` },
    h(
      'div',
      { class: 'okraj-postava-radka' },
      h('strong', {}, jmeno),
      h('span', { class: 'napoveda' }, `„${hod.karta.nazev}“ (${TAG_LABEL[hod.karta.tag] ?? '—'})`),
      hod.zoufala ? h('span', { class: 'karta-zoufala-stitek' }, 'zoufalá') : null
    ),
    h(
      'p',
      { class: 'hod-vypocet' },
      vypocet,
      ' → ',
      h('span', { class: `pasmo-stitek ${hod.pasmo}` }, PASMO_LABEL[hod.pasmo])
    ),
    nasledky.length > 0 ? h('p', { class: 'napoveda' }, nasledky.join(' · ')) : null
  );
}
