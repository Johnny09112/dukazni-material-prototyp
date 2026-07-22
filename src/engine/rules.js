// @ts-check
/**
 * Resoluční pravidla jako data (ADR-003).
 *
 * Jediné místo v kódu, kde smí žít resoluční čísla. Hodnoty se přebírají
 * z `content/prototyp-mvp.md` (§ Resoluční systém, stav po kalibraci D7–D11,
 * 2026-07-22). Konstanta resolučního systému kdekoli jinde = chyba.
 *
 * Simulátor umí pustit tutéž dávku proti více variantám tohoto objektu
 * (architektura.md ADR-003).
 */

export const RULES = {
  /** Verze pravidel — jde do události run_started. */
  verze: 'v0.1 / prototyp-mvp.md 2026-07-22 (po D7–D11)',

  /** Hod: d6 + síla + afinita − min(zranění, maxPostihZraneni). */
  kostka: 6,

  /**
   * Pásma výsledku (prototyp-mvp.md: 7+ úspěch / 5–6 úspěch za cenu /
   * ≤4 selhání; práh snížen z 8+ na 7+ po 2. běhu simulace).
   */
  prahUspechu: 7,
  prahUspechuZaCenu: 5,

  /** Postih za zranění: −počet zranění, max −3. */
  maxPostihZraneni: 3,

  /** Ruka 5 karet, po každém uzlu doliz na 5. */
  velikostRuky: 5,

  /** Tým veze 6 beden; 0 beden = NEVYŘEŠENO. */
  bedenNaStartu: 6,

  /** Run = 6 uzlů; volba vždy ze 2 nabízených cest. */
  uzluNaRun: 6,
  nabidkaCest: 2,

  /** Tvrdost uzlu při selhání: bedna −1 / zar +2 per selhání / zraneni = druhé zranění. */
  tvrdostBednaZtrata: 1,
  tvrdostZarPrirustek: 2,
  tvrdostZraneniNavic: 1,

  zar: {
    max: 10,
    /** +1 za uzel s aspoň jedním selháním (max 1× za uzel). */
    zaUzelSeSelhanim: 1,
    /** +1 za každou zahranou hlučnou kartu (per karta). */
    zaHlucnouKartu: 1,
    /**
     * Hook „+2 za vybrané výsledky uzlů" (prototyp-mvp.md). Obsah v0.1 žádný
     * takový flag u uzlů nemá, takže se hodnota v běhu NIKDY nepoužije —
     * hook existuje, aby budoucí flag v obsahu nevyžadoval zásah do resoluce.
     */
    zaVybranyVysledekUzlu: 2,
    /** Prahy Žáru: 5 = Zátah nahradí OBĚ cesty, 7 = léčka, 10 = konfrontace. */
    prahy: { zatah: 5, lecka: 7, konfrontace: 10 },
    /** Přežití konfrontace → Žár klesá na 3 (finále se nesmí recyklovat). */
    poPrezitiKonfrontace: 3,
  },

  /** 4. zranění = kolaps postavy (vyřazena, dál jen „hlas z auta"). */
  kolapsPriZraneni: 4,

  /** Od 2. zranění dál: každé zranění = líznutí prokleté karty. */
  prokletaOdZraneni: 2,

  /** Zoufalé karty hratelné jen s 3+ zraněními; ignorují postih za zranění. */
  zoufalaOdZraneni: 3,

  /** Hlas z auta: vyřazený hráč dá spoluhráči +1 k hodu, NEBO mu lízne prokletou. */
  hlasZAutaBonus: 1,

  /** Prokletá „Ztráta důstojnosti": selže-li tým v uzlu, +1 Žár navíc (celkem +2). */
  ztrataDustojnostiZarNavic: 1,
};

/**
 * Mechanické efekty prokletých karet (typ `prokleta` v obsah/karty.yaml).
 *
 * Obsahové YAML nese jen text karty (schéma efektová pole nemá); mechanika
 * textů je zafixovaná zde a loader validuje, že každá prokletá karta v obsahu
 * má známý efekt. Priorita: zákaz tagu má přednost před vynucením (Zbrklost).
 *
 * @type {Record<string, {zakazTag?: string, modHodu?: number, hlucna?: boolean,
 *   zarNavicPriSelhaniUzlu?: number, nejvyssiSila?: boolean}>}
 */
export const CURSED_EFFECTS = {
  krec: { zakazTag: 'nasili' },
  'roztresene-ruce': { zakazTag: 'lest' },
  'prazdne-kapsy': { zakazTag: 'uplatek' },
  'podvrtnuty-kotnik': { zakazTag: 'utek' },
  kocovina: { modHodu: -2 },
  'ztrata-dustojnosti': { zarNavicPriSelhaniUzlu: RULES.ztrataDustojnostiZarNavic },
  'nutkani-ochutnat': { modHodu: -2, hlucna: true },
  zbrklost: { nejvyssiSila: true },
};

/**
 * Mechanika pronásledovatelů (obsah/pronasledovatele.yaml, pole `pravidlo`).
 *
 * - Malone: karty Úplatek mají sílu 0 na JEHO uzlech (Zátah, léčka, konfrontace).
 * - Brody: každá hlučná karta +2 Žár místo +1 (globálně, na všech uzlech).
 *
 * @type {Record<string, {silaNulaTagNaJehoUzlech?: string, zarZaHlucnou?: number}>}
 */
export const PURSUER_EFFECTS = {
  'agent-malone': { silaNulaTagNaJehoUzlech: 'uplatek' },
  'serif-brody': { zarZaHlucnou: 2 },
};
