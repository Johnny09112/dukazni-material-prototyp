# CLAUDE.md — Důkazní materiál 1930: prototyp v0.1

Kódový repozitář prototypu. **Zadání a zdroj pravdy žije v design repu**,
který je zde jako git submodule `content/`:

- `content/technika/architektura.md` — **závazná architektura (7 ADR)**. Změna
  architektury = nové/aktualizované ADR tam, ne tichá odchylka tady.
- `content/prototyp-mvp.md` — resoluční systém (aktuální čísla pravidel).
- `content/obsah/*.yaml` — herní obsah (karty, uzly, cíle, pronásledovatelé).
- `content/prompty/protokol.md` — kanonický prompt protokolu (v0.2) +
  `protokol-testy.yaml` (regresní baterie).

## Neporušitelné principy (z design repa, vynucované i zde)

1. **Mechanika rozhoduje, AI vypráví.** LLM dostává hotový výsledek
   (`node_resolved`) a jen ho dramatizuje. Kód, který dává LLM rozhodovací
   pravomoc, je chyba.
2. **Engine je headless a deterministický** (ADR-002): žádný DOM, síť ani
   hodiny v `src/engine/`; veškerá náhoda z jediného seedovaného PRNG.
   `Math.random` a `Date.now` jsou v enginu zakázané (hlídá ESLint).
3. **Pravidla jako data** (ADR-003): všechna resoluční čísla jen
   v `src/engine/rules.js`; hodnoty se přebírají z `content/prototyp-mvp.md`.
   Konstanta resolučního systému kdekoli jinde = chyba.
4. **Hra nikdy nečeká na síť** (ADR-004): 10 s timeout → fallback šablona.
   Bez API klíče je hra plně hratelná.
5. **Obsah se zde NEEDITUJE.** `content/` je read-only submodule; obsah se mění
   v design repu a sem se pinuje update submodulu. Kopie obsahu = chyba.
6. **Žádný volný text hráčů do LLM** (prompt injection).

## Konvence

- **Kód anglicky** (identifikátory, komentáře), **dokumentace a commit zprávy
  česky**. Herní texty jsou v obsahu (česky), kód je nevlastní.
- JSDoc anotace na hranicích modulů (engine API, události, provider), volitelně
  `// @ts-check`. TypeScript ne (ADR-001).
- **Testy (Vitest) musí projít před každým commitem.** Golden-run snapshoty se
  mění jen vědomě — commit message říká proč.
- Po dokončení ucelené práce **commitni a pushni sám** (stejná konvence jako
  design repo). Nikdy necommituj rozbitý stav, `.env` ani klíče.
- Windows prostředí; skripty spouštěj přes npm, ne přes bash-only nástroje.

## Struktura a pořadí stavby

Dle `content/technika/architektura.md` §6 (struktura) a §5 (pořadí):
1. **Engine + simulátor** (headless, `npm run sim`) — první měření musí
   potvrdit čísla simulační brány (viz `content/technika/simulacni-brana-2026-07-22.md`:
   kompetentní strategie ≤70 % DORUČENO; výhrada č. 1).
2. **Hot-seat UI s fallback šablonami** — hratelné bez klíče; psací stroj.
3. **LLM adaptér** — provider-agnostic, až nakonec.

## Stav a paměť

Procesní stav projektu (backlog, rozhodnutí) žije v design repu
(`content/projekt/stav.md`, `content/projekt/rozhodnuti.md`) — tady se
nevede druhá kopie. Technická rozhodnutí tohoto repa = ADR v architektuře.
