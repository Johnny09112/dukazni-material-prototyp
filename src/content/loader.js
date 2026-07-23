// @ts-check
/**
 * v3 content loader (architektura.md §2.1): izomorfní parseContent(yamlStrings)
 * bez I/O — browser ho krmí přes Vite import, simulátor přes fs.
 *
 * Validuje obsah proti v3 schématům z komentářů v hlavičkách obsah/*.yaml
 * (veci / situace / postihy / mista / stitky / pronasledovatele / cile / postavy).
 * Chybové hlášky jsou ČESKY a KONKRÉTNÍ (soubor + id) — obsah ladí
 * neprogramátor. Všechny nalezené chyby se hlásí najednou.
 */

import { load } from 'js-yaml';
import { POSTIH_EFEKTY, STITEK_CHOVANI } from '../engine/rules.js';
import { parseCondition } from '../engine/events.js';

const STATY = ['utok', 'obrana', 'hodnota', 'improvizace', 'nastroj'];
const TYPY_SITUACI = ['npc', 'lokace', 'zatah'];
const TYPY_MIST = ['truhla', 'motel'];
const TYPY_POSTIHU = ['informacni', 'zamkovy', 'ztratovy'];
const TIERY = ['lehky', 'tezky'];
const VIDITELNOSTI = ['viditelna', 'skryta'];
const MAX_TEXT_VECI = 140;
const MAX_SLOV_NAZVU = 3;
const SLOTU = 4;

/**
 * @param {{veci:string, situace:string, postihy:string, mista:string,
 *   stitky:string, pronasledovatele:string, cile:string, postavy:string}} yaml
 * @returns {object} validovaný obsah + `verze`
 * @throws {Error} souhrn všech validačních chyb, česky
 */
export function parseContent(yaml) {
  /** @type {string[]} */
  const chyby = [];

  const veci = parseFile(yaml.veci, 'veci.yaml', 'veci', chyby);
  const situace = parseFile(yaml.situace, 'situace.yaml', 'situace', chyby);
  const postihy = parseFile(yaml.postihy, 'postihy.yaml', 'postihy', chyby);
  const mista = parseFile(yaml.mista, 'mista.yaml', 'mista', chyby);
  const stitky = parseFile(yaml.stitky, 'stitky.yaml', 'stitky', chyby);
  const pronasledovatele = parseFile(yaml.pronasledovatele, 'pronasledovatele.yaml', 'pronasledovatele', chyby);
  const cile = parseFile(yaml.cile, 'cile.yaml', 'cile', chyby);
  const postavy = parseFile(yaml.postavy, 'postavy.yaml', 'postavy', chyby);

  validujUnikatniId([...veci, ...situace, ...postihy, ...mista, ...stitky, ...pronasledovatele, ...cile, ...postavy], chyby);

  const stitkyIds = new Set(stitky.map((s) => s.id));
  const postihIds = new Set(postihy.map((p) => p.id));

  veci.forEach((v) => validujVec(v, stitkyIds, chyby));
  stitky.forEach((s) => validujStitek(s, chyby));
  postihy.forEach((p) => validujPostih(p, stitkyIds, chyby));
  situace.forEach((s) => validujSituace(s, postihIds, stitkyIds, chyby, 'situace.yaml'));
  mista.forEach((m) => validujMisto(m, chyby));
  pronasledovatele.forEach((p) => validujPronasledovatele(p, postihIds, stitkyIds, chyby));
  cile.forEach((c) => validujCil(c, chyby));
  postavy.forEach((p) => validujPostavu(p, chyby));

  // Strukturální minima pro engine.
  if (!situace.some((s) => s.typ === 'zatah')) {
    chyby.push('situace.yaml: chybí Zátah situace (typ: zatah) — engine ji potřebuje pro práh Žáru.');
  }
  if (situace.filter((s) => s.typ === 'npc' || s.typ === 'lokace').length < 2) {
    chyby.push('situace.yaml: potřebuji aspoň 2 maso situace (npc/lokace) — volba cesty je ze 2.');
  }
  if (!stitky.some((s) => s.id === 'GANGSTER')) {
    chyby.push('stitky.yaml: chybí štítek GANGSTER (MVP jediný štítek).');
  }
  if (mista.filter((m) => m.typ === 'truhla').length < 1 || mista.filter((m) => m.typ === 'motel').length < 1) {
    chyby.push('mista.yaml: potřebuji aspoň 1 truhlu a 1 motel.');
  }
  if (pronasledovatele.length < 1) {
    chyby.push('pronasledovatele.yaml: potřebuji aspoň 1 pronásledovatele.');
  }

  if (chyby.length > 0) {
    throw new Error(`Obsah neprošel validací (${chyby.length} chyb):\n- ${chyby.join('\n- ')}`);
  }

  return {
    veci,
    situace,
    postihy,
    mista,
    stitky,
    pronasledovatele,
    cile,
    postavy,
    verze: fnv1a([yaml.veci, yaml.situace, yaml.postihy, yaml.mista, yaml.stitky, yaml.pronasledovatele, yaml.cile, yaml.postavy].join('\n')),
  };
}

/** @param {string} yamlText @param {string} soubor @param {string} klic @param {string[]} chyby */
function parseFile(yamlText, soubor, klic, chyby) {
  if (typeof yamlText !== 'string' || yamlText.trim() === '') {
    chyby.push(`${soubor}: chybí obsah souboru.`);
    return [];
  }
  let data;
  try {
    data = load(yamlText);
  } catch (err) {
    chyby.push(`${soubor}: YAML se nedá načíst — ${err.message}`);
    return [];
  }
  const zaznamy = data?.[klic];
  if (!Array.isArray(zaznamy)) {
    chyby.push(`${soubor}: očekávám seznam pod klíčem „${klic}".`);
    return [];
  }
  zaznamy.forEach((z, i) => {
    if (!z || typeof z.id !== 'string') chyby.push(`${soubor}: záznam č. ${i + 1} nemá id.`);
  });
  return zaznamy.filter((z) => z && typeof z.id === 'string');
}

/** @param {object[]} vse @param {string[]} chyby */
function validujUnikatniId(vse, chyby) {
  const videno = new Set();
  for (const z of vse) {
    if (videno.has(z.id)) chyby.push(`id „${z.id}" není unikátní napříč soubory v obsah/.`);
    videno.add(z.id);
  }
}

/** @param {object} v @param {Set<string>} stitkyIds @param {string[]} chyby */
function validujVec(v, stitkyIds, chyby) {
  const kde = `veci.yaml, věc „${v.id}"`;
  if (typeof v.nazev !== 'string' || v.nazev.trim() === '') chyby.push(`${kde}: chybí název.`);
  else if (v.nazev.trim().split(/\s+/).length > MAX_SLOV_NAZVU) chyby.push(`${kde}: název „${v.nazev}" má víc než ${MAX_SLOV_NAZVU} slova.`);
  if (typeof v.text !== 'string' || v.text.trim() === '') chyby.push(`${kde}: chybí text.`);
  else if (v.text.length > MAX_TEXT_VECI) chyby.push(`${kde}: text má ${v.text.length} znaků (max ${MAX_TEXT_VECI}).`);
  if (!v.staty || typeof v.staty !== 'object') {
    chyby.push(`${kde}: chybí staty.`);
  } else {
    for (const s of STATY) {
      if (!(s in v.staty)) chyby.push(`${kde}: staty postrádají „${s}".`);
      else if (!Number.isInteger(v.staty[s]) || v.staty[s] < 0 || v.staty[s] > 5) chyby.push(`${kde}: stat ${s} = ${v.staty[s]} není celé číslo 0–5.`);
    }
    for (const k of Object.keys(v.staty)) if (!STATY.includes(k)) chyby.push(`${kde}: neznámý stat „${k}".`);
  }
  if (v.stitek !== undefined && !stitkyIds.has(v.stitek)) chyby.push(`${kde}: neznámý štítek „${v.stitek}" (není v stitky.yaml).`);
  if (v.premiova !== undefined && typeof v.premiova !== 'boolean') chyby.push(`${kde}: premiova musí být true/false.`);
}

/** @param {object} s @param {string[]} chyby */
function validujStitek(s, chyby) {
  const kde = `stitky.yaml, štítek „${s.id}"`;
  if (s.id !== s.id.toUpperCase()) chyby.push(`${kde}: id štítku musí být VELKÝMI.`);
  if (typeof s.nazev !== 'string' || s.nazev.trim() === '') chyby.push(`${kde}: chybí název.`);
  const par = s.parametry;
  if (!par || typeof par !== 'object') {
    chyby.push(`${kde}: chybí parametry.`);
    return;
  }
  if (!par.chovani_dle_typu || typeof par.chovani_dle_typu !== 'object') {
    chyby.push(`${kde}: chybí parametry.chovani_dle_typu.`);
  } else {
    for (const [typ, hodnota] of Object.entries(par.chovani_dle_typu)) {
      if (!STITEK_CHOVANI.includes(hodnota)) chyby.push(`${kde}: chovani_dle_typu.${typ} = „${hodnota}" není z (${STITEK_CHOVANI.join(' | ')}).`);
    }
  }
  if (par.hlucnost_zar !== undefined && !Number.isInteger(par.hlucnost_zar)) chyby.push(`${kde}: hlucnost_zar musí být celé číslo.`);
}

/** @param {object} p @param {Set<string>} stitkyIds @param {string[]} chyby */
function validujPostih(p, stitkyIds, chyby) {
  const kde = `postihy.yaml, postih „${p.id}"`;
  if (typeof p.nazev !== 'string' || p.nazev.trim() === '') chyby.push(`${kde}: chybí název.`);
  if (!TYPY_POSTIHU.includes(p.typ)) chyby.push(`${kde}: neplatný typ „${p.typ}" (povolené: ${TYPY_POSTIHU.join(', ')}).`);
  if (!TIERY.includes(p.tier)) chyby.push(`${kde}: neplatný tier „${p.tier}" (povolené: ${TIERY.join(', ')}).`);
  else if (p.tier === 'tezky' && p.trvani !== 'do_vyleceni') chyby.push(`${kde}: těžký postih musí mít trvani „do_vyleceni".`);
  else if (p.tier === 'lehky' && !(p.trvani === 'ihned' || (Number.isInteger(p.trvani) && p.trvani >= 1))) chyby.push(`${kde}: lehký postih má trvani počet kol (≥1) nebo „ihned" (má „${p.trvani}").`);
  if (!p.efekt || typeof p.efekt !== 'object' || typeof p.efekt.druh !== 'string') {
    chyby.push(`${kde}: chybí efekt.druh.`);
  } else if (!POSTIH_EFEKTY.includes(p.efekt.druh)) {
    chyby.push(`${kde}: engine nezná efekt „${p.efekt.druh}" (povolené: ${POSTIH_EFEKTY.join(', ')}).`);
  } else if (p.efekt.druh === 'lock_stitek' && !stitkyIds.has(p.efekt.stitek)) {
    chyby.push(`${kde}: lock_stitek odkazuje na neznámý štítek „${p.efekt.stitek}".`);
  } else if (p.efekt.druh === 'lock_slot_viditelnost' && !VIDITELNOSTI.includes(p.efekt.viditelnost)) {
    chyby.push(`${kde}: lock_slot_viditelnost má neplatnou viditelnost „${p.efekt.viditelnost}".`);
  }
  if (typeof p.text !== 'string' || p.text.trim() === '') chyby.push(`${kde}: chybí text.`);
}

/** @param {object} s @param {Set<string>} postihIds @param {Set<string>} stitkyIds @param {string[]} chyby @param {string} soubor @param {string[]} [dovoleneTypy] */
function validujSituace(s, postihIds, stitkyIds, chyby, soubor, dovoleneTypy = TYPY_SITUACI) {
  const kde = `${soubor}, situace „${s.id}"`;
  if (!dovoleneTypy.includes(s.typ)) chyby.push(`${kde}: neplatný typ „${s.typ}" (povolené: ${dovoleneTypy.join(', ')}).`);
  if (typeof s.telegraf !== 'string' || s.telegraf.trim() === '') chyby.push(`${kde}: chybí telegraf.`);
  if (typeof s.text !== 'string' || s.text.trim() === '') chyby.push(`${kde}: chybí text.`);
  else {
    const mezer = (s.text.match(/\{VEC\}/g) ?? []).length;
    if (mezer !== SLOTU) chyby.push(`${kde}: text má ${mezer} mezer {VEC}, očekávám ${SLOTU}.`);
  }
  if (!Array.isArray(s.sloty) || s.sloty.length !== SLOTU) {
    chyby.push(`${kde}: očekávám přesně ${SLOTU} slotů (má ${s.sloty?.length}).`);
  } else {
    s.sloty.forEach((slot, i) => validujSlot(slot, `${kde}, slot ${i}`, stitkyIds, chyby));
  }
  validujPasmoveVysledky(s.pasmove_vysledky, postihIds, kde, chyby);
  if (s.event !== undefined && (!Array.isArray(s.event) || s.event.some((e) => typeof e !== 'string'))) {
    chyby.push(`${kde}: event musí být seznam textů (flavor).`);
  }
}

/** @param {object} slot @param {string} kde @param {Set<string>} stitkyIds @param {string[]} chyby */
function validujSlot(slot, kde, stitkyIds, chyby) {
  if (typeof slot.role !== 'string' || slot.role.trim() === '') chyby.push(`${kde}: chybí role.`);
  const staty = Array.isArray(slot.stat) ? slot.stat : [slot.stat];
  if (Array.isArray(slot.stat) && slot.stat.length !== 2) chyby.push(`${kde}: kombi stat musí mít přesně 2 staty.`);
  for (const st of staty) if (!STATY.includes(st)) chyby.push(`${kde}: neplatný stat „${st}" (povolené: ${STATY.join(', ')}).`);
  if (!Number.isInteger(slot.kotva) || slot.kotva < 2 || slot.kotva > 4) chyby.push(`${kde}: kotva musí být 2–4 (má ${slot.kotva}).`);
  if (!VIDITELNOSTI.includes(slot.viditelnost)) chyby.push(`${kde}: viditelnost „${slot.viditelnost}" není z (${VIDITELNOSTI.join(' | ')}).`);
  if (slot.stitek_citlivy !== undefined && !stitkyIds.has(slot.stitek_citlivy)) chyby.push(`${kde}: stitek_citlivy „${slot.stitek_citlivy}" není v stitky.yaml.`);
}

/** @param {object} pv @param {Set<string>} postihIds @param {string} kde @param {string[]} chyby */
function validujPasmoveVysledky(pv, postihIds, kde, chyby) {
  if (!pv || typeof pv !== 'object') {
    chyby.push(`${kde}: chybí pasmove_vysledky.`);
    return;
  }
  const lehke = pv.s_nasledky?.postih_lehky;
  const tezke = pv.prusvih?.postih_tezky;
  if (!Array.isArray(lehke) || lehke.length === 0) chyby.push(`${kde}: pasmove_vysledky.s_nasledky.postih_lehky musí být neprázdný seznam.`);
  else for (const id of lehke) if (!postihIds.has(id)) chyby.push(`${kde}: neznámý lehký postih „${id}".`);
  if (!Array.isArray(tezke) || tezke.length === 0) chyby.push(`${kde}: pasmove_vysledky.prusvih.postih_tezky musí být neprázdný seznam.`);
  else for (const id of tezke) if (!postihIds.has(id)) chyby.push(`${kde}: neznámý těžký postih „${id}".`);
}

/** @param {object} m @param {string[]} chyby */
function validujMisto(m, chyby) {
  const kde = `mista.yaml, místo „${m.id}"`;
  if (!TYPY_MIST.includes(m.typ)) {
    chyby.push(`${kde}: neplatný typ „${m.typ}" (povolené: ${TYPY_MIST.join(', ')}).`);
    return;
  }
  if (typeof m.text !== 'string' || m.text.trim() === '') chyby.push(`${kde}: chybí text.`);
  if (m.typ === 'truhla') {
    const r = m.odmena?.kredity_rozsah;
    if (!Array.isArray(r) || r.length !== 2 || !Number.isInteger(r[0]) || !Number.isInteger(r[1]) || r[0] > r[1]) {
      chyby.push(`${kde}: truhla musí mít odmena.kredity_rozsah [min, max].`);
    }
  } else {
    const sl = m.sluzby;
    if (!sl || !Number.isInteger(sl.smena_karty) || !Number.isInteger(sl.leceni_tezkeho)) {
      chyby.push(`${kde}: motel musí mít sluzby.smena_karty a sluzby.leceni_tezkeho.`);
    }
  }
}

/** @param {object} p @param {Set<string>} postihIds @param {Set<string>} stitkyIds @param {string[]} chyby */
function validujPronasledovatele(p, postihIds, stitkyIds, chyby) {
  const kde = `pronasledovatele.yaml, pronásledovatel „${p.id}"`;
  if (typeof p.nazev !== 'string' || p.nazev.trim() === '') chyby.push(`${kde}: chybí název.`);
  if (typeof p.flavor !== 'string' || p.flavor.trim() === '') chyby.push(`${kde}: chybí flavor.`);
  const r = p.rusi;
  if (!r || typeof r !== 'object') {
    chyby.push(`${kde}: chybí rusi (co proti němu neplatí).`);
  } else {
    if (r.typ !== 'stat' && r.typ !== 'stitek') chyby.push(`${kde}: rusi.typ musí být stat | stitek (má „${r.typ}").`);
    else if (r.typ === 'stat' && !STATY.includes(r.cil)) chyby.push(`${kde}: rusi.cil „${r.cil}" není stat.`);
    else if (r.typ === 'stitek' && !stitkyIds.has(r.cil)) chyby.push(`${kde}: rusi.cil „${r.cil}" není štítek z stitky.yaml.`);
    if (typeof r.pravidlo !== 'string' || r.pravidlo.trim() === '') chyby.push(`${kde}: chybí rusi.pravidlo.`);
  }
  for (const [klic, typ] of [['lecka', 'lecka'], ['konfrontace', 'konfrontace']]) {
    if (!p[klic] || typeof p[klic] !== 'object') {
      chyby.push(`${kde}: chybí ${klic}.`);
      continue;
    }
    validujSituace({ ...p[klic], id: `${p.id}-${klic}` }, postihIds, stitkyIds, chyby, `pronasledovatele.yaml (${p.id}.${klic})`, [typ]);
  }
}

/** @param {object} c @param {string[]} chyby */
function validujCil(c, chyby) {
  const kde = `cile.yaml, cíl „${c.id}"`;
  if (typeof c.text !== 'string' || c.text.trim() === '') chyby.push(`${kde}: chybí text.`);
  if (typeof c.overeni !== 'string' || c.overeni.trim() === '') chyby.push(`${kde}: chybí overeni.`);
  if (!Number.isInteger(c.body) || c.body < 1 || c.body > 3) chyby.push(`${kde}: body musí být 1–3 (má ${c.body}).`);
  if (c.overeni_typ === 'mechanicky') {
    if (typeof c.podminka !== 'string' || c.podminka.trim() === '') {
      chyby.push(`${kde}: mechanický cíl musí mít pole podminka.`);
      return;
    }
    try {
      parseCondition(c.podminka);
    } catch (err) {
      chyby.push(`${kde}: podminka se nedá naparsovat — ${err.message}`);
    }
  } else if (c.overeni_typ === 'textovy') {
    if (c.podminka !== undefined) chyby.push(`${kde}: textový cíl nesmí mít pole podminka.`);
  } else {
    chyby.push(`${kde}: overeni_typ musí být mechanicky | textovy (má „${c.overeni_typ}").`);
  }
}

/** @param {object} p @param {string[]} chyby */
function validujPostavu(p, chyby) {
  const kde = `postavy.yaml, postava „${p.id}"`;
  if (typeof p.jmeno !== 'string' || p.jmeno.trim() === '') chyby.push(`${kde}: chybí jmeno.`);
  if (typeof p.flavor !== 'string' || p.flavor.trim() === '') chyby.push(`${kde}: chybí flavor.`);
}

/** FNV-1a hash → hex; verze obsahu do run_started (ADR-005). @param {string} text */
function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
