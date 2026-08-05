import { describe, expect, it } from 'vitest'
import {
  EMPTY_LOG,
  compact,
  heldEntries,
  installSnapshot,
  knowsTerm,
  lastLogIndex,
  lastLogTerm,
  logFrom,
  termAt,
} from '@/lib/raft/log'
import { allServers } from '@/lib/raft/configuration'
import { step } from '@/lib/raft/node'
import { buildReplication, needsSnapshot } from '@/lib/raft/replication'
import type { InstallSnapshotRequest, InstallSnapshotResponse } from '@/lib/raft/types'
import { TEST_CONFIG, configWith, logOf, nodeWith } from '../helpers/nodes'

/**
 * §7 and Figure 13 — log compaction.
 *
 * Chunking (`offset`, `data[]`, `done`) is not modelled and is not asserted here; see
 * the note on `InstallSnapshotRequest` for why pretending otherwise would be a
 * fiction. Everything else in the figure has a fixture.
 */

const terms = (log: Parameters<typeof heldEntries>[0]): number[] =>
  heldEntries(log).map((entry) => entry.term)

function installSnapshotRequest(
  overrides: Partial<InstallSnapshotRequest> = {},
): InstallSnapshotRequest {
  return {
    type: 'InstallSnapshot',
    from: 1,
    to: 0,
    term: 5,
    leaderId: 1,
    lastIncludedIndex: 3,
    lastIncludedTerm: 2,
    lastIncludedConfiguration: allServers(5),
    data: ['c1', 'c2', 'c3'],
    ...overrides,
  }
}

function snapshotResponse(result: { outbox: readonly unknown[] }): InstallSnapshotResponse {
  const message = result.outbox[0]
  if (
    message === undefined ||
    typeof message !== 'object' ||
    (message as { type?: string }).type !== 'InstallSnapshotResponse'
  ) {
    throw new Error('expected an InstallSnapshotResponse')
  }
  return message as InstallSnapshotResponse
}

describe('§7 — the log after compaction', () => {
  it('keeps absolute indices, so nothing above the snapshot point shifts', () => {
    const log = compact(logOf(1, 1, 2, 2, 3), 3)
    expect(log.lastIncludedIndex).toBe(3)
    expect(log.lastIncludedTerm).toBe(2)
    // Two entries left, but they are still indices 4 and 5 — not 1 and 2.
    expect(heldEntries(log)).toHaveLength(2)
    expect(lastLogIndex(log)).toBe(5)
    expect(termAt(log, 4)).toBe(2)
    expect(termAt(log, 5)).toBe(3)
    expect(log.entries[0]?.command).toBe('c4')
  })

  it('remembers the term at the snapshot point, and nothing below it', () => {
    const log = compact(logOf(1, 1, 2, 2, 3), 3)
    expect(knowsTerm(log, 3)).toBe(true)
    expect(termAt(log, 3)).toBe(2)
    // Genuinely gone. The safe answer, not a guessed one.
    expect(knowsTerm(log, 2)).toBe(false)
    expect(termAt(log, 2)).toBe(0)
  })

  it('reports last index and last term correctly when everything is compacted', () => {
    const log = compact(logOf(1, 1, 4), 3)
    expect(heldEntries(log)).toHaveLength(0)
    // The election restriction depends on this pair being right even with no entries.
    expect(lastLogIndex(log)).toBe(3)
    expect(lastLogTerm(log)).toBe(4)
  })

  it('refuses to compact past what it holds, or backwards', () => {
    const log = compact(logOf(1, 1, 2), 2)
    expect(compact(log, 1)).toBe(log)
    expect(compact(log, 99)).toBe(log)
  })
})

describe('Figure 13 — InstallSnapshot RPC, receiver implementation', () => {
  it('rule 1: replies immediately if term < currentTerm', () => {
    const follower = nodeWith({ currentTerm: 9, log: logOf(1, 1) })
    const result = step(
      follower,
      { type: 'message', message: installSnapshotRequest({ term: 4 }) },
      TEST_CONFIG,
    )
    expect(snapshotResponse(result).term).toBe(9)
    // Untouched: a stale leader may not install anything.
    expect(result.state.log.lastIncludedIndex).toBe(0)
    expect(terms(result.state.log)).toEqual([1, 1])
    expect(result.timers).toHaveLength(0)
  })

  it('rule 5: ignores a snapshot no further along than its own', () => {
    const follower = nodeWith({
      currentTerm: 5,
      log: compact(logOf(1, 1, 2, 2), 4),
      commitIndex: 4,
      lastApplied: 4,
    })
    const result = step(
      follower,
      { type: 'message', message: installSnapshotRequest({ lastIncludedIndex: 3 }) },
      TEST_CONFIG,
    )
    expect(result.state.log.lastIncludedIndex).toBe(4)
    expect(snapshotResponse(result).lastIncludedIndex).toBe(4)
  })

  it('rule 6: retains the suffix when the log agrees at the snapshot point', () => {
    // Follower holds indices 1..5; the snapshot covers 1..3 and its term matches.
    const follower = nodeWith({ currentTerm: 5, log: logOf(1, 1, 2, 2, 3) })
    const result = step(
      follower,
      {
        type: 'message',
        message: installSnapshotRequest({ lastIncludedIndex: 3, lastIncludedTerm: 2 }),
      },
      TEST_CONFIG,
    )
    expect(result.state.log.lastIncludedIndex).toBe(3)
    // Indices 4 and 5 survive: the follower was ahead of the snapshot, not behind it.
    expect(terms(result.state.log)).toEqual([2, 3])
    expect(lastLogIndex(result.state.log)).toBe(5)
  })

  it('rule 7: discards the entire log when it disagrees at the snapshot point', () => {
    // Same index 3, different term — so everything the follower holds is suspect.
    const follower = nodeWith({ currentTerm: 5, log: logOf(1, 1, 4, 4, 4) })
    const result = step(
      follower,
      {
        type: 'message',
        message: installSnapshotRequest({ lastIncludedIndex: 3, lastIncludedTerm: 2 }),
      },
      TEST_CONFIG,
    )
    expect(result.state.log.lastIncludedIndex).toBe(3)
    expect(heldEntries(result.state.log)).toHaveLength(0)
    expect(lastLogIndex(result.state.log)).toBe(3)
  })

  it('rule 7: discards the log when the follower is simply too far behind', () => {
    const follower = nodeWith({ currentTerm: 5, log: logOf(1) })
    const result = step(
      follower,
      { type: 'message', message: installSnapshotRequest({ lastIncludedIndex: 3 }) },
      TEST_CONFIG,
    )
    expect(result.state.log.lastIncludedIndex).toBe(3)
    expect(lastLogIndex(result.state.log)).toBe(3)
  })

  it('rule 8: resets the state machine from the snapshot contents', () => {
    const follower = nodeWith({ currentTerm: 5, log: logOf(1) })
    const result = step(
      follower,
      {
        type: 'message',
        message: installSnapshotRequest({ lastIncludedIndex: 3, data: ['x', 'y', 'z'] }),
      },
      TEST_CONFIG,
    )
    expect(result.state.stateMachine.slice(0, 3)).toEqual(['x', 'y', 'z'])
    // The snapshot is committed and applied by construction on the leader.
    expect(result.state.commitIndex).toBe(3)
    expect(result.state.lastApplied).toBe(3)
  })

  it('never moves commitIndex or lastApplied backwards', () => {
    const follower = nodeWith({
      currentTerm: 5,
      log: logOf(1, 1, 2, 2, 2),
      commitIndex: 5,
      lastApplied: 5,
    })
    const result = step(
      follower,
      { type: 'message', message: installSnapshotRequest({ lastIncludedIndex: 3 }) },
      TEST_CONFIG,
    )
    expect(result.state.commitIndex).toBe(5)
    expect(result.state.lastApplied).toBe(5)
  })

  it('resets the election timeout, because a snapshot proves a live leader', () => {
    const follower = nodeWith({ currentTerm: 5, log: logOf(1) })
    const result = step(
      follower,
      { type: 'message', message: installSnapshotRequest() },
      TEST_CONFIG,
    )
    expect(result.timers.some((timer) => timer.kind === 'election')).toBe(true)
    expect(result.state.leaderId).toBe(1)
    expect(result.state.role).toBe('follower')
  })

  it('adopts a higher term from the snapshot, as All Servers rule 2 requires', () => {
    const leader = nodeWith({ role: 'leader', currentTerm: 2, log: logOf(1) })
    const result = step(
      leader,
      { type: 'message', message: installSnapshotRequest({ term: 7 }) },
      TEST_CONFIG,
    )
    expect(result.state.currentTerm).toBe(7)
    expect(result.state.role).toBe('follower')
  })
})

describe('Figure 13 — the leader chooses between the two replication paths', () => {
  it('sends AppendEntries while it still holds what the follower needs', () => {
    const leader = nodeWith({
      role: 'leader',
      currentTerm: 5,
      log: compact(logOf(1, 1, 2, 2, 5), 2),
      nextIndex: [6, 3, 6, 6, 6],
      matchIndex: [5, 2, 0, 0, 0],
    })
    expect(needsSnapshot(leader, 1)).toBe(false)
    expect(buildReplication(leader, 1).type).toBe('AppendEntries')
  })

  it('sends InstallSnapshot once nextIndex falls into the discarded range', () => {
    const leader = nodeWith({
      role: 'leader',
      currentTerm: 5,
      log: compact(logOf(1, 1, 2, 2, 5), 3),
      nextIndex: [6, 2, 6, 6, 6],
      matchIndex: [5, 1, 0, 0, 0],
      stateMachine: ['c1', 'c2', 'c3', 'c4', 'c5'],
    })
    expect(needsSnapshot(leader, 1)).toBe(true)
    const message = buildReplication(leader, 1)
    expect(message.type).toBe('InstallSnapshot')
    if (message.type !== 'InstallSnapshot') throw new Error('unreachable')
    expect(message.lastIncludedIndex).toBe(3)
    expect(message.lastIncludedTerm).toBe(2)
    expect(message.data).toEqual(['c1', 'c2', 'c3'])
  })

  it('treats an installed snapshot as a match through its index', () => {
    const leader = nodeWith({
      role: 'leader',
      currentTerm: 5,
      log: compact(logOf(1, 1, 2, 2, 5), 3),
      nextIndex: [6, 1, 6, 6, 6],
      matchIndex: [5, 0, 0, 0, 0],
    })
    const result = step(
      leader,
      {
        type: 'message',
        message: {
          type: 'InstallSnapshotResponse',
          from: 1,
          to: 0,
          term: 5,
          lastIncludedIndex: 3,
        },
      },
      TEST_CONFIG,
    )
    expect(result.state.matchIndex[1]).toBe(3)
    expect(result.state.nextIndex[1]).toBe(4)
  })

  it('ignores a snapshot acknowledgement from another term', () => {
    const leader = nodeWith({
      role: 'leader',
      currentTerm: 5,
      log: compact(logOf(1, 1, 2), 2),
      nextIndex: [4, 1, 4, 4, 4],
      matchIndex: [3, 0, 0, 0, 0],
    })
    const result = step(
      leader,
      {
        type: 'message',
        message: {
          type: 'InstallSnapshotResponse',
          from: 1,
          to: 0,
          term: 4,
          lastIncludedIndex: 2,
        },
      },
      TEST_CONFIG,
    )
    expect(result.state.matchIndex[1]).toBe(0)
  })
})

describe('§7 — when a server compacts', () => {
  const compacting = configWith({ snapshotThreshold: 3 })

  it('does not compact at all when the threshold is 0', () => {
    const follower = nodeWith({ currentTerm: 3, log: logOf(1, 1, 1, 1, 1) })
    const result = step(
      follower,
      {
        type: 'message',
        message: {
          type: 'AppendEntries',
          from: 1,
          to: 0,
          term: 3,
          leaderId: 1,
          prevLogIndex: 5,
          prevLogTerm: 1,
          entries: [],
          leaderCommit: 5,
        },
      },
      TEST_CONFIG,
    )
    expect(result.state.lastApplied).toBe(5)
    expect(result.state.log.lastIncludedIndex).toBe(0)
  })

  it('compacts up to lastApplied once the threshold is reached', () => {
    const follower = nodeWith({ currentTerm: 3, log: logOf(1, 1, 1, 1, 1) })
    const result = step(
      follower,
      {
        type: 'message',
        message: {
          type: 'AppendEntries',
          from: 1,
          to: 0,
          term: 3,
          leaderId: 1,
          prevLogIndex: 5,
          prevLogTerm: 1,
          entries: [],
          leaderCommit: 4,
        },
      },
      compacting,
    )
    expect(result.state.lastApplied).toBe(4)
    // Never past what it has applied — the entry at index 5 is committed nowhere yet.
    expect(result.state.log.lastIncludedIndex).toBe(4)
    expect(lastLogIndex(result.state.log)).toBe(5)
    expect(heldEntries(result.state.log)).toHaveLength(1)
  })

  it('never discards an entry it has not applied', () => {
    // commitIndex is ahead of lastApplied only transiently, but the ceiling must be
    // lastApplied regardless: discarding an unapplied entry loses it from the log and
    // the state machine at once.
    const follower = nodeWith({
      currentTerm: 3,
      log: logOf(1, 1, 1, 1, 1),
      commitIndex: 5,
      lastApplied: 2,
    })
    const result = step(follower, { type: 'restart' }, compacting)
    // A restart resets lastApplied to 0, so nothing may be discarded at all.
    expect(result.state.log.lastIncludedIndex).toBe(0)
  })
})

describe('log helpers under compaction', () => {
  it('installSnapshot is a no-op for a stale snapshot', () => {
    const log = compact(logOf(1, 1, 2, 2), 3)
    expect(installSnapshot(log, 2, 1, allServers(5))).toBe(log)
  })

  it('an empty log reports index 0 and term 0', () => {
    expect(lastLogIndex(EMPTY_LOG)).toBe(0)
    expect(lastLogTerm(EMPTY_LOG)).toBe(0)
    expect(knowsTerm(EMPTY_LOG, 0)).toBe(true)
  })

  it('logFrom builds an uncompacted log from index 1', () => {
    const log = logFrom([{ term: 4, command: 'x' }])
    expect(log.lastIncludedIndex).toBe(0)
    expect(lastLogIndex(log)).toBe(1)
    expect(termAt(log, 1)).toBe(4)
  })
})
