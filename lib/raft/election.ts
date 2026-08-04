/**
 * Elections. Figure 2, RequestVote RPC and the Candidates rules.
 */

import { enforceElectionRestriction, incrementTermOnCandidacy } from './rules'
import { resetElectionTimer } from './timers'
import { becomeLeader, peersOf, type Transition } from './replication'
import { isAtLeastAsUpToDate, lastLogIndex, lastLogTerm } from './log'
import {
  majority,
  type Message,
  type NodeState,
  type RaftConfig,
  type RequestVoteRequest,
  type RequestVoteResponse,
} from './types'

/**
 * Figure 2, Rules for Servers, Candidates rule 1:
 * "On conversion to candidate, start election:
 *   - Increment currentTerm
 *   - Vote for self
 *   - Reset election timer
 *   - Send RequestVote RPCs to all other servers"
 *
 * Also Candidates rule 4: "If election timeout elapses: start new election" — the
 * same procedure, which is why there is one function.
 */
export function startElection(state: NodeState, config: RaftConfig): Transition {
  const currentTerm = incrementTermOnCandidacy(config.flags)
    ? state.currentTerm + 1
    : state.currentTerm

  const votesGranted = new Array<boolean>(config.nodeCount).fill(false)
  votesGranted[state.id] = true

  const candidate: NodeState = {
    ...state,
    role: 'candidate',
    currentTerm,
    votedFor: state.id,
    leaderId: null,
    votesGranted,
  }

  const timerReset = resetElectionTimer(candidate, config)

  // A single-node cluster elects itself on its own vote; the majority is one.
  if (majority(config.nodeCount) <= 1) {
    const won = becomeLeader(timerReset.state, config)
    return { ...won, timers: [...won.timers] }
  }

  const outbox: readonly Message[] = peersOf(state.id, config.nodeCount).map((peer) => {
    const request: RequestVoteRequest = {
      type: 'RequestVote',
      from: state.id,
      to: peer,
      term: currentTerm,
      candidateId: state.id,
      lastLogIndex: lastLogIndex(state.log),
      lastLogTerm: lastLogTerm(state.log),
    }
    return request
  })

  return { state: timerReset.state, outbox, timers: [timerReset.timer] }
}

/**
 * Figure 2, RequestVote RPC, Receiver implementation:
 * "1. Reply false if term < currentTerm (§5.1)
 *  2. If votedFor is null or candidateId, and candidate's log is at least as
 *     up-to-date as receiver's log, grant vote (§5.2, §5.4)"
 *
 * The term-adoption half of All Servers rule 2 has already run in `node.ts`, so a
 * candidate from a higher term has already reset `votedFor` by the time we arrive.
 */
export function handleRequestVote(
  state: NodeState,
  request: RequestVoteRequest,
  config: RaftConfig,
): Transition {
  const deny: RequestVoteResponse = {
    type: 'RequestVoteResponse',
    from: state.id,
    to: request.from,
    term: state.currentTerm,
    voteGranted: false,
  }

  // Receiver rule 1.
  if (request.term < state.currentTerm) {
    return { state, outbox: [deny], timers: [] }
  }

  // Receiver rule 2, first clause — one vote per term.
  const free = state.votedFor === null || state.votedFor === request.candidateId
  if (!free) {
    return { state, outbox: [deny], timers: [] }
  }

  // Receiver rule 2, second clause — the election restriction, §5.4.1.
  // This is the rule that makes Leader Completeness hold: it is what stops a
  // candidate that is missing committed entries from ever winning.
  const upToDate = isAtLeastAsUpToDate(request.lastLogTerm, request.lastLogIndex, state.log)
  if (enforceElectionRestriction(config.flags) && !upToDate) {
    return { state, outbox: [deny], timers: [] }
  }

  const voted: NodeState = { ...state, votedFor: request.candidateId }
  // Figure 2, Rules for Servers, Followers rule 2 — granting a vote resets the
  // election timeout, so a node that has just helped someone campaign does not
  // immediately campaign against them.
  const timerReset = resetElectionTimer(voted, config)
  const grant: RequestVoteResponse = {
    type: 'RequestVoteResponse',
    from: state.id,
    to: request.from,
    term: state.currentTerm,
    voteGranted: true,
  }
  return { state: timerReset.state, outbox: [grant], timers: [timerReset.timer] }
}

/**
 * Figure 2, Rules for Servers, Candidates rule 2:
 * "If votes received from majority of servers: become leader"
 */
export function handleRequestVoteResponse(
  state: NodeState,
  response: RequestVoteResponse,
  config: RaftConfig,
): Transition {
  // A vote cast in an earlier term is not a vote in this one. Figure 2 assumes RPC
  // pairing; a reordering network makes the check explicit.
  if (state.role !== 'candidate' || response.term !== state.currentTerm) {
    return { state, outbox: [], timers: [] }
  }
  if (!response.voteGranted) {
    return { state, outbox: [], timers: [] }
  }

  const votesGranted = [...state.votesGranted]
  votesGranted[response.from] = true
  const candidate: NodeState = { ...state, votesGranted }

  const tally = votesGranted.filter(Boolean).length
  if (tally < majority(config.nodeCount)) {
    return { state: candidate, outbox: [], timers: [] }
  }
  return becomeLeader(candidate, config)
}

/** Votes counted for this node in its current term. For the cluster view. */
export function voteTally(state: NodeState): number {
  return state.votesGranted.filter(Boolean).length
}
