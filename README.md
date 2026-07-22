# Důkazní materiál 1930 — prototyp v0.1

Kooperativní party hra (1–4 hráči): gangsteři pašují chlast z Buffala do New
Yorku, zkorumpovaný polda o tom píše protokol. **Mechanika rozhoduje, AI vypráví.**

Tento repozitář je digitální prototyp (Vite + vanilla JS, hot-seat). Design,
pravidla a herní obsah žijí v design repu, připojeném jako submodule `content/`.

## Setup

```bash
git clone --recurse-submodules <url>
npm install
npm test          # Vitest — unit + golden runs + validace obsahu
npm run sim       # headless simulátor (dávky runů, summary)
npm run dev       # hot-seat UI (Vite dev server)
```

Bez API klíče hra běží plně na fallback šablonách. Pro LLM protokoly zkopíruj
`.env.example` → `.env` a doplň klíč (build se nikam nenasazuje, klíč zůstává
lokální — viz architektura ADR-006).

Živé ladění obsahu: nastav `CONTENT_DIR` na lokální checkout design repa
(jinak se čte pinovaný submodule `content/`).

## Dokumentace

- `CLAUDE.md` — pravidla práce v tomto repu.
- `content/technika/architektura.md` — architektura (7 ADR), struktura, testy.
- `content/prototyp-mvp.md` — resoluční systém a definice MVP.
