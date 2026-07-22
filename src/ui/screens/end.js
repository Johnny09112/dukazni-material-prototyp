// @ts-check
/**
 * Obrazovka konce runu: celý protokol k přečtení nahlas, reveal tajných cílů
 * s bodováním z enginu, velké razítko DORUČENO/NEVYŘEŠENO, export logu.
 */
import { h } from '../dom.js';
import { vyklepej } from '../typewriter.js';
import { DRUH_LABEL, PRICINA_LABEL, vysledekLabel } from '../labels.js';

/**
 * @param {{S: object, content: object, akce: Record<string, any>}} ctx
 */
export function obrazovkaKonec(ctx) {
  const { S, content, akce } = ctx;
  const vysledek = S.konec; // událost run_ended
  const doruceno = vysledek.vysledek === 'DORUCENO';

  // Finále (poslední sekce) se vyklepává, zbytek spisu už je „napsaný".
  const sekceFinale = S.protokol[S.protokol.length - 1];
  const finaleEl = h('div', { class: 'protokol-list' });
  if (S.finaleVyklepano) {
    for (const odstavec of sekceFinale.odstavce) {
      finaleEl.append(h('p', { class: 'protokol-odstavec' }, odstavec));
    }
  } else {
    S.finaleVyklepano = true;
    vyklepej(finaleEl, sekceFinale.odstavce);
  }

  return h(
    'main',
    { class: 'list list-konec' },
    h(
      'header',
      { class: 'spis-hlavicka' },
      h('p', { class: 'formular-popisek' }, `spisová značka ${S.seed} · uzlů ${vysledek.pocetUzlu} · ${PRICINA_LABEL[vysledek.pricina] ?? vysledek.pricina}`),
      h('h1', {}, 'Uzavření spisu'),
      h(
        'div',
        { class: 'razitko-scena' },
        h('span', { class: `razitko razitko-velke${doruceno ? '' : ' nevyreseno'}` }, vysledekLabel(vysledek.vysledek))
      )
    ),

    h(
      'section',
      { class: 'formular-blok' },
      h('h2', { class: 'formular-popisek' }, 'Protokol — čte se nahlas'),
      S.protokol.slice(0, -1).map((/** @type {any} */ sekce) =>
        h(
          'article',
          { class: 'protokol-sekce' },
          h(
            'h3',
            { class: 'formular-popisek' },
            `List ${sekce.cislo} — ${sekce.titulek}`,
            DRUH_LABEL[sekce.druh] ? ` (${DRUH_LABEL[sekce.druh]})` : ''
          ),
          sekce.odstavce.map((/** @type {string} */ o) => h('p', { class: 'protokol-odstavec' }, o))
        )
      ),
      h(
        'article',
        { class: 'protokol-sekce' },
        h('h3', { class: 'formular-popisek' }, sekceFinale.titulek),
        finaleEl
      )
    ),

    h(
      'section',
      { class: 'formular-blok' },
      h('h2', { class: 'formular-popisek' }, 'Reveal tajných cílů'),
      h(
        'div',
        { class: 'cile-vysledky' },
        vysledek.cile.map((/** @type {any} */ zaznam) => {
          const cil = content.cile.find((/** @type {any} */ c) => c.id === zaznam.cil);
          const jmeno = S.jmena[zaznam.postava] ?? zaznam.postava;
          const stav = zaznam.textovy
            ? 'posoudí stůl z protokolu'
            : zaznam.splnen
              ? `SPLNĚN — ${zaznam.body} b.`
              : 'nesplněn';
          return h(
            'div',
            { class: `cil-karta${zaznam.splnen ? ' splnen' : ''}` },
            h('p', { class: 'formular-popisek' }, `${jmeno} (za ${cil.body} b.)`),
            h('p', {}, cil.text),
            h('p', { class: zaznam.splnen ? 'razitko razitko-male' : 'napoveda' }, stav)
          );
        })
      ),
      h(
        'p',
        { class: 'napoveda' },
        `Mechanické body celkem: ${vysledek.cile.reduce((s, c) => s + c.body, 0)}. Textové cíle rozsoudí stůl po přečtení protokolu.`
      )
    ),

    h(
      'footer',
      { class: 'formular-paticka radka-voleb' },
      h('button', { class: 'tlacitko', onclick: () => akce.exportLog() }, 'Exportovat log (JSONL)'),
      h('button', { class: 'tlacitko tlacitko-hlavni', onclick: () => akce.novyRun() }, 'Nový run')
    )
  );
}
