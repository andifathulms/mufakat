import { describe, expect, it } from 'vitest'
import { configurationOf, heldEntries, lastLogIndex } from '@/lib/raft/log'
import { sameConfiguration } from '@/lib/raft/configuration'
import { run } from '@/lib/sim/simulation'
import { fuzzScenario } from '../helpers/generate'

/**
 * The backbone of the correctness argument, and the gate on deployment.
 *
 * Thousands of randomized scenarios — random partitions drawn and healed, drops,
 * duplication, reordering, crashes and restarts at random moments, random client
 * load — with all five safety properties asserted at every event of every run,
 * under unmodified Raft.
 *
 * When one of these fails, the algorithm is wrong. Not the checker, not the fuzzer,
 * not the seed. Investigate in that order and only in that order, and never relax an
 * invariant to make a run pass. A failing seed is committed as a fixture *before*
 * anything is fixed — see `tests/fuzz/regressions.test.ts`.
 */

const RUNS = Number(process.env.FUZZ_RUNS ?? 2000)

describe('invariant fuzzing — unmodified Raft', () => {
  it(`holds all five safety properties across ${RUNS} randomized runs`, () => {
    const failures: string[] = []
    for (let seed = 1; seed <= RUNS; seed += 1) {
      const trace = run(fuzzScenario(seed))
      if (trace.violations.length === 0) continue
      const first = trace.violations[0]
      failures.push(
        `seed ${seed}: ${first?.property} at step ${first?.stepIndex} — ${first?.summary}`,
      )
      if (failures.length >= 5) break
    }
    expect(failures).toEqual([])
  })

  it('actually exercises the interesting states, rather than idling', () => {
    // A fuzz suite that never elects anyone would pass vacuously. Prove it does not.
    let elections = 0
    let commits = 0
    let divergences = 0
    for (let seed = 1; seed <= 200; seed += 1) {
      const trace = run(fuzzScenario(seed))
      const last = trace.steps[trace.steps.length - 1]
      if (last === undefined) continue
      if (last.nodes.some((node) => node.currentTerm > 0)) elections += 1
      if (last.nodes.some((node) => node.commitIndex > 0)) commits += 1
      // Logs that disagree at some index at some point: repair had work to do.
      const diverged = trace.steps.some((step) => {
        const lengths = step.nodes.map((node) => lastLogIndex(node.log))
        return Math.max(...lengths) !== Math.min(...lengths)
      })
      if (diverged) divergences += 1
    }
    expect(elections).toBeGreaterThan(190)
    expect(commits).toBeGreaterThan(150)
    expect(divergences).toBeGreaterThan(150)
  })

  it('exercises §7 rather than reporting green with compaction switched off', () => {
    // A compaction bug that only appears once servers actually discard entries would
    // hide behind a suite where they never do. Assert the paths are taken: servers
    // compact, snapshots are transferred, and *both* Figure 13 receiver rules fire —
    // rule 6 retaining a suffix, rule 7 discarding the log outright.
    let compacted = 0
    let installsDelivered = 0
    let retainedSuffix = 0
    let discardedLog = 0

    for (let seed = 1; seed <= 300; seed += 1) {
      const trace = run(fuzzScenario(seed))
      const last = trace.steps[trace.steps.length - 1]
      if (last === undefined) continue
      if (last.nodes.some((node) => node.log.lastIncludedIndex > 0)) compacted += 1
      for (const step of trace.steps) {
        if (step.event.kind === 'deliver' && step.event.message.type === 'InstallSnapshot') {
          installsDelivered += 1
        }
      }
      for (const node of last.nodes) {
        if (node.log.lastIncludedIndex === 0) continue
        if (heldEntries(node.log).length > 0) retainedSuffix += 1
        else discardedLog += 1
      }
    }

    expect(compacted).toBeGreaterThan(100)
    expect(installsDelivered).toBeGreaterThan(100)
    expect(retainedSuffix).toBeGreaterThan(50)
    expect(discardedLog).toBeGreaterThan(50)
  })

  it('exercises §6 rather than reporting green with the membership unchanged', () => {
    // The same argument as for §7: a joint-consensus bug that only shows once clusters
    // actually change membership would hide behind a suite where they never do.
    let requested = 0
    let joint = 0
    let completed = 0

    for (let seed = 1; seed <= 400; seed += 1) {
      const spec = fuzzScenario(seed)
      if (!spec.actions.some((action) => action.kind === 'change-configuration')) continue
      requested += 1
      const trace = run(spec)
      // A transitional configuration was genuinely in force at some point...
      if (
        trace.steps.some((step) =>
          step.nodes.some((node) => configurationOf(node.log).type === 'joint'),
        )
      ) {
        joint += 1
      }
      // ...and on at least some runs the change ran all the way to C-new.
      const last = trace.steps[trace.steps.length - 1]
      if (last === undefined) continue
      const started = configurationOf(trace.steps[0]?.nodes[0]?.log ?? last.nodes[0]!.log)
      if (last.nodes.some((node) => !sameConfiguration(configurationOf(node.log), started))) {
        completed += 1
      }
    }

    expect(requested).toBeGreaterThan(50)
    expect(joint).toBeGreaterThan(30)
    expect(completed).toBeGreaterThan(30)
  })
})

describe('liveness under an eventually-reliable network', () => {
  it('elects a leader and commits submitted entries once the network settles', () => {
    // Given a network that eventually stops dropping and a cluster that eventually
    // stops crashing, progress must resume. Asserted with a generous event bound.
    const failures: string[] = []
    for (let seed = 1; seed <= 120; seed += 1) {
      const base = fuzzScenario(seed, { nodeCount: 5, maxTime: 12_000, quietAfter: 6000 })
      const spec = {
        ...base,
        // Eventually reliable: no drops, no duplication, in the quiet period onwards.
        network: { ...base.network, dropPerMille: 0, duplicatePerMille: 0 },
        actions: [
          ...base.actions,
          { at: 8000, kind: 'client-request' as const, node: 0, command: 'liveness' },
          { at: 9000, kind: 'client-request' as const, node: 1, command: 'liveness' },
          { at: 10_000, kind: 'client-request' as const, node: 2, command: 'liveness' },
        ],
        maxSteps: 20_000,
      }
      const trace = run(spec)
      const last = trace.steps[trace.steps.length - 1]
      if (last === undefined) {
        failures.push(`seed ${seed}: empty trace`)
        continue
      }
      const leaders = last.nodes.filter((node) => node.role === 'leader')
      if (leaders.length === 0) {
        failures.push(`seed ${seed}: no leader after the network settled`)
        continue
      }
      const committed = last.nodes.some((node) =>
        node.stateMachine.slice(0, node.lastApplied).includes('liveness'),
      )
      if (!committed) failures.push(`seed ${seed}: no submitted entry ever committed`)
    }
    expect(failures).toEqual([])
  })
})
