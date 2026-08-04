/**
 * Network model. Pure: given a PRNG state it decides what happens to a message and
 * returns the advanced PRNG state alongside the outcome.
 *
 * Message loss is the default, not an option — Raft is designed for a lossy network,
 * and a simulator that defaults to a perfect one teaches the wrong intuition.
 *
 * Reordering is not a separate switch. It emerges from latency variance: two
 * messages sent along the same link a tick apart can arrive in either order if the
 * latency range is wider than the gap. That is how reordering happens in reality.
 */

import { nextChance, nextInt, type Prng } from './prng'

/** All probabilities are per-mille integers. No floats in simulation. */
export interface NetworkConfig {
  /** Inclusive minimum one-way latency, in virtual ticks. */
  readonly latencyMin: number
  /** Inclusive maximum one-way latency, in virtual ticks. */
  readonly latencyMax: number
  /** Probability per-mille that a message is dropped outright. */
  readonly dropPerMille: number
  /** Probability per-mille that a delivered message is also duplicated. */
  readonly duplicatePerMille: number
}

/**
 * A lossy default. Raft under a perfect network is not Raft as it was designed.
 */
export const DEFAULT_NETWORK: NetworkConfig = {
  latencyMin: 10,
  latencyMax: 45,
  dropPerMille: 40,
  duplicatePerMille: 15,
}

/**
 * Partition membership, indexed by node id: two nodes can exchange messages only if
 * they carry the same partition id. A single-partition cluster is fully connected.
 */
export interface NetworkState {
  readonly partitionOf: readonly number[]
}

export function fullyConnected(nodeCount: number): NetworkState {
  return { partitionOf: new Array<number>(nodeCount).fill(0) }
}

/** Assign one node to a partition group, leaving the rest alone. */
export function assignPartition(state: NetworkState, node: number, partition: number): NetworkState {
  const partitionOf = [...state.partitionOf]
  partitionOf[node] = partition
  return { partitionOf }
}

/** Heal every partition. */
export function healPartitions(state: NetworkState): NetworkState {
  return fullyConnected(state.partitionOf.length)
}

export function canReach(state: NetworkState, from: number, to: number): boolean {
  return state.partitionOf[from] === state.partitionOf[to]
}

/** What the wire does to a message. A lost message still spent time in transit. */
export type Delivery =
  | { readonly kind: 'dropped'; readonly delay: number }
  /** One or two copies; `delays` is in the order the copies were drawn, not arrival order. */
  | { readonly kind: 'delivered'; readonly delays: readonly number[] }

/**
 * Decide the fate of one message. Draws are made in a fixed order — latency, drop,
 * duplication — so the stream stays aligned across runs.
 *
 * Partitions are deliberately *not* consulted here. Reachability is checked at
 * delivery time instead, which models a partition as a severed link that swallows
 * whatever was already on it, and — more importantly — keeps the random stream
 * independent of the topology. Drawing or healing a partition mid-run therefore does
 * not shift the latency of every other message in the simulation, which it would if
 * the topology decided how many numbers were consumed.
 */
export function route(
  prng: Prng,
  config: NetworkConfig,
): { prng: Prng; delivery: Delivery } {
  const latency = nextInt(prng, config.latencyMin, config.latencyMax)
  const dropped = nextChance(latency.prng, config.dropPerMille)
  if (dropped.value) {
    return { prng: dropped.prng, delivery: { kind: 'dropped', delay: latency.value } }
  }

  const duplicated = nextChance(dropped.prng, config.duplicatePerMille)
  if (!duplicated.value) {
    return { prng: duplicated.prng, delivery: { kind: 'delivered', delays: [latency.value] } }
  }

  // A duplicate is an independent copy with its own latency, so it can arrive before
  // or after the original.
  const echo = nextInt(duplicated.prng, config.latencyMin, config.latencyMax)
  return {
    prng: echo.prng,
    delivery: { kind: 'delivered', delays: [latency.value, echo.value] },
  }
}

/** A network that never drops or duplicates. For conformance fixtures, not for play. */
export const RELIABLE_NETWORK: NetworkConfig = {
  latencyMin: 10,
  latencyMax: 20,
  dropPerMille: 0,
  duplicatePerMille: 0,
}
