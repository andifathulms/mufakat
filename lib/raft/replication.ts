/**
 * Log replication. Figure 2, AppendEntries RPC and the Leaders rules.
 *
 * Pure: no clock, no randomness beyond the PRNG threaded through `NodeState`.
 */

import { enforceAppendEntriesConsistencyCheck } from './rules'
import { resetElectionTimer, resetHeartbeatTimer, stopElectionTimer } from './timers'
import { advanceCommitIndex } from './commit'
import {
  append,
  entryAt,
  hasIndex,
  lastLogIndex,
  replaceFrom,
  sliceFrom,
  termAt,
} from './log'
import type {
  AppendEntriesRequest,
  AppendEntriesResponse,
  Message,
  NodeId,
  NodeState,
  RaftConfig,
  TimerRequest,
} from './types'

export interface Transition {
  readonly state: NodeState
  readonly outbox: readonly Message[]
  readonly timers: readonly TimerRequest[]
}

/** Every node id except `self`, in ascending order — never an unordered collection. */
export function peersOf(self: NodeId, nodeCount: number): readonly NodeId[] {
  const peers: NodeId[] = []
  for (let id = 0; id < nodeCount; id += 1) if (id !== self) peers.push(id)
  return peers
}

/**
 * Figure 2, Rules for Servers, Candidates rule 2 — "If votes received from majority
 * of servers: become leader", and Leaders rule 1: "Upon election: send initial empty
 * AppendEntries (heartbeat) to each server".
 *
 * Volatile leader state is reinitialised here: `nextIndex` to the leader's last log
 * index + 1, `matchIndex` to 0. The leader's own `matchIndex` is set to its last log
 * index so that commit counting can treat all servers uniformly.
 */
export function becomeLeader(state: NodeState, config: RaftConfig): Transition {
  const lastIndex = lastLogIndex(state.log)
  const nextIndex = new Array<number>(config.nodeCount).fill(lastIndex + 1)
  const matchIndex = new Array<number>(config.nodeCount).fill(0)
  matchIndex[state.id] = lastIndex

  const leader: NodeState = {
    ...stopElectionTimer(state),
    role: 'leader',
    leaderId: state.id,
    nextIndex,
    matchIndex,
  }
  const beating = resetHeartbeatTimer(leader, config)
  return {
    state: beating.state,
    outbox: peersOf(state.id, config.nodeCount).map((peer) =>
      buildAppendEntries(beating.state, peer),
    ),
    timers: [beating.timer],
  }
}

/**
 * Figure 2, Rules for Servers, Leaders rule 3 — "If last log index >= nextIndex for a
 * follower: send AppendEntries with log entries starting at nextIndex". An empty
 * `entries` array is the heartbeat case of the same message.
 */
export function buildAppendEntries(state: NodeState, to: NodeId): AppendEntriesRequest {
  const next = state.nextIndex[to] ?? lastLogIndex(state.log) + 1
  const prevLogIndex = next - 1
  return {
    type: 'AppendEntries',
    from: state.id,
    to,
    term: state.currentTerm,
    leaderId: state.id,
    prevLogIndex,
    prevLogTerm: termAt(state.log, prevLogIndex),
    entries: sliceFrom(state.log, next),
    leaderCommit: state.commitIndex,
  }
}

/** Heartbeat / replication sweep to every peer. */
export function broadcastAppendEntries(state: NodeState, config: RaftConfig): readonly Message[] {
  return peersOf(state.id, config.nodeCount).map((peer) => buildAppendEntries(state, peer))
}

/**
 * Figure 2, Rules for Servers, Leaders rule 2 — "If command received from client:
 * append entry to local log".
 */
export function appendClientEntry(
  state: NodeState,
  command: string,
  config: RaftConfig,
): Transition {
  const log = append(state.log, [{ term: state.currentTerm, command }])
  const matchIndex = [...state.matchIndex]
  matchIndex[state.id] = lastLogIndex(log)
  const leader: NodeState = { ...state, log, matchIndex }
  // Replicate immediately rather than waiting for the next heartbeat. This is a
  // latency choice, not a correctness one — the heartbeat would carry it anyway.
  return { state: leader, outbox: broadcastAppendEntries(leader, config), timers: [] }
}

/**
 * Figure 2, AppendEntries RPC, Receiver implementation.
 *
 * Rule 1 is handled here; the term-adoption half of All Servers rule 2 has already
 * run in `node.ts` before dispatch, so `state.currentTerm >= request.term` unless the
 * step-down rule has been ablated.
 */
export function handleAppendEntries(
  state: NodeState,
  request: AppendEntriesRequest,
  config: RaftConfig,
): Transition {
  const reject = (matchIndex: number): AppendEntriesResponse => ({
    type: 'AppendEntriesResponse',
    from: state.id,
    to: request.from,
    term: state.currentTerm,
    success: false,
    matchIndex,
  })

  // Figure 2, AppendEntries RPC, receiver rule 1:
  // "Reply false if term < currentTerm (§5.1)"
  if (request.term < state.currentTerm) {
    return { state, outbox: [reject(0)], timers: [] }
  }

  // Figure 2, Rules for Servers, Candidates rule 3:
  // "If AppendEntries RPC received from new leader: convert to follower."
  // Also applies to a follower that must now recognise this leader for the term.
  let node: NodeState = { ...state, role: 'follower', leaderId: request.leaderId }

  // Figure 2, Rules for Servers, Followers rule 2 — hearing from the current leader
  // resets the election timeout. Reset before any rejection: a rejected AppendEntries
  // still proves a live leader for this term, and campaigning against it would be
  // pointless churn.
  const timerReset = resetElectionTimer(node, config)
  node = timerReset.state
  const timers: readonly TimerRequest[] = [timerReset.timer]

  // Figure 2, AppendEntries RPC, receiver rule 2:
  // "Reply false if log doesn't contain an entry at prevLogIndex whose term matches
  //  prevLogTerm (§5.3)"
  //
  // Split into its two halves so that ablation removes the guarantee without
  // corrupting the data structure — see `enforceAppendEntriesConsistencyCheck`.
  if (request.prevLogIndex > lastLogIndex(node.log)) {
    // The follower's log is too short. Retained under ablation: accepting here would
    // leave a hole, and a log with holes is not a Raft log.
    return { state: node, outbox: [reject(lastLogIndex(node.log))], timers }
  }
  const termMismatch = termAt(node.log, request.prevLogIndex) !== request.prevLogTerm
  if (termMismatch && enforceAppendEntriesConsistencyCheck(config.flags)) {
    return { state: node, outbox: [reject(request.prevLogIndex - 1)], timers }
  }

  // Figure 2, AppendEntries RPC, receiver rule 3:
  // "If an existing entry conflicts with a new one (same index but different terms),
  //  delete the existing entry and all that follow it (§5.3)"
  //
  // Figure 2, AppendEntries RPC, receiver rule 4:
  // "Append any new entries not already in the log"
  //
  // The two are one loop: walk the incoming entries against the existing log,
  // stopping at the first conflict. Entries already present are *not* re-appended —
  // truncating on a delayed duplicate would delete entries the leader still counts
  // as replicated, and Raft must tolerate duplicate delivery.
  let log = node.log
  for (let offset = 0; offset < request.entries.length; offset += 1) {
    const entry = request.entries[offset]
    if (entry === undefined) continue
    const index = request.prevLogIndex + 1 + offset
    // Already covered by this server's snapshot: it applied that entry before
    // discarding it, so it is committed and cannot conflict. Skip it.
    if (index <= log.lastIncludedIndex) continue
    const existing = entryAt(log, index)
    if (existing === undefined) {
      log = append(log, [entry])
      continue
    }
    if (existing.term !== entry.term) {
      log = replaceFrom(log, index, entry)
    }
    // Same index, same term: by Log Matching the entries are identical. Leave it.
  }
  node = { ...node, log }

  // Figure 2, AppendEntries RPC, receiver rule 5:
  // "If leaderCommit > commitIndex, set commitIndex = min(leaderCommit, index of last
  //  new entry)"
  //
  // "Index of last new entry" is `prevLogIndex + entries.length` — the highest index
  // this RPC establishes agreement on. For a heartbeat that is `prevLogIndex` itself,
  // which is right: the follower may not yet hold everything the leader has committed.
  const lastNewIndex = request.prevLogIndex + request.entries.length
  if (request.leaderCommit > node.commitIndex) {
    node = { ...node, commitIndex: Math.min(request.leaderCommit, lastNewIndex) }
  }

  const accept: AppendEntriesResponse = {
    type: 'AppendEntriesResponse',
    from: node.id,
    to: request.from,
    term: node.currentTerm,
    success: true,
    matchIndex: lastNewIndex,
  }
  return { state: node, outbox: [accept], timers }
}

/**
 * Figure 2, Rules for Servers, Leaders rule 3:
 * "If successful: update nextIndex and matchIndex for follower (§5.3)
 *  If AppendEntries fails because of log inconsistency: decrement nextIndex and
 *  retry (§5.3)"
 */
export function handleAppendEntriesResponse(
  state: NodeState,
  response: AppendEntriesResponse,
  config: RaftConfig,
): Transition {
  // A response from an earlier term says nothing about this one. Dropping it is not
  // in Figure 2 because the figure assumes RPC pairing; a reordering network needs it.
  if (state.role !== 'leader' || response.term !== state.currentTerm) {
    return { state, outbox: [], timers: [] }
  }

  if (response.success) {
    const nextIndex = [...state.nextIndex]
    const matchIndex = [...state.matchIndex]
    // Never move backwards: a delayed duplicate of an older success must not undo
    // progress already recorded by a later one.
    matchIndex[response.from] = Math.max(matchIndex[response.from] ?? 0, response.matchIndex)
    nextIndex[response.from] = Math.max(
      nextIndex[response.from] ?? 1,
      (matchIndex[response.from] ?? 0) + 1,
    )
    const leader = advanceCommitIndex({ ...state, nextIndex, matchIndex }, config)
    return { state: leader, outbox: [], timers: [] }
  }

  // Failure. Walk `nextIndex` back and retry. The paper's basic scheme decrements by
  // one; the follower's hint lets us skip the whole span it is missing, which is the
  // optimisation named in §5.3 and changes no outcome, only the number of round trips.
  const nextIndex = [...state.nextIndex]
  const current = nextIndex[response.from] ?? lastLogIndex(state.log) + 1
  const hinted = Math.min(current - 1, response.matchIndex + 1)
  nextIndex[response.from] = Math.max(1, hinted)
  const leader: NodeState = { ...state, nextIndex }
  return { state: leader, outbox: [buildAppendEntries(leader, response.from)], timers: [] }
}

/** True when the leader has entries the follower is known to be missing. */
export function hasEntriesFor(state: NodeState, peer: NodeId): boolean {
  return lastLogIndex(state.log) >= (state.nextIndex[peer] ?? Number.MAX_SAFE_INTEGER)
}

/** Exported for fixtures: does the log hold this index? */
export { hasIndex }
