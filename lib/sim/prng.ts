/**
 * Seeded PRNG. The only source of randomness in the simulation.
 *
 * Integer arithmetic only — no floats anywhere, so the output is bit-identical on
 * every engine and platform. The state is a plain uint32 carried by value, which
 * lets it be threaded through pure state machines and snapshotted with the rest of
 * the simulation state.
 *
 * Algorithm: mulberry32. Chosen because it is 32-bit throughout, has no
 * multiply-high or 64-bit dependency, and passes gjrand/practrand at the sizes this
 * simulator uses.
 */

/** Opaque PRNG state. A uint32. Copy it freely; never mutate it. */
export type Prng = number

const GAMMA = 0x6d2b79f5

/**
 * Derive a PRNG state from a seed. Distinct seeds give distinct streams, and
 * distinct `stream` values give independent streams from the same seed — used to
 * give each node its own timeout stream without correlating them.
 */
export function prngFromSeed(seed: number, stream = 0): Prng {
  // Two rounds of avalanche so that adjacent seeds (0, 1, 2 …) — which is exactly
  // how a fuzz run enumerates — produce uncorrelated streams.
  let h = (seed | 0) ^ Math.imul(stream | 0, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad)
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97)
  return (h ^ (h >>> 15)) >>> 0
}

/** Next raw uint32, with the advanced state. */
export function nextUint32(prng: Prng): { prng: Prng; value: number } {
  const next = (prng + GAMMA) >>> 0
  let t = next | 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return { prng: next, value: (t ^ (t >>> 14)) >>> 0 }
}

/**
 * Uniform integer in [minInclusive, maxInclusive].
 *
 * Rejection-sampled rather than modulo-reduced: modulo bias is small here but it is
 * not zero, and election-timeout jitter is the mechanism that breaks split votes.
 * Biasing it would quietly bias every election in the simulator.
 */
export function nextInt(prng: Prng, minInclusive: number, maxInclusive: number): { prng: Prng; value: number } {
  if (maxInclusive < minInclusive) {
    throw new Error(`nextInt: empty range [${minInclusive}, ${maxInclusive}]`)
  }
  const span = maxInclusive - minInclusive + 1
  if (span === 1) return { prng, value: minInclusive }

  // Largest multiple of span that fits in uint32; draws at or above it are rejected.
  const limit = 0x100000000 - (0x100000000 % span)
  let state = prng
  for (;;) {
    const drawn = nextUint32(state)
    state = drawn.prng
    if (drawn.value < limit) {
      return { prng: state, value: minInclusive + (drawn.value % span) }
    }
  }
}

/**
 * True with probability `numerator / 1000`. Probabilities are per-mille integers
 * throughout the simulator — there are no floats in simulation, including in
 * network parameters.
 */
export function nextChance(prng: Prng, perMille: number): { prng: Prng; value: boolean } {
  const drawn = nextInt(prng, 0, 999)
  return { prng: drawn.prng, value: drawn.value < perMille }
}

/** Uniform choice from a non-empty array. */
export function nextChoice<T>(prng: Prng, items: readonly T[]): { prng: Prng; value: T } {
  if (items.length === 0) throw new Error('nextChoice: empty array')
  const drawn = nextInt(prng, 0, items.length - 1)
  const value = items[drawn.value]
  if (value === undefined) throw new Error('nextChoice: index out of range')
  return { prng: drawn.prng, value }
}
