/**
 * Commitment and application. Figure 2, Leaders final rule and All Servers rule 1.
 */

import { enforceCurrentTermCommitRule } from './rules'
import { configurationAt, entryAt, lastLogIndex, termAt } from './log'
import { hasQuorum } from './configuration'
import type { AppliedEntry, NodeState, RaftConfig } from './types'

/**
 * Figure 2, Rules for Servers, Leaders, final rule:
 * "If there exists an N such that N > commitIndex, a majority of matchIndex[i] >= N,
 *  and log[N].term == currentTerm: set commitIndex = N (§5.3, §5.4)"
 *
 * The `log[N].term == currentTerm` clause is the current-term commit rule, and it is
 * the whole of Figure 8. Without it a leader can declare an entry from an earlier
 * term committed on the strength of a replica count, and a later leader — legitimately
 * elected, because the election restriction only compares the *last* entry — can
 * still overwrite it. §5.4.2.
 *
 * Entries from earlier terms are not abandoned: once an entry from the current term
 * commits, everything before it commits with it, which is why this scans downwards
 * from the end rather than stopping at the first N that qualifies.
 */
export function advanceCommitIndex(state: NodeState, config: RaftConfig): NodeState {
  if (state.role !== 'leader') return state

  for (let n = lastLogIndex(state.log); n > state.commitIndex; n -= 1) {
    if (enforceCurrentTermCommitRule(config.flags) && termAt(state.log, n) !== state.currentTerm) {
      continue
    }
    // §6 — the configuration that decides whether index N is committed is the one in
    // force *at N*, not the leader's latest. An entry must be agreed by the cluster
    // that existed when it was proposed; judging an old entry by a newer membership
    // would let servers that were not yet members vote on it retrospectively.
    const configuration = configurationAt(state.log, n)
    if (hasQuorum(configuration, (id) => (state.matchIndex[id] ?? 0) >= n)) {
      return { ...state, commitIndex: n }
    }
  }
  return state
}

/**
 * Figure 2, Rules for Servers, All Servers rule 1:
 * "If commitIndex > lastApplied: increment lastApplied, apply log[lastApplied] to
 *  state machine"
 *
 * The command is written at its log index rather than pushed, so that applying a
 * *different* command at an index already applied — a State Machine Safety violation —
 * shows up as a changed value instead of being hidden by an append.
 */
export function applyCommitted(state: NodeState): {
  state: NodeState
  applied: readonly AppliedEntry[]
} {
  // §7 — an entry at or below the snapshot point was applied before it could be
  // discarded, so it is applied by definition and there is nothing left to apply it
  // *from*. This floor is what stops a server from walking into its own discarded
  // range; it matters whenever `lastApplied` lags the snapshot, which a delayed
  // InstallSnapshot can produce.
  const floor = Math.max(state.lastApplied, state.log.lastIncludedIndex)
  if (state.commitIndex <= floor) {
    return floor === state.lastApplied ? { state, applied: [] } : { state: { ...state, lastApplied: floor }, applied: [] }
  }

  const stateMachine = [...state.stateMachine]
  const applied: AppliedEntry[] = []
  let lastApplied = floor

  while (lastApplied < state.commitIndex) {
    lastApplied += 1
    const entry = entryAt(state.log, lastApplied)
    if (entry === undefined) {
      // commitIndex ahead of the log means the node committed something it does not
      // hold. That is not a recoverable condition; it is a bug in the algorithm.
      throw new Error(
        `Node ${state.id}: commitIndex ${state.commitIndex} names an entry it does not hold ` +
          `(last index ${lastLogIndex(state.log)}, snapshot through ${state.log.lastIncludedIndex})`,
      )
    }
    stateMachine[lastApplied - 1] = entry.command
    applied.push({ index: lastApplied, term: entry.term, command: entry.command })
  }

  return { state: { ...state, lastApplied, stateMachine }, applied }
}
