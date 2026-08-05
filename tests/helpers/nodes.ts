import { createNode } from '@/lib/raft/node'
import { UNMODIFIED_RAFT, type AblationFlags } from '@/lib/raft/rules'
import { EMPTY_LOG, logFrom, type Log } from '@/lib/raft/log'
import { allServers } from '@/lib/raft/configuration'
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
  const node = { ...createNode(id, config.nodeCount, 1), ...overrides }
  // §6 — a hand-built log has no baseline configuration, and a server whose
  // configuration is empty belongs to no cluster: it has no peers and can reach no
  // quorum. A fixture node is a member of the whole test cluster unless it says
  // otherwise, so fill the baseline in rather than making every fixture repeat it.
  if (node.log.lastIncludedConfiguration.type === 'simple' &&
      node.log.lastIncludedConfiguration.servers.length === 0) {
    return { ...node, log: { ...node.log, lastIncludedConfiguration: allServers(config.nodeCount) } }
  }
  return node
}

/** A node's log, tolerating the optional lookups that `noUncheckedIndexedAccess` forces. */
export function logOfNode(node: NodeState | undefined): Log {
  return node?.log ?? EMPTY_LOG
}
