// breeding.js — genome CROSSOVER genetics + a small in-memory roster model for
// the Explorer breeding feature.
//
// Two parents -> one child genome over GENOME_SCHEMA. The model is deterministic:
// the same (parentA, parentB, seed) always yields the same child (seeded
// mulberry32 — NO Math.random / Date.now anywhere in the genetics, so breeding is
// reproducible for testing + stable inheritance). The child is always schema-valid
// (every trait clamped to its [min,max]; integer/step traits rounded).
//
// Inheritance model (per trait):
//   * CATEGORICAL traits (integer step===1, e.g. toeCount / earPairs / barbelPairs):
//     Mendelian — pick ONE parent's allele wholesale (no blending an int count).
//   * patternSeed: inherit ONE parent's CA seed wholesale, so the marking cellular
//     automaton stays coherent (a blended seed would read as an unrelated pattern).
//     The *other* marking traits (hue/scale/contrast/type) DO blend, so the child's
//     coat reads as a genuine mix of the two parents (like the gallery tree).
//   * CONTINUOUS traits: usually blend toward a random midpoint (slight variance),
//     but with a chance to inherit one parent's value outright (dominance), so
//     children aren't always the bland average of their parents.
//   * MUTATION: a small per-trait chance to nudge the value by a fraction of the
//     trait range (reuses the gallery's jitter idea) — keeps a lineage from
//     converging and lets novelty appear.
//
// This module is DOM-free and imports only the schema, so it is trivially testable
// headless (window.__testbed.breed routes straight here).

import { GENOME_SCHEMA, DEFAULT_GENOME, ARCHETYPES } from './generator.js';

// ---------------------------------------------------------------------------
// mulberry32 — the same tiny seeded PRNG the gallery tool uses. Deterministic
// 32-bit-seed -> [0,1) stream. Breeding NEVER uses bare Math.random.
// ---------------------------------------------------------------------------
export function mulberry32(a) {
  a >>>= 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Categorical (Mendelian) traits = integer-step traits, EXCEPT patternSeed (that
// is a PRNG seed, handled separately so the pattern stays coherent).
export const CATEGORICAL_TRAITS = GENOME_SCHEMA
  .filter((t) => t.step === 1 && t.name !== 'patternSeed')
  .map((t) => t.name);
const CATEGORICAL = new Set(CATEGORICAL_TRAITS);

// Mutation tuning. Small so children clearly resemble their parents, but non-zero
// so a lineage keeps drifting/exploring.
export const MUTATION_RATE = 0.14;   // per-trait chance to mutate
export const MUTATION_MAG = 0.09;    // magnitude as a fraction of the trait range

// Fold the two parent genomes + the caller seed into ONE 32-bit seed, so the whole
// child is a deterministic function of (A, B, seed) — swapping seed reshuffles every
// per-trait coin flip. Quantise floats to 1e-3 so trivially-equal genomes hash equal.
function hashSeed(a, b, seed) {
  let h = ((seed >>> 0) ^ 0x9E3779B9) >>> 0;
  for (const t of GENOME_SCHEMA) {
    const qa = Math.round((a[t.name] ?? 0) * 1000);
    const qb = Math.round((b[t.name] ?? 0) * 1000);
    h = Math.imul(h ^ (qa & 0xffffffff), 0x85EBCA6B);
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h ^ (qb & 0xffffffff), 0xC2B2AE35);
    h = (h ^ (h >>> 16)) >>> 0;
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// crossover(genomeA, genomeB, seed) -> childGenome
// ---------------------------------------------------------------------------
// Deterministic. Always returns a schema-valid, complete genome (all trait keys).
export function crossover(genomeA, genomeB, seed = 1) {
  const a = { ...DEFAULT_GENOME, ...genomeA };
  const b = { ...DEFAULT_GENOME, ...genomeB };
  const rng = mulberry32(hashSeed(a, b, seed));
  const child = {};

  for (const t of GENOME_SCHEMA) {
    const va = a[t.name];
    const vb = b[t.name];
    let v;

    if (t.name === 'patternSeed') {
      // Inherit one parent's CA seed wholesale (coherent marking pattern).
      child[t.name] = rng() < 0.5 ? va : vb;
      continue;
    }

    if (CATEGORICAL.has(t.name)) {
      // Mendelian: take one parent's whole-number allele.
      v = rng() < 0.5 ? va : vb;
    } else {
      const r = rng();
      if (r < 0.22) v = va;                 // A dominant for this trait
      else if (r < 0.44) v = vb;            // B dominant for this trait
      else {
        // Blend toward a jittered midpoint (~0.2..0.8 of the way A->B).
        const mix = 0.5 + (rng() - 0.5) * 0.6;
        v = va + (vb - va) * mix;
      }
    }

    // Small mutation nudge (a fraction of the trait's own range).
    if (rng() < MUTATION_RATE) {
      v += (rng() * 2 - 1) * MUTATION_MAG * (t.max - t.min);
    }

    // Schema validity: clamp to range, snap stepped traits to integers.
    v = Math.max(t.min, Math.min(t.max, v));
    if (t.step === 1) v = Math.round(v);
    child[t.name] = v;
  }

  return child;
}

// ---------------------------------------------------------------------------
// randomGenome(seed) -> a fully-random, schema-valid genome (deterministic).
// A convenient way to spawn a novel unrelated parent for the roster.
// ---------------------------------------------------------------------------
export function randomGenome(seed = 1) {
  const rng = mulberry32((seed >>> 0) || 1);
  const g = {};
  for (const t of GENOME_SCHEMA) {
    let v = t.min + rng() * (t.max - t.min);
    if (t.step === 1) v = Math.round(v);
    g[t.name] = v;
  }
  return g;
}

// ---------------------------------------------------------------------------
// starterRoster() -> [{ name, genome, archetype }] — a few archetype dragons to
// seed an empty roster with, so there is always something to breed from.
// ---------------------------------------------------------------------------
export function starterRoster() {
  const pick = [
    ['wyvern', 'Ember Wyvern'],
    ['drake', 'Slate Drake'],
    ['snake', 'Jade Serpent'],
    ['eastern', 'Amber Longwyrm'],
  ];
  return pick
    .filter(([k]) => ARCHETYPES[k])
    .map(([k, name]) => ({ name, archetype: k, genome: { ...ARCHETYPES[k] } }));
}
