/**
 * The invariant checker. Evaluates Raft's five safety properties from their published
 * statements (Figure 3, §5.4.3) over a snapshot of the whole cluster, after every
 * event.
 *
 * It imports nothing from `lib/raft`. Not helpers, not constants, not types. The
 * indexing, the majority arithmetic, the notion of "up-to-date" — all of it is
 * re-derived here from the property statements. A checker that reused the
 * implementation's assumptions would agree with the implementation's bugs.
 *
 * Some properties are statements about *history*, not about a moment, so the checker
 * carries accumulated observations from step to step: which servers have been leader
 * in which terms, which entries have been reported committed, what has been applied
 * where. `check` is a fold: (state, snapshot) -> (state, violations).
 *
 * **Log compaction (§7) makes this harder, and deliberately does not make it weaker.**
 * Once a server snapshots, it no longer holds the entries below its snapshot point, so
 * a naive checker would lose sight of exactly the entries that are committed — the
 * ones the properties care about most. Two things keep the checks at full strength:
 * a server's *applied* commands are retained by index in this model and never
 * discarded, so a prefix can still be compared below a snapshot point; and the checker
 * has its own memory of everything it has ever seen committed, which lets it hold a
 * server's snapshot point to the entry that was actually there.
 */

import {
  EMPTY_CHECKER_STATE,
  type CheckerState,
  type ClusterSnapshot,
  type KnownEntry,
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

/**
 * Absolute-index access into a server's held entries. A server that has compacted no
 * longer starts at index 1, so the offset is `logStartIndex` — worked out from the
 * snapshot rather than trusting the implementation's own arithmetic.
 */
function heldAt(node: NodeSnapshot, index: number): SnapshotEntry | undefined {
  const offset = index - node.logStartIndex
  if (offset < 0 || offset >= node.log.length) return undefined
  return node.log[offset]
}

/** Highest index this server holds an entry for; below `logStartIndex` when empty. */
function lastHeldIndex(node: NodeSnapshot): number {
  return node.logStartIndex + node.log.length - 1
}

/**
 * Everything the checker can establish about one index on one server.
 *
 * Below a snapshot point the term is genuinely gone, but the *command* is not: the
 * server applied it before it was allowed to discard it. That asymmetry is what lets
 * prefix comparison survive compaction.
 */
function known(node: NodeSnapshot, index: number): KnownEntry {
  const held = heldAt(node, index)
  if (held !== undefined) return { term: held.term, command: held.command }
  const term = index === node.lastIncludedIndex ? node.lastIncludedTerm : undefined
  const command = index <= node.lastIncludedIndex ? node.applied[index - 1] : undefined
  return { term, command }
}

/** True when both servers know the command at `index` and the two differ. */
function commandsDiffer(a: NodeSnapshot, b: NodeSnapshot, index: number): boolean {
  const left = known(a, index).command
  const right = known(b, index).command
  if (left === undefined || right === undefined) return false
  return left !== right
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
    const record = (): void => {
      leaderLogs[node.id] = {
        term: node.currentTerm,
        log: node.log,
        logStartIndex: node.logStartIndex,
        lastIndex: lastHeldIndex(node),
      }
    }

    const previous = leaderLogs[node.id] ?? null
    // A new term is a new leadership; only a continuous stint is constrained.
    if (previous === null || previous.term !== node.currentTerm) {
      record()
      continue
    }

    // Compaction discards entries from the *bottom*, and only entries the server has
    // already applied. That is not overwriting or deleting in the sense of the
    // property, so the comparison is anchored on the last index, not on how many
    // entries are held — which compaction legitimately reduces.
    if (lastHeldIndex(node) < previous.lastIndex) {
      acc.violations.push({
        property: 'leader-append-only',
        stepIndex: snapshot.stepIndex,
        time: snapshot.time,
        logIndex: lastHeldIndex(node) + 1,
        nodes: [node.id],
        terms: [node.currentTerm],
        summary:
          `Leader ${node.id} in term ${node.currentTerm} lost the tail of its own log: ` +
          `last index went from ${previous.lastIndex} to ${lastHeldIndex(node)}.`,
      })
    }

    // Compare over the overlap of what was held then and what is held now.
    const from = Math.max(previous.logStartIndex, node.logStartIndex)
    const to = Math.min(previous.lastIndex, lastHeldIndex(node))
    for (let index = from; index <= to; index += 1) {
      const before = previous.log[index - previous.logStartIndex]
      const now = heldAt(node, index)
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
    record()
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

      // Absolute index range where both servers can state a term. Below it neither
      // holds entries, but their applied commands still allow a prefix comparison.
      const from = Math.max(first.logStartIndex, second.logStartIndex)
      const to = Math.min(lastHeldIndex(first), lastHeldIndex(second))

      // Seed the prefix comparison from everything below the shared range, using the
      // commands each server applied. Compaction therefore costs the check nothing.
      let prefixIdentical = true
      for (let index = 1; index < from; index += 1) {
        if (commandsDiffer(first, second, index)) {
          prefixIdentical = false
          break
        }
      }

      for (let index = from; index <= to; index += 1) {
        const left = heldAt(first, index)
        const right = heldAt(second, index)
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
// Snapshot consistency (§7). Not one of the five, but the five cannot be trusted
// without it: a server that snapshots the wrong entry quietly launders a divergent
// log into an unfalsifiable one.
// ---------------------------------------------------------------------------

function checkSnapshotConsistency(acc: Accumulator, snapshot: ClusterSnapshot): void {
  for (const node of snapshot.nodes) {
    if (node.lastIncludedIndex === 0) continue
    const record = acc.state.committed[node.lastIncludedIndex - 1]
    if (record === undefined) continue

    // A snapshot may only cover entries the server had applied, so the checker must
    // already have seen this index committed — and with this term.
    if (record.entry.term === node.lastIncludedTerm) continue
    acc.violations.push({
      property: 'log-matching',
      stepIndex: snapshot.stepIndex,
      time: snapshot.time,
      logIndex: node.lastIncludedIndex,
      nodes: [node.id],
      terms: [record.entry.term, node.lastIncludedTerm],
      summary:
        `Node ${node.id} snapshotted index ${node.lastIncludedIndex} as term ` +
        `${node.lastIncludedTerm}, but ${describe(record.entry)} was committed there.`,
    })
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
      const entry = heldAt(node, index)
      // Entries below the snapshot point were recorded when they were still held.
      if (entry === undefined) continue
      const record = committed[index - 1]
      if (record === undefined) {
        committed[index - 1] = { entry, committedInTerm: node.currentTerm, byNode: node.id }
        continue
      }
      if (sameEntry(record.entry, entry)) continue
      acc.violations.push({
        property: 'leader-completeness',
        stepIndex: snapshot.stepIndex,
        time: snapshot.time,
        logIndex: index,
        nodes: [record.byNode, node.id].sort((x, y) => x - y),
        terms: [record.entry.term, entry.term],
        summary:
          `Index ${index} was committed as ${describe(record.entry)} by node ${record.byNode}, ` +
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

      const held = heldAt(node, index)
      if (sameEntry(held, record.entry)) continue
      // A leader that has snapshotted past this index still *has* the entry — it is
      // folded into its state machine. Compaction must not read as loss.
      if (index <= node.lastIncludedIndex && known(node, index).command === record.entry.command) {
        continue
      }
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
      const record = appliedAt[index - 1]
      if (record === undefined) {
        appliedAt[index - 1] = { command, byNode: node.id }
        continue
      }
      if (record.command === command) continue
      acc.violations.push({
        property: 'state-machine-safety',
        stepIndex: snapshot.stepIndex,
        time: snapshot.time,
        logIndex: index,
        nodes: [record.byNode, node.id].sort((x, y) => x - y),
        terms: [],
        summary:
          `Node ${record.byNode} applied "${record.command}" at index ${index}; ` +
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
  // Runs before Leader Completeness records this step's commits, so a snapshot is
  // judged against what was already known to be committed rather than against itself.
  checkSnapshotConsistency(acc, snapshot)
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
