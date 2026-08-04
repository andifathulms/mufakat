import { describe, expect, it } from 'vitest'
import { UNMODIFIED_RAFT, type AblationFlagName } from '@/lib/raft/rules'
import { run } from '@/lib/sim/simulation'
import { fuzzScenario } from '../helpers/generate'

/**
 * Pinned fuzz seeds.
 *
 * **A failing fuzz seed becomes a permanent regression test.** When `pnpm test:fuzz`
 * fails, the seed is committed here *before* anything is fixed — otherwise the fix is
 * unverifiable and the failure can silently return when the generator changes. Add it
 * to `REGRESSIONS` with a note saying what was wrong.
 *
 * And when a fuzz run fails, the algorithm is wrong. Not the checker, not the fuzzer,
 * not the seed. Investigate in that order and only in that order, and never relax an
 * invariant to make a run pass.
 */

interface Regression {
  readonly seed: number
  /** What was broken when this seed first failed. */
  readonly note: string
}

const REGRESSIONS: readonly Regression[] = [
  // No fuzz failure has occurred yet: the algorithm has been green from the first
  // full run. This list is deliberately empty rather than absent, so the next
  // failure has an obvious home and the rule has somewhere to be obeyed.
]

describe('pinned regression seeds', () => {
  it.skipIf(REGRESSIONS.length === 0)('holds all five properties on every pinned seed', () => {
    for (const regression of REGRESSIONS) {
      const trace = run(fuzzScenario(regression.seed))
      expect(trace.violations, `seed ${regression.seed}: ${regression.note}`).toEqual([])
    }
  })
})

/**
 * Seeds the ablation work depends on. These are not regressions — they are the
 * opposite: runs that *must* keep breaking, because they are the evidence that a
 * toggle is real. If a change to the generator or the scheduler stops them breaking,
 * the ablation tests would quietly start passing for the wrong reason.
 */
const ABLATION_WITNESSES: readonly {
  readonly seed: number
  readonly flag: AblationFlagName
  readonly property: string
}[] = [
  { seed: 9, flag: 'electionRestriction', property: 'leader-completeness' },
  { seed: 22, flag: 'appendEntriesConsistencyCheck', property: 'log-matching' },
  { seed: 795, flag: 'termIncrementOnCandidacy', property: 'election-safety' },
  { seed: 2, flag: 'stepDownOnHigherTerm', property: 'election-safety' },
  { seed: 6026, flag: 'currentTermCommitRule', property: 'state-machine-safety' },
]

/**
 * These seeds were found before §7 existed, when the generator did not draw a
 * compaction threshold. Pinning the threshold keeps them describing the scenarios they
 * were chosen for — and, because the generator only advances the random stream when it
 * has to draw, pinning it also restores the exact stream those seeds were found under.
 *
 * This is not papering over the guard. The guard fired correctly when the generator
 * changed; what it was telling us is that these witnesses are about ablation, not about
 * compaction, and they should say which world they live in.
 */
const WITNESS_OPTIONS = { snapshotThreshold: 0 } as const

describe('ablation witness seeds', () => {
  for (const witness of ABLATION_WITNESSES) {
    it(`seed ${witness.seed} breaks ${witness.property} with ${witness.flag} off`, () => {
      const broken = run(
        fuzzScenario(witness.seed, {
          ...WITNESS_OPTIONS,
          flags: { ...UNMODIFIED_RAFT, [witness.flag]: false },
        }),
      )
      expect(broken.violations.some((v) => v.property === witness.property)).toBe(true)
    })

    it(`seed ${witness.seed} breaks nothing with ${witness.flag} on`, () => {
      expect(run(fuzzScenario(witness.seed, WITNESS_OPTIONS)).violations).toEqual([])
    })
  }
})
