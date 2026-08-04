/**
 * Raft types. Field names match the paper exactly, so a reader can hold Figure 2
 * beside the code: `currentTerm`, `votedFor`, `commitIndex`, `lastApplied`,
 * `nextIndex`, `matchIndex`, `prevLogIndex`, `prevLogTerm`.
 *
 * Integers only. Terms, indices, and node ids are all integers.
 */

import type { Prng } from '@/lib/sim/prng'
import type { AblationFlags } from './rules'
import type { Log } from './log'

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

/**
 * Figure 13, InstallSnapshot RPC, Arguments.
 *
 * **Chunking is deliberately not modelled.** The figure carries `offset`, `data[]` and
 * `done` so that a snapshot too large for one message can be sent in pieces. That is
 * an engineering concern about bytes on a wire, and this simulator has no bytes: a
 * snapshot here is the state machine's contents, transferred whole. Including the
 * fields and always setting `offset: 0, done: true` would be a fiction dressed as
 * conformance, so they are omitted and their absence is stated instead.
 *
 * What *is* modelled is the part that matters for understanding: a follower so far
 * behind that the leader has already discarded the entries it needs cannot be caught
 * up by AppendEntries at all, and receives the state itself instead.
 */
export interface InstallSnapshotRequest {
  readonly type: 'InstallSnapshot'
  readonly from: NodeId
  readonly to: NodeId
  readonly term: number
  readonly leaderId: NodeId
  readonly lastIncludedIndex: number
  readonly lastIncludedTerm: number
  /** The state machine's contents through `lastIncludedIndex`, by 1-based index. */
  readonly data: readonly (string | undefined)[]
}

/** Figure 13, InstallSnapshot RPC, Results — plus the acknowledged index. */
export interface InstallSnapshotResponse {
  readonly type: 'InstallSnapshotResponse'
  readonly from: NodeId
  readonly to: NodeId
  readonly term: number
  /**
   * The snapshot index the follower installed. Figure 13 returns only `term`, leaving
   * the leader to infer what was acknowledged — which, as with AppendEntries, is
   * wrong under a reordering network. The follower states it.
   */
  readonly lastIncludedIndex: number
}

export type Message =
  | RequestVoteRequest
  | RequestVoteResponse
  | AppendEntriesRequest
  | AppendEntriesResponse
  | InstallSnapshotRequest
  | InstallSnapshotResponse

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
  /**
   * The entries this server holds, bundled with the snapshot point beneath them.
   * Only `lib/raft/log.ts` may look inside. See §7 and Figure 13.
   */
  readonly log: Log

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
  /**
   * §7 — a server snapshots once it holds this many applied entries above its current
   * snapshot point. 0 disables compaction entirely, which is the default: every
   * scenario and fixture written before §7 existed must keep producing exactly the
   * trace it produced then.
   *
   * Each server decides independently, which is the paper's design: "each server takes
   * snapshots independently, covering just the committed entries in its own log."
   */
  readonly snapshotThreshold: number
}

/** A majority of the cluster. Integer arithmetic: 3 -> 2, 4 -> 3, 5 -> 3. */
export function majority(nodeCount: number): number {
  return Math.floor(nodeCount / 2) + 1
}
