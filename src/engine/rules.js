// @ts-check
/**
 * Resoluční pravidla v3 jako data (ADR-003).
 *
 * Jediné místo v kódu, kde smí žít resoluční ČÍSLA. Hodnoty se přebírají
 * z `content/prototyp-mvp.md` (§ Resoluční systém v3). Konstanta resolučního
 * systému kdekoli jinde = chyba. **Všechna čísla jsou „ladit simulací"** —
 * v3 simulační brána je otevřená a pásmo K1 se fixuje až po diagnostickém
 * run-1 (Fáze 0). Simulátor umí pustit tutéž dávku proti více variantám
 * tohoto objektu (ADR-003) — kalibrace bez forku kódu.
 *
 * Pozn.: MECHANIKY (chování štítku, efekt postihu, rušení pronásledovatele)
 * NEjsou zde — jsou strojově v obsahu (stitky/postihy/pronasledovatele.yaml)
 * a engine implementuje uzavřený enum. Zde jen tuning.
 */

export const RULES = {
  /** Verze pravidel — jde do události run_started. */
  verze: 'v0.3 / prototyp-mvp.md 2026-07-23 (slotová resoluce v3; výchozí čísla — ladit simulací)',

  /** Pět statů věci, pořadí kanonické (obsah/veci.yaml). */
  staty: /** @type {const} */ (['utok', 'obrana', 'hodnota', 'improvizace', 'nastroj']),
  statMin: 0,
  statMax: 5,

  /** Situace má přesně 4 sloty; tým committne přesně 4 karty. */
  slotu: 4,

  /** Skryté prahy: kotva 2–4 (práh 0 zakázán) + šum uniform v {−1,0,+1}. */
  kotvaMin: 2,
  kotvaMax: 4,
  sumRozsah: 1,

  /**
   * Ruce a rozdělení commitu dle počtu hráčů — JEDINÁ páka na vyrovnání agency
   * (prototyp-mvp.md §Ruce). `commit` je rozdělení 4 committnutých karet mezi
   * hráče (u 3p prvních `2` committne držitel mapy — role rotuje po uzlu).
   */
  ruce: {
    1: { ruka: 6, commit: [4] },
    2: { ruka: 4, commit: [2, 2] },
    3: { ruka: 4, commit: [2, 1, 1] },
    4: { ruka: 3, commit: [1, 1, 1, 1] },
  },

  /** Páteř runu ~7 uzlů; tým veze bedny, 0 = konec (NEVYŘEŠENO). */
  uzluNaRun: 7,
  bedenNaStartu: 6,

  /**
   * Mapa (StS páteř): truhla je pevný krok (nejde vyroutovat kolem masa),
   * motel je binární odbočka nabídnutá před danými kroky (mid + late).
   * Ostatní kroky jsou maso (npc/lokace). Ladit simulací.
   */
  map: {
    truhlaKrok: 3,
    motelKroky: [4, 6],
  },

  /** PRŮŠVIH (≤1/4) bere náklad. */
  nakladPrusvihZtrata: 1,

  /** Postihy — cap a eskalace; tiery + efekty nese obsah/postihy.yaml. */
  postihy: {
    /** Cap aktivních postihů na hráče; 3. postih → „složení". */
    capNaHrace: 2,
    /** Složená postava leží kolo–dvě (RNG v rozsahu), pak se vrací. */
    slozeniKolMin: 1,
    slozeniKolMax: 2,
  },

  /** Kreditová ekonomika (společné, per-run; ceny/příjmy — mista.yaml je nese taky). */
  kredity: {
    startovni: 0,
    /** Příjmy dle pásma. */
    zaHladceLoot: 2, // 4/4
    zaHladce: 1, // 3/4
    /** Ceny v motelu (zrcadlí obsah/mista.yaml `sluzby`). */
    smenaKarty: 3,
    leceniTezkeho: 6,
  },

  /** Gamble — záchrana po odhalení, 1× za situaci. */
  gamble: {
    naSituaci: 1,
  },

  /**
   * Žár (0–10): týmová stopa pozornosti, pozice na trati (křížkující šerif).
   * Roste za PRŮŠVIH, hlučné hraní (GANGSTER, vysoký útok) a vybrané výsledky.
   * Každý pohyb nese anotaci `duvod` (POVINNÁ, viz events.ZAR_DUVOD).
   */
  zar: {
    max: 10,
    /** +N za PRŮŠVIH pásmo. */
    zaPrusvih: 2,
    /** +N za S_NÁSLEDKY pásmo (mírný tlak). */
    zaSNasledky: 1,
    /** +N za každou GANGSTER věc ve slotu (Brody run-wide ZDVOJNÁSOBUJE — obsah). */
    zaGangster: 1,
    /** Non-GANGSTER věc se statem útok ≥ prahem přiřazená do slotu = hlučná. */
    hlucnyUtokPrah: 4,
    zaHlucnyUtok: 1,
    /** Prahy na trati: Zátah (nahradí příští uzel), léčka (vložený uzel),
     *  konfrontace (finále; přežití srazí Žár). */
    prahy: { zatah: 4, lecka: 7, konfrontace: 10 },
    /** Přežití konfrontace → Žár klesá na tuto hodnotu (prahy se znovu nabijí). */
    poPrezitiKonfrontace: 3,
  },
};

/**
 * Uzavřený enum efektů postihů, které engine IMPLEMENTUJE (D19, ADR-008).
 * Loader validuje, že obsah/postihy.yaml `efekt.druh` je z této sady;
 * engine je k parametrům agnostický až na tyto známé druhy.
 * @type {readonly string[]}
 */
export const POSTIH_EFEKTY = /** @type {const} */ ([
  // informační
  'hide_staty',
  'hide_telegraf',
  'hide_viditelnost',
  // zámkové
  'lock_stitek',
  'lock_slot_viditelnost',
  'lock_gamble',
  // ztrátové
  'ztrata_kreditu',
  'ztrata_karty',
  'ztrata_naklad',
  'ruka_minus',
]);

/**
 * Chování GANGSTER štítku per typ situace, které engine implementuje
 * (obsah/stitky.yaml `chovani_dle_typu`). Uzavřený enum hodnot.
 * @type {readonly string[]}
 */
export const STITEK_CHOVANI = /** @type {const} */ (['viditelna_role_selze', 'vzdy_pass']);
