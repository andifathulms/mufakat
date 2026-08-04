/**
 * Timer helpers.
 *
 * There is no cancellation. A timer is reset by minting a new generation id; when a
 * previously scheduled timer fires, the node compares ids and ignores the stale one.
 * The event queue never has to be edited, which keeps it append-only and its replay
 * exactly reproducible.
 */

import { nextInt } from '@/lib/sim/prng'
import type { NodeState, RaftConfig, TimerRequest } from './types'

/**
 * Figure 2, Rules for Servers, Followers rule 2 — reset the election timeout.
 *
 * The timeout is randomized from the node's own PRNG stream. This is the mechanism
 * that breaks split votes, so it must be genuinely random in behaviour and fully
 * reproducible in practice; §5.2.
 */
export function resetElectionTimer(
  state: NodeState,
  config: RaftConfig,
): { state: NodeState; timer: TimerRequest } {
  const drawn = nextInt(state.prng, config.electionTimeoutMin, config.electionTimeoutMax)
  const id = state.electionTimerId + 1
  return {
    state: { ...state, prng: drawn.prng, electionTimerId: id },
    timer: { kind: 'election', id, delay: drawn.value },
  }
}

/**
 * Invalidate the running election timer without starting a new one. Used when a node
 * becomes leader: a leader has no election timeout.
 */
export function stopElectionTimer(state: NodeState): NodeState {
  return { ...state, electionTimerId: state.electionTimerId + 1 }
}

/**
 * Figure 2, Rules for Servers, Leaders rule 1 — heartbeats "repeated during idle
 * periods to prevent election timeouts".
 */
export function resetHeartbeatTimer(
  state: NodeState,
  config: RaftConfig,
): { state: NodeState; timer: TimerRequest } {
  const id = state.heartbeatTimerId + 1
  return {
    state: { ...state, heartbeatTimerId: id },
    timer: { kind: 'heartbeat', id, delay: config.heartbeatInterval },
  }
}

export function stopHeartbeatTimer(state: NodeState): NodeState {
  return { ...state, heartbeatTimerId: state.heartbeatTimerId + 1 }
}
