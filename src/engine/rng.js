// @ts-check
/**
 * Seedovaný PRNG — jediný zdroj náhody enginu (ADR-002).
 *
 * Implementace: mulberry32. Stejný seed => bit-přesně stejná sekvence,
 * tedy stejný run i událostní log (viz architektura.md §2.2).
 */

/**
 * @param {number} seed 32bit seed
 * @returns {{next(): number, int(n: number): number, die(sides: number): number,
 *   pick<T>(arr: T[]): T, shuffle<T>(arr: T[]): T[]}}
 */
export function createRng(seed) {
  let a = seed >>> 0;

  /** @returns {number} v intervalu [0, 1) */
  function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    next,
    /** Celé číslo 0..n-1. */
    int(n) {
      return Math.floor(next() * n);
    },
    /** Hod kostkou 1..sides. */
    die(sides) {
      return 1 + Math.floor(next() * sides);
    },
    /** Náhodný prvek pole. */
    pick(arr) {
      return arr[Math.floor(next() * arr.length)];
    },
    /** Fisher–Yates; vrací NOVÉ pole, vstup nemutuje. */
    shuffle(arr) {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
}
