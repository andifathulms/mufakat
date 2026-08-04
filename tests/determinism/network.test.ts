import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NETWORK,
  RELIABLE_NETWORK,
  assignPartition,
  canReach,
  fullyConnected,
  healPartitions,
  route,
  type Delivery,
} from '@/lib/sim/network'
import { prngFromSeed } from '@/lib/sim/prng'

function routeMany(seed: number, count: number): Delivery[] {
  const state = fullyConnected(5)
  let prng = prngFromSeed(seed)
  const out: Delivery[] = []
  for (let i = 0; i < count; i += 1) {
    const routed = route(prng, DEFAULT_NETWORK, state, i % 5, (i + 1) % 5)
    prng = routed.prng
    out.push(routed.delivery)
  }
  return out
}

describe('network', () => {
  it('routes identically for the same seed', () => {
    expect(routeMany(77, 500)).toEqual(routeMany(77, 500))
  })

  it('drops messages by default — a lossy network is the default, not an option', () => {
    expect(DEFAULT_NETWORK.dropPerMille).toBeGreaterThan(0)
    const dropped = routeMany(3, 4000).filter((d) => d.kind === 'dropped').length
    expect(dropped / 4000).toBeGreaterThan(0.03)
    expect(dropped / 4000).toBeLessThan(0.05)
  })

  it('duplicates some messages, each copy with its own latency', () => {
    const duplicates = routeMany(9, 4000).filter(
      (d) => d.kind === 'delivered' && d.delays.length === 2,
    )
    expect(duplicates.length).toBeGreaterThan(0)
    // Independent latencies mean a duplicate can overtake the original.
    const overtaking = duplicates.filter(
      (d) => d.kind === 'delivered' && (d.delays[1] ?? 0) < (d.delays[0] ?? 0),
    )
    expect(overtaking.length).toBeGreaterThan(0)
  })

  it('produces integer latencies inside the configured range', () => {
    for (const delivery of routeMany(11, 2000)) {
      if (delivery.kind !== 'delivered') continue
      for (const delay of delivery.delays) {
        expect(Number.isInteger(delay)).toBe(true)
        expect(delay).toBeGreaterThanOrEqual(DEFAULT_NETWORK.latencyMin)
        expect(delay).toBeLessThanOrEqual(DEFAULT_NETWORK.latencyMax)
      }
    }
  })

  it('allows reordering on a link when latency varies more than the send gap', () => {
    // Two sends a tick apart can still arrive out of order.
    const state = fullyConnected(3)
    let prng = prngFromSeed(4242)
    let reorders = 0
    for (let i = 0; i < 2000; i += 1) {
      const first = route(prng, DEFAULT_NETWORK, state, 0, 1)
      const second = route(first.prng, DEFAULT_NETWORK, state, 0, 1)
      prng = second.prng
      if (first.delivery.kind !== 'delivered' || second.delivery.kind !== 'delivered') continue
      const firstArrival = 0 + (first.delivery.delays[0] ?? 0)
      const secondArrival = 1 + (second.delivery.delays[0] ?? 0)
      if (secondArrival < firstArrival) reorders += 1
    }
    expect(reorders).toBeGreaterThan(0)
  })

  it('blocks messages across a partition without consuming randomness', () => {
    const split = assignPartition(fullyConnected(5), 4, 1)
    expect(canReach(split, 0, 1)).toBe(true)
    expect(canReach(split, 0, 4)).toBe(false)
    const prng = prngFromSeed(1)
    const routed = route(prng, DEFAULT_NETWORK, split, 0, 4)
    expect(routed.delivery.kind).toBe('partitioned')
    // A partition is topology, not a dice roll: the stream must not advance.
    expect(routed.prng).toBe(prng)
  })

  it('heals partitions back to full connectivity', () => {
    let state = fullyConnected(5)
    state = assignPartition(state, 0, 1)
    state = assignPartition(state, 1, 1)
    expect(canReach(state, 0, 2)).toBe(false)
    state = healPartitions(state)
    expect(canReach(state, 0, 2)).toBe(true)
    expect(state.partitionOf).toHaveLength(5)
  })

  it('never drops on the reliable network used by conformance fixtures', () => {
    const state = fullyConnected(3)
    let prng = prngFromSeed(8)
    for (let i = 0; i < 1000; i += 1) {
      const routed = route(prng, RELIABLE_NETWORK, state, 0, 1)
      prng = routed.prng
      expect(routed.delivery.kind).toBe('delivered')
      if (routed.delivery.kind === 'delivered') expect(routed.delivery.delays).toHaveLength(1)
    }
  })
})
