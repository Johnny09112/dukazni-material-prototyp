// @ts-check
/**
 * v3 golden runs (regresní testy resoluce, architektura.md §6): fixní seed +
 * deterministická strategie nad reálným obsahem → snapshot CELÉHO událostního
 * logu slotové resoluce.
 *
 * Změna pravidel nebo obsahu změní snapshot VIDITELNĚ a ZÁMĚRNĚ — commit
 * message musí říct proč (viz CLAUDE.md). Nikdy neaktualizuj snapshot bez
 * vysvětlení.
 */
import { describe, it, expect } from 'vitest';
import { parseContent } from '../src/content/loader.js';
import { RULES } from '../src/engine/rules.js';
import { playRun, PRESETY } from '../sim/run.js';
import { loadRealYaml } from './content.test.js';

const content = parseContent(loadRealYaml());
const hraci = (n) => content.postavy.slice(0, n).map((p) => ({ id: p.id, jmeno: p.jmeno }));

describe('v3 golden runy nad reálným obsahem', () => {
  it('seed 42, kompetentni, 1 hráč, Malone', () => {
    const events = playRun({ seed: 42, content, rules: RULES, players: hraci(1), pronasledovatelId: 'agent-malone', spec: PRESETY.kompetentni });
    expect(events.at(-1).type).toBe('run_ended');
    expect(events).toMatchSnapshot();
  });

  it('seed 7, kompetentni, 4 hráči, Brody', () => {
    const events = playRun({ seed: 7, content, rules: RULES, players: hraci(4), pronasledovatelId: 'serif-brody', spec: PRESETY.kompetentni });
    expect(events.at(-1).type).toBe('run_ended');
    expect(events).toMatchSnapshot();
  });

  it('golden run je reprodukovatelný (dvakrát stejný log)', () => {
    const p = { seed: 42, content, rules: RULES, players: hraci(2), pronasledovatelId: 'agent-malone', spec: PRESETY.kompetentni };
    expect(JSON.stringify(playRun(p))).toBe(JSON.stringify(playRun(p)));
  });
});
