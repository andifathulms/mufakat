import { createNode } from '@/lib/raft/node'
import { UNMODIFIED_RAFT, type AblationFlags } from '@/lib/raft/rules'
import { EMPTY_LOG, logFrom, type Log } from '@/lib/raft/log'
import type { NodeState, RaftConfig } from '@/lib/raft/types'

export const TEST_CONFIG: RaftConfig = {
  nodeCount: 5,
  electionTimeoutMin: 150,
  electionTimeoutMax: 300,
  heartbeatInterval: 50,
  flags: UNMODIFIED_RAFT,
  snapshotThreshold: 0,
}

export function configWith(overrides: Partial<RaftConfig>): RaftConfig {
  return { ...TEST_CONFIG, ...overrides }
}

export function withFlags(flags: Partial<AblationFlags>, base: RaftConfig = TEST_CONFIG): RaftConfig {
  return { ...base, flags: { ...base.flags, ...flags } }
}

/** `logOf(1, 1, 2)` is a three-entry uncompacted log, commands `c1 c2 c3`. */
export function logOf(...terms: readonly number[]): Log {
  return logFrom(terms.map((term, i) => ({ term, command: `c${i + 1}` })))
}

/** Entries only, for building an AppendEntries payload. */
export function entriesOf(...terms: readonly number[]): { term: number; command: string }[] {
  return terms.map((term, i) => ({ term, command: `c${i + 1}` }))
}

export function nodeWith(
  overrides: Partial<NodeState>,
  config: RaftConfig = TEST_CONFIG,
  id = 0,
): NodeState {
  return { ...createNode(id, config.nodeCount, 1), ...overrides }
}

/** A node's log, tolerating the optional lookups that `noUncheckedIndexedAccess` forces. */
export function logOfNode(node: NodeState | undefined): Log {
  return node?.log ?? EMPTY_LOG
}
