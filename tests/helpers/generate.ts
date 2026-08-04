/**
 * Randomized scenario generation for the fuzz suite.
 *
 * Every scenario is a pure function of its seed, so a failure is reproducible from
 * one integer — and a failing seed becomes a permanent regression fixture.
 */

import { nextChoice, nextInt, prngFromSeed, type Prng } from '@/lib/sim/prng'
import { scenario, type Action, type Scenario } from '@/lib/sim/simulation'
import { UNMODIFIED_RAFT, type AblationFlags } from '@/lib/raft/rules'

export interface FuzzOptions {
  readonly flags?: AblationFlags
  readonly maxTime?: number
  readonly maxSteps?: number
  /** Force a specific cluster size instead of drawing one. */
  readonly nodeCount?: number
  /** Stop generating adversarial actions after this time, so liveness can be tested. */
  readonly quietAfter?: number
  /** Force a compaction threshold instead of drawing one. 0 disables compaction. */
  readonly snapshotThreshold?: number
}

/**
 * A hostile but bounded world: random partitions drawn and healed, crashes and
 * restarts at random moments, random client load, and a network that loses roughly
 * one message in ten.
 */
export function fuzzScenario(seed: number, options: FuzzOptions = {}): Scenario {
  let prng: Prng = prngFromSeed(seed, 0x5eed)

  const drawNodeCount = nextChoice(prng, [3, 3, 5, 5, 7] as const)
  prng = drawNodeCount.prng
  const nodeCount = options.nodeCount ?? drawNodeCount.value

  const drawDrop = nextInt(prng, 20, 180)
  prng = drawDrop.prng
  const drawDuplicate = nextInt(prng, 0, 60)
  prng = drawDuplicate.prng
  const drawLatencyMin = nextInt(prng, 5, 25)
  prng = drawLatencyMin.prng
  const drawSpread = nextInt(prng, 10, 60)
  prng = drawSpread.prng

  const maxTime = options.maxTime ?? 25_000
  const quietAfter = options.quietAfter ?? maxTime

  // §7 — compaction on most runs, and aggressively when on. A threshold of 1 or 2
  // means servers discard almost as fast as they apply, so `nextIndex` falls into the
  // discarded range constantly and InstallSnapshot becomes the common path rather than
  // a rare one. A gentle threshold would let the fuzz suite report green while barely
  // exercising §7 at all.
  const drawSnapshot = options.snapshotThreshold ?? nextInt(prng, 0, 4).value
  if (options.snapshotThreshold === undefined) prng = nextInt(prng, 0, 4).prng

  const drawActionCount = nextInt(prng, 4, 26)
  prng = drawActionCount.prng

  const actions: Action[] = []
  const down = new Array<boolean>(nodeCount).fill(false)
  let command = 0

  for (let i = 0; i < drawActionCount.value; i += 1) {
    const drawAt = nextInt(prng, 200, Math.max(400, quietAfter))
    prng = drawAt.prng
    const drawKind = nextChoice(prng, [
      'client-request',
      'client-request',
      'client-request',
      'crash',
      'restart',
      'partition',
      'heal',
    ] as const)
    prng = drawKind.prng
    const drawNode = nextInt(prng, 0, nodeCount - 1)
    prng = drawNode.prng
    const at = drawAt.value
    const node = drawNode.value

    switch (drawKind.value) {
      case 'client-request':
        command += 1
        actions.push({ at, kind: 'client-request', node, command: `v${command}` })
        break
      case 'crash':
        down[node] = true
        actions.push({ at, kind: 'crash', node })
        break
      case 'restart':
        down[node] = false
        actions.push({ at, kind: 'restart', node })
        break
      case 'partition': {
        const partitionOf: number[] = []
        for (let id = 0; id < nodeCount; id += 1) {
          const side = nextInt(prng, 0, 1)
          prng = side.prng
          partitionOf.push(side.value)
        }
        actions.push({ at, kind: 'partition', partitionOf })
        break
      }
      case 'heal':
        actions.push({ at, kind: 'heal' })
        break
    }
  }

  // Restore the cluster before the quiet period, so liveness has a chance.
  if (quietAfter < maxTime) {
    actions.push({ at: quietAfter, kind: 'heal' })
    for (let id = 0; id < nodeCount; id += 1) {
      if (down[id] === true) actions.push({ at: quietAfter, kind: 'restart', node: id })
    }
  }

  return scenario({
    seed,
    nodeCount,
    network: {
      latencyMin: drawLatencyMin.value,
      latencyMax: drawLatencyMin.value + drawSpread.value,
      dropPerMille: drawDrop.value,
      duplicatePerMille: drawDuplicate.value,
    },
    electionTimeoutMin: 150,
    electionTimeoutMax: 300,
    heartbeatInterval: 40,
    flags: options.flags ?? UNMODIFIED_RAFT,
    snapshotThreshold: drawSnapshot,
    actions,
    maxSteps: options.maxSteps ?? 6000,
    maxTime,
  })
}
