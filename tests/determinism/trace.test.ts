import { describe, expect, it } from 'vitest'
import { heldEntries } from '@/lib/raft/log'
import { logOfNode } from '../helpers/nodes'
import { run, scenario } from '@/lib/sim/simulation'
import { traceDigest } from '@/lib/sim/trace'
import { fuzzScenario } from '../helpers/generate'

/**
 * The whole simulation is a pure function of `(config, seed, actions, flags)`.
 * Byte-identical trace on any machine. Time travel, sharing, fuzzing and
 * reproducible bug reports all rest on this.
 */

describe('trace determinism', () => {
  it('produces a byte-identical trace for the same inputs', () => {
    const spec = scenario({
      seed: 4242,
      actions: [
        { at: 800, kind: 'client-request', node: 0, command: 'a' },
        { at: 1200, kind: 'partition', partitionOf: [0, 0, 1, 1, 1] },
        { at: 2400, kind: 'crash', node: 2 },
        { at: 3000, kind: 'heal' },
        { at: 3200, kind: 'restart', node: 2 },
        { at: 4000, kind: 'client-request', node: 1, command: 'b' },
      ],
      maxTime: 8000,
    })
    const first = traceDigest(run(spec))
    const second = traceDigest(run(spec))
    expect(first).toEqual(second)
    expect(first.length).toBeGreaterThan(10_000)
  })

  it('diverges for a different seed', () => {
    expect(traceDigest(run(scenario({ seed: 1, maxTime: 3000 })))).not.toEqual(
      traceDigest(run(scenario({ seed: 2, maxTime: 3000 }))),
    )
  })

  it('treats ablation flags as genuine inputs to the run', () => {
    // Not every seed exercises every rule — a run in which no vote is ever refused on
    // up-to-dateness grounds is identical with the restriction on or off, and that is
    // correct. The claim here is only that the flags reach the algorithm at all.
    let diverged = 0
    for (let seed = 1; seed <= 60; seed += 1) {
      const base = fuzzScenario(seed, { maxTime: 8000 })
      const modified = { ...base, flags: { ...base.flags, electionRestriction: false } }
      if (traceDigest(run(base)) !== traceDigest(run(modified))) diverged += 1
    }
    expect(diverged).toBeGreaterThan(0)
  })

  it('replays identically across 200 randomized scenarios', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const spec = fuzzScenario(seed, { maxTime: 6000 })
      expect(traceDigest(run(spec))).toEqual(traceDigest(run(spec)))
    }
  })

  it('is unaffected by the order actions are written in, only by their timestamps', () => {
    const actions = [
      { at: 1000, kind: 'client-request' as const, node: 0, command: 'a' },
      { at: 2000, kind: 'crash' as const, node: 3 },
      { at: 3000, kind: 'restart' as const, node: 3 },
    ]
    const forwards = run(scenario({ seed: 9, actions, maxTime: 6000 }))
    const backwards = run(scenario({ seed: 9, actions: [...actions].reverse(), maxTime: 6000 }))
    expect(traceDigest(forwards)).toEqual(traceDigest(backwards))
  })

  it('advances virtual time monotonically and only in integers', () => {
    const trace = run(fuzzScenario(31))
    let previous = -1
    for (const step of trace.steps) {
      expect(Number.isInteger(step.time)).toBe(true)
      expect(step.time).toBeGreaterThanOrEqual(previous)
      previous = step.time
    }
  })

  it('keeps every term, index and timestamp an integer', () => {
    const trace = run(fuzzScenario(77))
    for (const step of trace.steps) {
      for (const node of step.nodes) {
        expect(Number.isInteger(node.currentTerm)).toBe(true)
        expect(Number.isInteger(node.commitIndex)).toBe(true)
        expect(Number.isInteger(node.lastApplied)).toBe(true)
        for (const entry of heldEntries(node.log)) expect(Number.isInteger(entry.term)).toBe(true)
      }
    }
  })

  it('shares node objects between steps, so stepping backwards costs nothing', () => {
    const trace = run(scenario({ seed: 5, maxTime: 3000 }))
    let shared = 0
    let compared = 0
    for (let i = 1; i < trace.steps.length; i += 1) {
      const previous = trace.steps[i - 1]
      const current = trace.steps[i]
      if (previous === undefined || current === undefined) continue
      current.nodes.forEach((node, id) => {
        compared += 1
        if (node === previous.nodes[id]) shared += 1
      })
    }
    // One event touches at most one node, so the ceiling is (n - 1) / n — 0.8 for a
    // five-node cluster — and steps that change nothing at all push it a little above.
    expect(shared / compared).toBeGreaterThan(0.79)
  })
})
