// @ts-check
/**
 * Obrazovka setupu — titulní strana spisu: počet hráčů, přiřazení postav
 * (pořadí kliknutí = pořadí u stolu), volitelný seed.
 */
import { h } from '../dom.js';

/**
 * @param {{postavy: object[], setup: {pocet: number, vybrane: string[],
 *   seedText: string}, akce: {zmenPocet(n: number): void,
 *   prepniPostavu(id: string): void, zmenSeed(text: string): void,
 *   otevriSpis(): void}}} ctx
 */
export function obrazovkaSetup(ctx) {
  const { postavy, setup, akce } = ctx;
  const vybranoOk = setup.vybrane.length === setup.pocet;
  const seedOk = setup.seedText.trim() === '' || /^\d+$/.test(setup.seedText.trim());

  return h(
    'main',
    { class: 'list list-setup' },
    h(
      'header',
      { class: 'spis-hlavicka' },
      h('p', { class: 'formular-popisek' }, 'Policejní okrsek č. 7 — New York · oddělení pátrací'),
      h('h1', {}, 'Důkazní materiál 1930'),
      h('p', { class: 'formular-popisek' }, 'Spis o přepravě nákladu Buffalo → New York · rok 1930')
    ),

    h(
      'section',
      { class: 'formular-blok' },
      h('h2', { class: 'formular-popisek' }, 'Počet podezřelých'),
      h(
        'div',
        { class: 'radka-voleb' },
        [1, 2, 3, 4].map((n) =>
          h(
            'button',
            {
              class: `tlacitko pocet${setup.pocet === n ? ' aktivni' : ''}`,
              onclick: () => akce.zmenPocet(n),
            },
            String(n)
          )
        ),
        h('span', { class: 'napoveda' }, 'hot-seat u jednoho stroje, karty odkryté')
      )
    ),

    h(
      'section',
      { class: 'formular-blok' },
      h('h2', { class: 'formular-popisek' }, `Podezřelé osoby — vyberte ${setup.pocet} (pořadí kliknutí = pořadí u stolu)`),
      h(
        'div',
        { class: 'mrizka-postav' },
        postavy.map((p) => {
          const poradi = setup.vybrane.indexOf(p.id);
          return h(
            'button',
            {
              class: `postava-karta${poradi >= 0 ? ' vybrana' : ''}`,
              onclick: () => akce.prepniPostavu(p.id),
            },
            poradi >= 0 ? h('span', { class: 'razitko razitko-male' }, `u stolu ${poradi + 1}.`) : null,
            h('strong', { class: 'postava-jmeno' }, p.jmeno),
            h('span', { class: 'postava-flavor' }, p.flavor)
          );
        })
      )
    ),

    h(
      'section',
      { class: 'formular-blok' },
      h('h2', { class: 'formular-popisek' }, 'Spisová značka (seed, volitelná)'),
      h(
        'div',
        { class: 'radka-voleb' },
        h('input', {
          class: 'pole-seed',
          type: 'text',
          inputmode: 'numeric',
          placeholder: 'prázdné = náhodný los',
          value: setup.seedText,
          oninput: (/** @type {any} */ ev) => akce.zmenSeed(ev.target.value),
        }),
        h('span', { class: 'napoveda' }, 'stejná značka + stejné volby = stejný run')
      ),
      seedOk ? null : h('p', { class: 'chyba' }, 'Spisová značka musí být celé číslo.')
    ),

    h(
      'footer',
      { class: 'formular-blok formular-paticka' },
      h(
        'button',
        {
          class: 'tlacitko tlacitko-hlavni',
          disabled: !(vybranoOk && seedOk),
          onclick: () => akce.otevriSpis(),
        },
        'Otevřít spis'
      ),
      vybranoOk
        ? null
        : h('p', { class: 'napoveda' }, `Vybráno ${setup.vybrane.length} z ${setup.pocet} osob.`)
    )
  );
}
