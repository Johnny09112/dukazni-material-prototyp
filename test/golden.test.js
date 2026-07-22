// @ts-check
/**
 * Golden runs (regresní testy resoluce, architektura.md §6): fixní seed +
 * deterministická skriptovaná sekvence voleb (greedy-affinity je bez náhody)
 * nad reálným obsahem → snapshot CELÉHO událostního logu.
 *
 * Změna pravidel nebo obsahu změní snapshot VIDITELNĚ a ZÁMĚRNĚ — commit
 * message musí říct proč (viz CLAUDE.md). Nikdy neaktualizuj snapshot bez
 * vysvětlení.
 */
import { describe, it, expect } from 'vitest';
import { parseContent } from '../src/content/loader.js';
import { RULES } from '../src/engine/rules.js';
import { playRun } from '../sim/run.js';
import { loadRealYaml } from './content.test.js';

const content = parseContent(loadRealYaml());
const players = [
  { id: 'postava-1', jmeno: 'Postava 1' },
  { id: 'postava-2', jmeno: 'Postava 2' },
  { id: 'postava-3', jmeno: 'Postava 3' },
  { id: 'postava-4', jmeno: 'Postava 4' },
];

describe('golden runy nad reálným obsahem', () => {
  it('seed 42, greedy-affinity, 4 hráči, Malone', () => {
    const events = playRun({
      seed: 42,
      content,
      rules: RULES,
      players,
      pronasledovatelId: 'agent-malone',
      strategyName: 'greedy-affinity',
    });
    expect(events.at(-1).type).toBe('run_ended');
    expect(events).toMatchSnapshot();
  });

  it('seed 7, greedy-affinity, 4 hráči, Brody', () => {
    const events = playRun({
      seed: 7,
      content,
      rules: RULES,
      players,
      pronasledovatelId: 'serif-brody',
      strategyName: 'greedy-affinity',
    });
    expect(events.at(-1).type).toBe('run_ended');
    expect(events).toMatchSnapshot();
  });

  it('golden run je reprodukovatelný (dvakrát stejný log)', () => {
    const parametry = {
      seed: 42,
      content,
      rules: RULES,
      players,
      pronasledovatelId: 'agent-malone',
      strategyName: 'greedy-affinity',
    };
    expect(JSON.stringify(playRun(parametry))).toBe(JSON.stringify(playRun(parametry)));
  });
});
