/**
 * Raft types. Field names match the paper exactly, so a reader can hold Figure 2
 * beside the code: `currentTerm`, `votedFor`, `commitIndex`, `lastApplied`,
 * `nextIndex`, `matchIndex`, `prevLogIndex`, `prevLogTerm`.
 *
 * Integers only. Terms, indices, and node ids are all integers.
 */

import type { Prng } from '@/lib/sim/prng'
import type { AblationFlags } from './rules'

export type NodeId = number

/** Log indices are 1-based, matching the paper. See `lib/raft/log.ts`. */
export interface LogEntry {
  readonly term: number
  readonly command: string
}

export type Role = 'follower' | 'candidate' | 'leader'

// ---------------------------------------------------------------------------
// Messages. Discriminated on `type`; every handler switches exhaustively.
// ---------------------------------------------------------------------------

/** Figure 2, RequestVote RPC, Arguments. */
export interface RequestVoteRequest {
  readonly type: 'RequestVote'
  readonly from: NodeId
  readonly to: NodeId
  readonly term: number
  readonly candidateId: NodeId
  readonly lastLogIndex: number
  readonly lastLogTerm: number
}

/** Figure 2, RequestVote RPC, Results. */
export interface RequestVoteResponse {
  readonly type: 'RequestVoteResponse'
  readonly from: NodeId
  readonly to: NodeId
  readonly term: number
  readonly voteGranted: boolean
}

/** Figure 2, AppendEntries RPC, Arguments. */
export interface AppendEntriesRequest {
  readonly type: 'AppendEntries'
  readonly from: NodeId
  readonly to: NodeId
  readonly term: number
  readonly leaderId: NodeId
  readonly prevLogIndex: number
  readonly prevLogTerm: number
  readonly entries: readonly LogEntry[]
  readonly leaderCommit: number
}

/**
 * Figure 2, AppendEntries RPC, Results — plus `matchIndex`.
 *
 * The figure says "If successful: update nextIndex and matchIndex for follower" but
 * does not say how the leader learns which index was matched. Deriving it from an
 * outstanding-request table is wrong under a reordering network, so the follower
 * states it: the highest index it now agrees with the leader on.
 */
export interface AppendEntriesResponse {
  readonly type: 'AppendEntriesResponse'
  readonly from: NodeId
  readonly to: NodeId
  readonly term: number
  readonly success: boolean
  readonly matchIndex: number
}

export type Message =
  | RequestVoteRequest
  | RequestVoteResponse
  | AppendEntriesRequest
  | AppendEntriesResponse

export type MessageType = Message['type']

// ---------------------------------------------------------------------------
// Node state
// ---------------------------------------------------------------------------

export interface NodeState {
  readonly id: NodeId
  readonly role: Role

  // Persistent state on all servers (Figure 2, State). Survives a restart.
  readonly currentTerm: number
  readonly votedFor: NodeId | null
  readonly log: readonly LogEntry[]

  // Volatile state on all servers. Reset by a restart.
  readonly commitIndex: number
  readonly lastApplied: number

  // Volatile state on leaders. Reinitialised after election.
  readonly nextIndex: readonly number[]
  readonly matchIndex: readonly number[]

  // Simulator bookkeeping, not part of Figure 2.
  /** Votes received this term, indexed by node id. */
  readonly votesGranted: readonly boolean[]
  /** Who this node currently believes is leader; drives the cluster view only. */
  readonly leaderId: NodeId | null
  /** This node's private PRNG stream, for election timeout jitter. */
  readonly prng: Prng
  /** Generation counters. A fired timer whose id is stale is ignored — this is how
   *  timers are cancelled without touching the event queue. */
  readonly electionTimerId: number
  readonly heartbeatTimerId: number
  /**
   * Applied commands by 1-based log index: `stateMachine[i - 1]` is the command
   * applied at index `i`. Written rather than pushed, so that re-applying a
   * different command at an index — a State Machine Safety violation — is visible
   * rather than silently appended.
   */
  readonly stateMachine: readonly string[]
}

// ---------------------------------------------------------------------------
// Step interface: step(state, input, config) -> { state, outbox, timers }
// ---------------------------------------------------------------------------

export type Input =
  | { readonly type: 'message'; readonly message: Message }
  | { readonly type: 'election-timeout'; readonly timerId: number }
  | { readonly type: 'heartbeat-timeout'; readonly timerId: number }
  | { readonly type: 'client-request'; readonly command: string }
  /** Node restarts: persistent state survives, volatile state is reinitialised. */
  | { readonly type: 'restart' }

export type TimerKind = 'election' | 'heartbeat'

export interface TimerRequest {
  readonly kind: TimerKind
  readonly id: number
  readonly delay: number
}

export interface AppliedEntry {
  readonly index: number
  readonly term: number
  readonly command: string
}

export interface StepResult {
  readonly state: NodeState
  readonly outbox: readonly Message[]
  readonly timers: readonly TimerRequest[]
  readonly applied: readonly AppliedEntry[]
}

export interface RaftConfig {
  readonly nodeCount: number
  /** Inclusive bounds on randomized election timeout, in virtual ticks. */
  readonly electionTimeoutMin: number
  readonly electionTimeoutMax: number
  readonly heartbeatInterval: number
  readonly flags: AblationFlags
}

/** A majority of the cluster. Integer arithmetic: 3 -> 2, 4 -> 3, 5 -> 3. */
export function majority(nodeCount: number): number {
  return Math.floor(nodeCount / 2) + 1
}
