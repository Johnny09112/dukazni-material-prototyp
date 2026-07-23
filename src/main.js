// @ts-check
/**
 * Vstup Vite aplikace.
 *
 * POZOR: hot-seat UI je po pivotu na v3 (slotová resoluce) DOČASNĚ ODPOJENO —
 * v2 UI (`ui/app.js`, `ui/screens/*`) stálo na kostkové resoluci a starém
 * obsahu (karty.yaml/uzly.yaml, dnes v content/obsah/archiv-v2/). Fáze 2.1
 * (přestavba UI na sloty) přijde AŽ PO v3 simulační bráně (viz
 * content/projekt/stav.md „Další kroky" bod 3). Do té doby engine + simulátor
 * jedou headless (`npm run sim`, `npm test`); tento vstup jen drží dev server
 * naživu, ať se repo nerozbije.
 */
import './ui/style.css';

const app = document.querySelector('#app');
if (app) {
  app.innerHTML = `
    <main style="max-width:52ch;margin:12vh auto;padding:0 1.5rem;font-family:Georgia,serif;line-height:1.6;">
      <h1 style="font-size:1.4rem;">Důkazní materiál 1930 — prototyp v0.1</h1>
      <p><strong>UI je dočasně odpojeno.</strong> Probíhá přestavba enginu na
      slotovou resoluci (v3). Hratelné hot-seat UI (fáze 2.1) přijde až po
      splnění v3 simulační brány.</p>
      <p style="opacity:.7;">Zatím běží headless vrstva:</p>
      <ul style="opacity:.7;">
        <li><code>npm test</code> — engine, loader, golden runy, invarianty</li>
        <li><code>npm run sim</code> — simulátor metrik brány K1–K9</li>
      </ul>
    </main>`;
}
