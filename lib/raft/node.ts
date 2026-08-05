/**
 * The node state machine. `step(state, input, config) -> { state, outbox, timers }`.
 *
 * Pure. No clock reads, no `Date`, no `Math.random`, no I/O, no DOM, no module-level
 * mutable state. All randomness comes from the PRNG carried inside `NodeState`.
 *
 * This file holds the two Figure 2 "All Servers" rules, which wrap every dispatch,
 * and the restart path. The per-RPC rules live in `election.ts` and `replication.ts`.
 */

import { prngFromSeed } from '@/lib/sim/prng'
import { initialLog, lastLogIndex } from './log'
import { persistVotedForAcrossRestart, stepDownOnHigherTerm } from './rules'
import {
  disregardRequestVote,
  handleRequestVote,
  handleRequestVoteResponse,
  shouldDisregardRequestVote,
  startElection,
} from './election'
import {
  appendClientEntry,
  broadcastAppendEntries,
  handleAppendEntries,
  handleAppendEntriesResponse,
  advanceConfigurationChange,
  beginConfigurationChange,
  handleInstallSnapshot,
  handleInstallSnapshotResponse,
  maybeSnapshot,
  stepDownIfRemoved,
  type Transition,
} from './replication'
import { applyCommitted } from './commit'
import { resetElectionTimer, resetHeartbeatTimer, stopHeartbeatTimer } from './timers'
import type {
  AppliedEntry,
  Input,
  Message,
  NodeId,
  NodeState,
  RaftConfig,
  StepResult,
  TimerRequest,
} from './types'

/** A fresh node. `seed` and `id` together fix its private PRNG stream. */
export function createNode(id: NodeId, nodeCount: number, seed: number): NodeState {
  return {
    id,
    role: 'follower',
    currentTerm: 0,
    votedFor: null,
    log: initialLog(nodeCount),
    commitIndex: 0,
    lastApplied: 0,
    nextIndex: new Array<number>(nodeCount).fill(1),
    matchIndex: new Array<number>(nodeCount).fill(0),
    votesGranted: new Array<boolean>(nodeCount).fill(false),
    leaderId: null,
    // Stream `id + 1` so node 0 does not share the seed's base stream with anything
    // else that draws from it.
    prng: prngFromSeed(seed, id + 1),
    electionTimerId: 0,
    heartbeatTimerId: 0,
    heardFromLeader: false,
    stateMachine: [],
  }
}

/**
 * Figure 2, Rules for Servers, All Servers rule 2:
 * "If RPC request or response contains term T > currentTerm: set currentTerm = T,
 *  convert to follower (§5.1)"
 *
 * The single call site of the `stepDownOnHigherTerm` guard. With it off, a superseded
 * leader keeps both its role and its stale term, so it goes on issuing AppendEntries
 * alongside the real leader.
 */
function observeTerm(
  state: NodeState,
  term: number,
  config: RaftConfig,
): { state: NodeState; timers: readonly TimerRequest[] } {
  if (term <= state.currentTerm) return { state, timers: [] }

  // The rule has two halves: adopt the term, and convert to follower. Only the second
  // is ablatable. Suppressing term adoption as well would not break a safety property
  // — it would deadlock elections, because every server would keep the vote it cast
  // in its old term forever and no candidate could ever assemble a majority again.
  // That is a liveness failure, and it would teach the wrong lesson about what this
  // rule is for. Ablating the conversion alone leaves a superseded leader running in
  // the *new* term alongside the real one, which is precisely two leaders in a term.
  const revert = stepDownOnHigherTerm(config.flags)

  const wasFollower = state.role === 'follower'
  let node: NodeState = {
    ...state,
    currentTerm: term,
    // A new term is a new ballot: the vote record from the old term does not carry.
    votedFor: null,
    role: revert ? 'follower' : state.role,
    leaderId: revert ? null : state.leaderId,
    votesGranted: new Array<boolean>(config.nodeCount).fill(false),
  }
  if (!revert) {
    // Still leading, or still campaigning, in a term it has just learned about.
    return { state: node, timers: [] }
  }
  if (wasFollower) {
    // Already a follower with a running election timer. Figure 2 resets the timer only
    // on hearing from the current leader or granting a vote, and this is neither.
    return { state: node, timers: [] }
  }
  // Stepping down from candidate or leader: stop heartbeating and start counting
  // down to the next election, or the node would never campaign again.
  node = stopHeartbeatTimer(node)
  const timerReset = resetElectionTimer(node, config)
  return { state: timerReset.state, timers: [timerReset.timer] }
}

/**
 * Restart after a crash.
 *
 * Figure 2, State: `currentTerm`, `votedFor` and `log` are persistent and survive;
 * `commitIndex` and `lastApplied` are volatile and are reinitialised. Leader state is
 * volatile too, so the node comes back as a follower.
 *
 * The single call site of the `persistVotedForAcrossRestart` guard. With it off the
 * node forgets who it voted for and can vote a second time in the same term, electing
 * two leaders in it.
 */
function restart(state: NodeState, config: RaftConfig): Transition {
  const rebooted: NodeState = {
    ...state,
    role: 'follower',
    votedFor: persistVotedForAcrossRestart(config.flags) ? state.votedFor : null,
    // Figure 2 says `commitIndex` and `lastApplied` are volatile and initialised to 0.
    // §7 changes that, and the figure does not say so: the *snapshot* is persistent, so
    // a restarting server reloads a state machine that already reflects everything
    // through `lastIncludedIndex`. Starting these at 0 would claim the server had
    // applied nothing while its state machine says otherwise, and it would then try to
    // re-apply entries it has legitimately discarded.
    commitIndex: state.log.lastIncludedIndex,
    lastApplied: state.log.lastIncludedIndex,
    nextIndex: new Array<number>(config.nodeCount).fill(lastLogIndex(state.log) + 1),
    matchIndex: new Array<number>(config.nodeCount).fill(0),
    votesGranted: new Array<boolean>(config.nodeCount).fill(false),
    leaderId: null,
    heardFromLeader: false,
    heartbeatTimerId: state.heartbeatTimerId + 1,
  }
  const timerReset = resetElectionTimer(rebooted, config)
  return { state: timerReset.state, outbox: [], timers: [timerReset.timer] }
}

/** Route a message to its Figure 2 receiver. Exhaustive on `message.type`. */
function dispatch(state: NodeState, message: Message, config: RaftConfig): Transition {
  switch (message.type) {
    case 'RequestVote':
      return handleRequestVote(state, message, config)
    case 'RequestVoteResponse':
      return handleRequestVoteResponse(state, message, config)
    case 'AppendEntries':
      return handleAppendEntries(state, message, config)
    case 'AppendEntriesResponse':
      return handleAppendEntriesResponse(state, message, config)
    case 'InstallSnapshot':
      return handleInstallSnapshot(state, message, config)
    case 'InstallSnapshotResponse':
      return handleInstallSnapshotResponse(state, message)
    default: {
      // A new message type must surface every handler that has to deal with it.
      const unreachable: never = message
      throw new Error(`Unhandled message type: ${JSON.stringify(unreachable)}`)
    }
  }
}

/** The one entry point into the algorithm. */
export function step(state: NodeState, input: Input, config: RaftConfig): StepResult {
  let node = state
  let outbox: readonly Message[] = []
  let timers: readonly TimerRequest[] = []

  switch (input.type) {
    case 'message': {
      // §6, third issue — "servers disregard RequestVote RPCs when they believe a
      // current leader exists". Checked *before* All Servers rule 2, and that ordering
      // is the whole point: disregarding means not adopting the term either. A removed
      // server campaigning with an ever-higher term would otherwise depose a perfectly
      // healthy leader on every attempt, forever.
      if (input.message.type === 'RequestVote' && shouldDisregardRequestVote(node, config)) {
        outbox = [disregardRequestVote(node, input.message)]
        break
      }
      // Figure 2, All Servers rule 2, applied to every RPC request and response
      // before the receiver rules see it.
      const observed = observeTerm(node, input.message.term, config)
      node = observed.state
      timers = observed.timers
      const transition = dispatch(node, input.message, config)
      node = transition.state
      outbox = transition.outbox
      timers = [...timers, ...transition.timers]
      break
    }

    case 'election-timeout': {
      // A stale generation: this timer was reset before it fired. Ignore it.
      if (input.timerId !== node.electionTimerId) break
      // Figure 2, Followers rule 2 and Candidates rule 4. A leader has no election
      // timeout; if one is somehow outstanding it is stale by definition.
      if (node.role === 'leader') break
      // The timer firing is exactly what ends the window in which this server
      // believes a leader exists. See `heardFromLeader`.
      node = { ...node, heardFromLeader: false }
      const transition = startElection(node, config)
      node = transition.state
      outbox = transition.outbox
      timers = transition.timers
      break
    }

    case 'heartbeat-timeout': {
      if (input.timerId !== node.heartbeatTimerId) break
      if (node.role !== 'leader') break
      // Figure 2, Leaders rule 1 (repeat during idle periods) and rule 3 (send
      // entries from nextIndex) are the same sweep — an empty entries array is the
      // heartbeat, a non-empty one is replication.
      const beat = resetHeartbeatTimer(node, config)
      node = beat.state
      outbox = broadcastAppendEntries(node, config)
      timers = [beat.timer]
      break
    }

    case 'client-request': {
      // Figure 2, Leaders rule 2. Only the leader appends; redirection to the leader
      // is the simulation's job, not the state machine's.
      if (node.role !== 'leader') break
      const transition = appendClientEntry(node, input.command, config)
      node = transition.state
      outbox = transition.outbox
      timers = transition.timers
      break
    }

    case 'change-configuration': {
      // §6. Like a client request, this is a log entry — the difference is that it
      // takes effect on append rather than on commit, and that the algorithm follows
      // it up with a second entry of its own accord.
      if (node.role !== 'leader') break
      const transition = beginConfigurationChange(node, input.servers, config)
      node = transition.state
      outbox = transition.outbox
      timers = transition.timers
      break
    }

    case 'restart': {
      const transition = restart(node, config)
      node = transition.state
      outbox = transition.outbox
      timers = transition.timers
      break
    }

    default: {
      const unreachable: never = input
      throw new Error(`Unhandled input: ${JSON.stringify(unreachable)}`)
    }
  }

  // Figure 2, All Servers rule 1 — apply anything newly committed. Runs after every
  // input, because commitIndex can advance on any of them.
  const settled = applyCommitted(node)
  const applied: readonly AppliedEntry[] = settled.applied
  node = settled.state

  // §6 — once C-old,new commits the leader must append C-new, and once C-new commits a
  // leader that is no longer a member must step down. Both hang off a commit-index
  // advance, which any input can cause, so both are checked here rather than at the
  // one call site that happens to be commonest.
  const advanced = advanceConfigurationChange(node, config)
  node = stepDownIfRemoved(advanced.state)
  const configurationOutbox = advanced.outbox

  // §7 — and only then may the server discard what it has applied. Snapshotting
  // *after* applying is not an ordering preference: the other way round would let a
  // server discard an entry it had not yet put into its state machine.
  return {
    state: maybeSnapshot(node, config),
    outbox: configurationOutbox.length === 0 ? outbox : [...outbox, ...configurationOutbox],
    timers,
    applied,
  }
}
