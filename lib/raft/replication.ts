/**
 * Log replication. Figure 2, AppendEntries RPC and the Leaders rules.
 *
 * Pure: no clock, no randomness beyond the PRNG threaded through `NodeState`.
 */

import { enforceAppendEntriesConsistencyCheck, enforceJointConsensus } from './rules'
import { resetElectionTimer, resetHeartbeatTimer, stopElectionTimer } from './timers'
import { advanceCommitIndex } from './commit'
import {
  append,
  compact,
  configurationAt,
  configurationIndex,
  configurationOf,
  entryAt,
  hasIndex,
  installSnapshot,
  lastLogIndex,
  replaceFrom,
  sliceFrom,
  termAt,
} from './log'
import {
  describeConfiguration,
  isMember,
  jointConfiguration,
  members,
  replicationTargets,
  sameConfiguration,
  sameServers,
  simpleConfiguration,
  targetOf,
  type Configuration,
} from './configuration'
import type {
  AppendEntriesRequest,
  AppendEntriesResponse,
  InstallSnapshotRequest,
  InstallSnapshotResponse,
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

/**
 * Every server this one replicates to: the members of its own configuration, itself
 * excluded, ascending. §6 — during a joint configuration that is the union of both
 * halves, so servers on their way out keep receiving entries until C-new commits.
 */
export function peersOf(state: NodeState): readonly NodeId[] {
  return replicationTargets(configurationOf(state.log), state.id)
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
    outbox: peersOf(beating.state).map((peer) => buildReplication(beating.state, peer)),
    timers: [beating.timer],
  }
}

/**
 * §7 — "when the leader has already discarded the next log entry that it needs to send
 * to a follower", it sends the snapshot instead.
 *
 * This is the one place the two replication paths diverge, and the condition is
 * exactly that `nextIndex` has fallen at or below what the leader still holds.
 */
export function needsSnapshot(state: NodeState, to: NodeId): boolean {
  const next = state.nextIndex[to] ?? lastLogIndex(state.log) + 1
  return next <= state.log.lastIncludedIndex
}

/** Figure 13, InstallSnapshot RPC, Arguments. */
export function buildInstallSnapshot(state: NodeState, to: NodeId): InstallSnapshotRequest {
  return {
    type: 'InstallSnapshot',
    from: state.id,
    to,
    term: state.currentTerm,
    leaderId: state.id,
    lastIncludedIndex: state.log.lastIncludedIndex,
    lastIncludedTerm: state.log.lastIncludedTerm,
    // Figure 13, receiver rule 8 — the snapshot carries the cluster configuration,
    // because the entries that would otherwise describe it have been discarded.
    lastIncludedConfiguration: state.log.lastIncludedConfiguration,
    // The state machine through the snapshot point. Sent whole; see the note on
    // `InstallSnapshotRequest` about why chunking is not modelled.
    data: state.stateMachine.slice(0, state.log.lastIncludedIndex),
  }
}

/** Whichever of the two replication messages this follower can actually use. */
export function buildReplication(state: NodeState, to: NodeId): Message {
  return needsSnapshot(state, to) ? buildInstallSnapshot(state, to) : buildAppendEntries(state, to)
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

/** Heartbeat / replication sweep to every peer in the current configuration. */
export function broadcastAppendEntries(state: NodeState, config: RaftConfig): readonly Message[] {
  void config
  return peersOf(state).map((peer) => buildReplication(state, peer))
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
  // `heardFromLeader` opens the window in which this server disregards RequestVote; §6.
  let node: NodeState = {
    ...state,
    role: 'follower',
    leaderId: request.leaderId,
    heardFromLeader: true,
  }

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
  // If walking back has gone past what the leader still holds, the retry cannot be an
  // AppendEntries at all — §7, and the single reason InstallSnapshot exists.
  return { state: leader, outbox: [buildReplication(leader, response.from)], timers: [] }
}

// ---------------------------------------------------------------------------
// §7 — snapshots
// ---------------------------------------------------------------------------

/**
 * Figure 13, InstallSnapshot RPC, Receiver implementation.
 *
 * Rules 2, 3 and 4 concern reassembling a chunked transfer and have no counterpart
 * here — see the note on `InstallSnapshotRequest`. Rules 1, 5, 6, 7 and 8 are below.
 */
export function handleInstallSnapshot(
  state: NodeState,
  request: InstallSnapshotRequest,
  config: RaftConfig,
): Transition {
  const reply = (node: NodeState): InstallSnapshotResponse => ({
    type: 'InstallSnapshotResponse',
    from: node.id,
    to: request.from,
    term: node.currentTerm,
    lastIncludedIndex: node.log.lastIncludedIndex,
  })

  // Figure 13, receiver rule 1: "Reply immediately if term < currentTerm".
  if (request.term < state.currentTerm) {
    return { state, outbox: [reply(state)], timers: [] }
  }

  // A snapshot is a message from the leader for this term, so the follower recognises
  // it and resets its election timeout, exactly as for AppendEntries.
  let node: NodeState = {
    ...state,
    role: 'follower',
    leaderId: request.leaderId,
    heardFromLeader: true,
  }
  const timerReset = resetElectionTimer(node, config)
  node = timerReset.state
  const timers: readonly TimerRequest[] = [timerReset.timer]

  // Figure 13, receiver rule 5: "discard any existing or partial snapshot with a
  // smaller index" — here, ignore a snapshot that is not ahead of where we already are.
  if (request.lastIncludedIndex <= node.log.lastIncludedIndex) {
    return { state: node, outbox: [reply(node)], timers }
  }

  // Figure 13, receiver rules 6 and 7 — retain the suffix if the log agrees at the
  // snapshot point, otherwise discard the log entirely. Both live in `log.ts`.
  const log = installSnapshot(
    node.log,
    request.lastIncludedIndex,
    request.lastIncludedTerm,
    request.lastIncludedConfiguration,
  )

  // Figure 13, receiver rule 8: "Reset state machine using snapshot contents".
  const stateMachine = [...node.stateMachine]
  for (let index = 1; index <= request.lastIncludedIndex; index += 1) {
    const command = request.data[index - 1]
    if (command !== undefined) stateMachine[index - 1] = command
  }

  node = {
    ...node,
    log,
    stateMachine,
    // The snapshot is by definition committed and applied on the leader, so the
    // follower is now at least that far along on both counts. Neither may move
    // backwards: a delayed snapshot must not un-apply anything.
    commitIndex: Math.max(node.commitIndex, request.lastIncludedIndex),
    lastApplied: Math.max(node.lastApplied, request.lastIncludedIndex),
  }
  return { state: node, outbox: [reply(node)], timers }
}

/** The leader's side: treat an installed snapshot as a match through its index. */
export function handleInstallSnapshotResponse(
  state: NodeState,
  response: InstallSnapshotResponse,
): Transition {
  if (state.role !== 'leader' || response.term !== state.currentTerm) {
    return { state, outbox: [], timers: [] }
  }
  const matchIndex = [...state.matchIndex]
  const nextIndex = [...state.nextIndex]
  matchIndex[response.from] = Math.max(matchIndex[response.from] ?? 0, response.lastIncludedIndex)
  nextIndex[response.from] = Math.max(
    nextIndex[response.from] ?? 1,
    (matchIndex[response.from] ?? 0) + 1,
  )
  return { state: { ...state, matchIndex, nextIndex }, outbox: [], timers: [] }
}

// ---------------------------------------------------------------------------
// §6 — membership changes
// ---------------------------------------------------------------------------

/** A configuration change already in flight: a joint entry that has not committed. */
export function transitionInProgress(state: NodeState): boolean {
  const configuration = configurationOf(state.log)
  if (configuration.type === 'joint') return true
  // A simple configuration that is not yet committed is the second half of a
  // transition — C-new appended but not agreed. Starting another now would stack two
  // changes, which §6 forbids: "only one configuration change at a time".
  return configurationIndex(state.log) > state.commitIndex
}

/**
 * §6 — a leader begins a membership change by appending C-old,new.
 *
 * The entry takes effect the moment it is appended, before it is committed, and that
 * is what makes the change safe rather than reckless: from this instant the leader
 * needs majorities of *both* the old and the new sets for anything at all, so no
 * decision can be taken by a set that excludes the other.
 */
export function beginConfigurationChange(
  state: NodeState,
  newServers: readonly NodeId[],
  config: RaftConfig,
): Transition {
  if (state.role !== 'leader') return { state, outbox: [], timers: [] }
  if (transitionInProgress(state)) return { state, outbox: [], timers: [] }

  const current = configurationOf(state.log)
  const oldServers = members(current)
  if (sameServers(oldServers, newServers)) return { state, outbox: [], timers: [] }
  if (newServers.length === 0) return { state, outbox: [], timers: [] }

  // The ablated path: switch straight to C-new with no joint phase, which is exactly
  // the mistake Figure 10 draws. Servers adopt it at different moments, so for a while
  // C-old and C-new are both live and can contain disjoint majorities.
  const configuration: Configuration = enforceJointConsensus(config.flags)
    ? jointConfiguration(oldServers, newServers)
    : simpleConfiguration(newServers)

  return appendConfiguration(state, configuration, config)
}

/** Append a configuration entry and replicate it at once. */
function appendConfiguration(
  state: NodeState,
  configuration: Configuration,
  config: RaftConfig,
): Transition {
  const log = append(state.log, [
    {
      term: state.currentTerm,
      command: describeConfiguration(configuration),
      configuration,
    },
  ])
  const matchIndex = [...state.matchIndex]
  matchIndex[state.id] = lastLogIndex(log)

  // A server joining now has never been replicated to. `nextIndex` for it defaults to
  // the end of the leader's log, and the usual backtracking — or a snapshot — brings
  // it up. Nothing special is needed, which is the point of putting configurations in
  // the log in the first place.
  const nextIndex = [...state.nextIndex]
  for (const id of members(configuration)) {
    if (nextIndex[id] === undefined) nextIndex[id] = lastLogIndex(log)
  }

  const leader: NodeState = { ...state, log, matchIndex, nextIndex }
  return { state: leader, outbox: broadcastAppendEntries(leader, config), timers: [] }
}

/**
 * §6 — "Once C-old,new has been committed... the leader creates an entry describing
 * C-new and replicates it to the cluster."
 *
 * Run after every commit-index advance on a leader. The second half of the transition
 * is not a separate user action: the algorithm carries it through on its own, which is
 * why a membership change is one request and two log entries.
 */
export function advanceConfigurationChange(state: NodeState, config: RaftConfig): Transition {
  if (state.role !== 'leader') return { state, outbox: [], timers: [] }
  const configuration = configurationOf(state.log)
  if (configuration.type !== 'joint') return { state, outbox: [], timers: [] }
  // Only once the joint configuration itself is committed.
  if (configurationIndex(state.log) > state.commitIndex) return { state, outbox: [], timers: [] }

  const target = targetOf(configuration)
  if (sameConfiguration(target, configuration)) return { state, outbox: [], timers: [] }
  return appendConfiguration(state, target, config)
}

/**
 * §6, second issue — "the cluster leader may not be part of the new configuration."
 *
 * A leader removing itself keeps managing the cluster until C-new commits, because
 * someone has to replicate the entry that removes it, and only then steps down. Until
 * that moment it replicates as leader but does not count itself toward agreement,
 * which `hasQuorum` already handles: it is simply not in the configuration's sets.
 */
export function stepDownIfRemoved(state: NodeState): NodeState {
  if (state.role !== 'leader') return state
  const configuration = configurationOf(state.log)
  if (configuration.type === 'joint') return state
  if (isMember(configuration, state.id)) return state
  if (configurationIndex(state.log) > state.commitIndex) return state
  return { ...state, role: 'follower', leaderId: null }
}

/**
 * §7 — "each server takes snapshots independently, covering just the committed entries
 * in its own log."
 *
 * A server may only discard entries it has *applied*: `lastApplied`, never
 * `commitIndex`, is the ceiling. Discarding an entry that is committed but not yet
 * applied would lose it from both the log and the state machine at once.
 */
export function maybeSnapshot(state: NodeState, config: RaftConfig): NodeState {
  if (config.snapshotThreshold <= 0) return state
  const pending = state.lastApplied - state.log.lastIncludedIndex
  if (pending < config.snapshotThreshold) return state
  const log = compact(state.log, state.lastApplied)
  if (log === state.log) return state
  return { ...state, log }
}

/** True when the leader has entries the follower is known to be missing. */
export function hasEntriesFor(state: NodeState, peer: NodeId): boolean {
  return lastLogIndex(state.log) >= (state.nextIndex[peer] ?? Number.MAX_SAFE_INTEGER)
}

/** Exported for fixtures: does the log hold this index? */
export { hasIndex }
