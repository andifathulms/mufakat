/**
 * The invariant checker. Evaluates Raft's five safety properties from their published
 * statements (Figure 3, §5.4.3) over a snapshot of the whole cluster, after every
 * event.
 *
 * It imports nothing from `lib/raft`. Not helpers, not constants, not types. The
 * 1-based indexing, the majority arithmetic, the notion of "up-to-date" — all of it
 * is re-derived here from the property statements. A checker that reused the
 * implementation's assumptions would agree with the implementation's bugs.
 *
 * Some properties are statements about *history*, not about a moment, so the checker
 * carries accumulated observations from step to step: which servers have been leader
 * in which terms, which entries have been reported committed, what has been applied
 * where. `check` is a fold: (state, snapshot) -> (state, violations).
 */

import {
  EMPTY_CHECKER_STATE,
  type CheckerState,
  type ClusterSnapshot,
  type NodeSnapshot,
  type SafetyProperty,
  type SnapshotEntry,
  type Violation,
} from './types'

export { EMPTY_CHECKER_STATE }

function sameEntry(a: SnapshotEntry | undefined, b: SnapshotEntry | undefined): boolean {
  if (a === undefined || b === undefined) return false
  return a.term === b.term && a.command === b.command
}

/** 1-based access, re-derived here rather than imported. */
function at(log: readonly SnapshotEntry[], index: number): SnapshotEntry | undefined {
  if (index < 1 || index > log.length) return undefined
  return log[index - 1]
}

function describe(entry: SnapshotEntry): string {
  return `(term ${entry.term}, "${entry.command}")`
}

interface Accumulator {
  state: CheckerState
  violations: Violation[]
}

// ---------------------------------------------------------------------------
// Election Safety — at most one leader can be elected in a given term.
// ---------------------------------------------------------------------------

function checkElectionSafety(acc: Accumulator, snapshot: ClusterSnapshot): void {
  // Two parts. Within this instant: two servers claiming leadership of one term.
  // Across history: a server claiming a term some *other* server already led.
  let leadersByTerm = acc.state.leadersByTerm

  for (const node of snapshot.nodes) {
    if (!node.isLeader) continue
    const existing = leadersByTerm.find((record) => record.term === node.currentTerm)
    if (existing === undefined) {
      leadersByTerm = [...leadersByTerm, { term: node.currentTerm, leader: node.id }].sort(
        (a, b) => a.term - b.term || a.leader - b.leader,
      )
      continue
    }
    if (existing.leader === node.id) continue
    acc.violations.push({
      property: 'election-safety',
      stepIndex: snapshot.stepIndex,
      time: snapshot.time,
      logIndex: null,
      nodes: [existing.leader, node.id].sort((a, b) => a - b),
      terms: [node.currentTerm],
      summary: `Two leaders in term ${node.currentTerm}: node ${existing.leader} and node ${node.id}.`,
    })
  }

  acc.state = { ...acc.state, leadersByTerm }
}

// ---------------------------------------------------------------------------
// Leader Append-Only — a leader never overwrites or deletes entries in its log.
// ---------------------------------------------------------------------------

function checkLeaderAppendOnly(acc: Accumulator, snapshot: ClusterSnapshot): void {
  const leaderLogs = [...acc.state.leaderLogs]

  for (const node of snapshot.nodes) {
    if (!node.isLeader) {
      leaderLogs[node.id] = null
      continue
    }
    const previous = leaderLogs[node.id] ?? null
    // A new term is a new leadership; only a continuous stint is constrained.
    if (previous === null || previous.term !== node.currentTerm) {
      leaderLogs[node.id] = { term: node.currentTerm, log: node.log }
      continue
    }
    if (node.log.length < previous.log.length) {
      acc.violations.push({
        property: 'leader-append-only',
        stepIndex: snapshot.stepIndex,
        time: snapshot.time,
        logIndex: node.log.length + 1,
        nodes: [node.id],
        terms: [node.currentTerm],
        summary: `Leader ${node.id} in term ${node.currentTerm} shortened its own log from ${previous.log.length} to ${node.log.length} entries.`,
      })
    }
    for (let index = 1; index <= Math.min(node.log.length, previous.log.length); index += 1) {
      const before = at(previous.log, index)
      const now = at(node.log, index)
      if (sameEntry(before, now)) continue
      acc.violations.push({
        property: 'leader-append-only',
        stepIndex: snapshot.stepIndex,
        time: snapshot.time,
        logIndex: index,
        nodes: [node.id],
        terms: [node.currentTerm],
        summary:
          `Leader ${node.id} in term ${node.currentTerm} rewrote index ${index}: ` +
          `${before === undefined ? 'nothing' : describe(before)} became ` +
          `${now === undefined ? 'nothing' : describe(now)}.`,
      })
      break
    }
    leaderLogs[node.id] = { term: node.currentTerm, log: node.log }
  }

  acc.state = { ...acc.state, leaderLogs }
}

// ---------------------------------------------------------------------------
// Log Matching — if two logs contain an entry with the same index and term, the
// logs are identical in all entries up through that index.
// ---------------------------------------------------------------------------

function checkLogMatching(acc: Accumulator, snapshot: ClusterSnapshot): void {
  const nodes = snapshot.nodes
  for (let a = 0; a < nodes.length; a += 1) {
    for (let b = a + 1; b < nodes.length; b += 1) {
      const first = nodes[a]
      const second = nodes[b]
      if (first === undefined || second === undefined) continue
      const shared = Math.min(first.log.length, second.log.length)
      let prefixIdentical = true
      for (let index = 1; index <= shared; index += 1) {
        const left = at(first.log, index)
        const right = at(second.log, index)
        if (left === undefined || right === undefined) break
        if (left.term === right.term && left.command !== right.command) {
          // Same index, same term, different entry — the corollary fails outright.
          acc.violations.push({
            property: 'log-matching',
            stepIndex: snapshot.stepIndex,
            time: snapshot.time,
            logIndex: index,
            nodes: [first.id, second.id],
            terms: [left.term],
            summary:
              `Index ${index} term ${left.term} holds different entries: node ${first.id} has ` +
              `"${left.command}", node ${second.id} has "${right.command}".`,
          })
          prefixIdentical = false
          break
        }
        if (left.term === right.term && !prefixIdentical) {
          acc.violations.push({
            property: 'log-matching',
            stepIndex: snapshot.stepIndex,
            time: snapshot.time,
            logIndex: index,
            nodes: [first.id, second.id],
            terms: [left.term],
            summary:
              `Nodes ${first.id} and ${second.id} agree at index ${index} term ${left.term}, ` +
              `but their logs differ earlier.`,
          })
          break
        }
        if (!sameEntry(left, right)) prefixIdentical = false
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Leader Completeness — an entry committed in a term is present in the log of every
// leader of every later term.
// ---------------------------------------------------------------------------

function checkLeaderCompleteness(acc: Accumulator, snapshot: ClusterSnapshot): void {
  const committed = [...acc.state.committed]

  // Record what each server currently claims is committed. The claim is the
  // implementation's; holding it to the property is the checker's job.
  for (const node of snapshot.nodes) {
    for (let index = 1; index <= node.commitIndex; index += 1) {
      const entry = at(node.log, index)
      if (entry === undefined) continue
      const known = committed[index - 1]
      if (known === undefined) {
        committed[index - 1] = {
          entry,
          committedInTerm: node.currentTerm,
          byNode: node.id,
        }
        continue
      }
      if (sameEntry(known.entry, entry)) continue
      acc.violations.push({
        property: 'leader-completeness',
        stepIndex: snapshot.stepIndex,
        time: snapshot.time,
        logIndex: index,
        nodes: [known.byNode, node.id].sort((x, y) => x - y),
        terms: [known.entry.term, entry.term],
        summary:
          `Index ${index} was committed as ${describe(known.entry)} by node ${known.byNode}, ` +
          `but node ${node.id} has committed ${describe(entry)} there.`,
      })
    }
  }

  // The property proper: a later leader must hold every earlier committed entry.
  for (const node of snapshot.nodes) {
    if (!node.isLeader) continue
    for (let index = 1; index <= committed.length; index += 1) {
      const record = committed[index - 1]
      if (record === undefined) continue
      if (node.currentTerm <= record.committedInTerm) continue
      const held = at(node.log, index)
      if (sameEntry(held, record.entry)) continue
      acc.violations.push({
        property: 'leader-completeness',
        stepIndex: snapshot.stepIndex,
        time: snapshot.time,
        logIndex: index,
        nodes: [node.id],
        terms: [record.committedInTerm, node.currentTerm],
        summary:
          `${describe(record.entry)} was committed at index ${index} in term ` +
          `${record.committedInTerm}, but leader ${node.id} of the later term ` +
          `${node.currentTerm} has ${held === undefined ? 'no entry' : describe(held)} there.`,
      })
      break
    }
  }

  acc.state = { ...acc.state, committed }
}

// ---------------------------------------------------------------------------
// State Machine Safety — if a server has applied an entry at an index, no other
// server ever applies a different entry at that index.
// ---------------------------------------------------------------------------

function checkStateMachineSafety(acc: Accumulator, snapshot: ClusterSnapshot): void {
  const appliedAt = [...acc.state.appliedAt]

  for (const node of snapshot.nodes) {
    for (let index = 1; index <= node.lastApplied; index += 1) {
      const command = node.applied[index - 1]
      if (command === undefined) continue
      const known = appliedAt[index - 1]
      if (known === undefined) {
        appliedAt[index - 1] = { command, byNode: node.id }
        continue
      }
      if (known.command === command) continue
      acc.violations.push({
        property: 'state-machine-safety',
        stepIndex: snapshot.stepIndex,
        time: snapshot.time,
        logIndex: index,
        nodes: [known.byNode, node.id].sort((x, y) => x - y),
        terms: [],
        summary:
          `Node ${known.byNode} applied "${known.command}" at index ${index}; ` +
          `node ${node.id} applied "${command}" at the same index.`,
      })
      // Keep the first observation, so the report stays anchored to what happened
      // first rather than drifting with each new disagreement.
    }
  }

  acc.state = { ...acc.state, appliedAt }
}

// ---------------------------------------------------------------------------

/**
 * Evaluate all five properties against a snapshot. Returns the advanced checker state
 * and any violations *newly observed at this step*.
 */
export function check(
  state: CheckerState,
  snapshot: ClusterSnapshot,
): { state: CheckerState; violations: readonly Violation[] } {
  const acc: Accumulator = { state, violations: [] }

  checkElectionSafety(acc, snapshot)
  checkLeaderAppendOnly(acc, snapshot)
  checkLogMatching(acc, snapshot)
  checkLeaderCompleteness(acc, snapshot)
  checkStateMachineSafety(acc, snapshot)

  if (acc.violations.length > 0) {
    const broken = [...acc.state.broken]
    for (const violation of acc.violations) {
      if (!broken.includes(violation.property)) broken.push(violation.property)
    }
    acc.state = { ...acc.state, broken }
  }

  return { state: acc.state, violations: acc.violations }
}

/** Whether each property is currently holding. For the five-indicator panel. */
export function propertyStatus(state: CheckerState): Readonly<Record<SafetyProperty, boolean>> {
  return {
    'election-safety': !state.broken.includes('election-safety'),
    'leader-append-only': !state.broken.includes('leader-append-only'),
    'log-matching': !state.broken.includes('log-matching'),
    'leader-completeness': !state.broken.includes('leader-completeness'),
    'state-machine-safety': !state.broken.includes('state-machine-safety'),
  }
}
