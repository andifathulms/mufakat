import { describe, expect, it } from 'vitest'
import { step } from '@/lib/raft/node'
import type { AppendEntriesRequest, AppendEntriesResponse } from '@/lib/raft/types'
import { TEST_CONFIG, logOf, nodeWith } from '../helpers/nodes'

/** Figure 2, AppendEntries RPC — Arguments, Results, Receiver implementation. */

function appendEntries(overrides: Partial<AppendEntriesRequest> = {}): AppendEntriesRequest {
  return {
    type: 'AppendEntries',
    from: 1,
    to: 0,
    term: 2,
    leaderId: 1,
    prevLogIndex: 0,
    prevLogTerm: 0,
    entries: [],
    leaderCommit: 0,
    ...overrides,
  }
}

function appendResponse(result: { outbox: readonly unknown[] }): AppendEntriesResponse {
  const message = result.outbox[0]
  if (
    message === undefined ||
    typeof message !== 'object' ||
    (message as { type?: string }).type !== 'AppendEntriesResponse'
  ) {
    throw new Error('expected an AppendEntriesResponse')
  }
  return message as AppendEntriesResponse
}

const terms = (log: readonly { term: number }[]): number[] => log.map((e) => e.term)

describe('Figure 2 — AppendEntries RPC, receiver rule 1', () => {
  it('replies false if term < currentTerm (§5.1)', () => {
    const follower = nodeWith({ currentTerm: 5, log: logOf(1, 2) })
    const result = step(
      follower,
      { type: 'message', message: appendEntries({ term: 3 }) },
      TEST_CONFIG,
    )
    const response = appendResponse(result)
    expect(response.success).toBe(false)
    expect(response.term).toBe(5)
    // A stale leader must not disturb the follower's log or its election timer.
    expect(terms(result.state.log)).toEqual([1, 2])
    expect(result.timers).toHaveLength(0)
  })
})

describe('Figure 2 — AppendEntries RPC, receiver rule 2', () => {
  it('replies false when the log has no entry at prevLogIndex (§5.3)', () => {
    const follower = nodeWith({ currentTerm: 2, log: logOf(1) })
    const result = step(
      follower,
      { type: 'message', message: appendEntries({ prevLogIndex: 3, prevLogTerm: 1 }) },
      TEST_CONFIG,
    )
    expect(appendResponse(result).success).toBe(false)
  })

  it('replies false when the term at prevLogIndex does not match (§5.3)', () => {
    const follower = nodeWith({ currentTerm: 4, log: logOf(1, 2, 2) })
    const result = step(
      follower,
      {
        type: 'message',
        message: appendEntries({ term: 4, prevLogIndex: 3, prevLogTerm: 3, entries: logOf(4) }),
      },
      TEST_CONFIG,
    )
    expect(appendResponse(result).success).toBe(false)
    // Rejection alone must not truncate — the leader decides what to overwrite.
    expect(terms(result.state.log)).toEqual([1, 2, 2])
  })

  it('accepts at prevLogIndex 0, which every log matches', () => {
    const follower = nodeWith({ currentTerm: 2, log: [] })
    const result = step(
      follower,
      { type: 'message', message: appendEntries({ entries: logOf(2, 2) }) },
      TEST_CONFIG,
    )
    expect(appendResponse(result).success).toBe(true)
    expect(terms(result.state.log)).toEqual([2, 2])
  })
})

describe('Figure 2 — AppendEntries RPC, receiver rules 3 and 4', () => {
  it('deletes a conflicting entry and everything after it (§5.3)', () => {
    const follower = nodeWith({ currentTerm: 6, log: logOf(1, 2, 3, 3, 3) })
    const result = step(
      follower,
      {
        type: 'message',
        message: appendEntries({ term: 6, prevLogIndex: 2, prevLogTerm: 2, entries: logOf(6) }),
      },
      TEST_CONFIG,
    )
    expect(appendResponse(result).success).toBe(true)
    expect(terms(result.state.log)).toEqual([1, 2, 6])
  })

  it('appends new entries past the end of the log', () => {
    const follower = nodeWith({ currentTerm: 3, log: logOf(1, 1) })
    const result = step(
      follower,
      {
        type: 'message',
        message: appendEntries({ term: 3, prevLogIndex: 2, prevLogTerm: 1, entries: logOf(3, 3) }),
      },
      TEST_CONFIG,
    )
    expect(terms(result.state.log)).toEqual([1, 1, 3, 3])
    expect(appendResponse(result).matchIndex).toBe(4)
  })

  it('does not truncate on a delayed duplicate that carries entries it already has', () => {
    // Raft must tolerate duplicate delivery: truncating here would delete entries the
    // leader already counts as replicated, and could un-commit a committed entry.
    const follower = nodeWith({ currentTerm: 3, log: logOf(1, 3, 3, 3) })
    const result = step(
      follower,
      {
        type: 'message',
        message: appendEntries({ term: 3, prevLogIndex: 1, prevLogTerm: 1, entries: logOf(3) }),
      },
      TEST_CONFIG,
    )
    expect(appendResponse(result).success).toBe(true)
    expect(terms(result.state.log)).toEqual([1, 3, 3, 3])
  })

  it('keeps entries that match and appends only the genuinely new tail', () => {
    const follower = nodeWith({ currentTerm: 5, log: logOf(1, 2, 2) })
    const result = step(
      follower,
      {
        type: 'message',
        message: appendEntries({
          term: 5,
          prevLogIndex: 1,
          prevLogTerm: 1,
          entries: logOf(2, 2, 5, 5),
        }),
      },
      TEST_CONFIG,
    )
    expect(terms(result.state.log)).toEqual([1, 2, 2, 5, 5])
  })
})

describe('Figure 2 — AppendEntries RPC, receiver rule 5', () => {
  it('sets commitIndex to min(leaderCommit, index of last new entry)', () => {
    const follower = nodeWith({ currentTerm: 3, log: logOf(1) })
    const result = step(
      follower,
      {
        type: 'message',
        message: appendEntries({
          term: 3,
          prevLogIndex: 1,
          prevLogTerm: 1,
          entries: logOf(3, 3),
          leaderCommit: 9,
        }),
      },
      TEST_CONFIG,
    )
    // leaderCommit outruns what this RPC established: clamp to index 3.
    expect(result.state.commitIndex).toBe(3)
  })

  it('takes leaderCommit when it is the smaller of the two', () => {
    const follower = nodeWith({ currentTerm: 3, log: logOf(1) })
    const result = step(
      follower,
      {
        type: 'message',
        message: appendEntries({
          term: 3,
          prevLogIndex: 1,
          prevLogTerm: 1,
          entries: logOf(3, 3),
          leaderCommit: 2,
        }),
      },
      TEST_CONFIG,
    )
    expect(result.state.commitIndex).toBe(2)
  })

  it('never lowers commitIndex', () => {
    const follower = nodeWith({ currentTerm: 3, log: logOf(1, 1, 1), commitIndex: 3, lastApplied: 3 })
    const result = step(
      follower,
      {
        type: 'message',
        message: appendEntries({ term: 3, prevLogIndex: 3, prevLogTerm: 1, leaderCommit: 1 }),
      },
      TEST_CONFIG,
    )
    expect(result.state.commitIndex).toBe(3)
  })

  it('advances commitIndex on a heartbeat, clamped to prevLogIndex', () => {
    const follower = nodeWith({ currentTerm: 3, log: logOf(1, 1, 1) })
    const result = step(
      follower,
      {
        type: 'message',
        message: appendEntries({ term: 3, prevLogIndex: 2, prevLogTerm: 1, leaderCommit: 3 }),
      },
      TEST_CONFIG,
    )
    // The heartbeat only established agreement through index 2.
    expect(result.state.commitIndex).toBe(2)
  })
})

describe('Figure 2 — Leaders rules', () => {
  it('rule 1: on election, sends an empty AppendEntries to every other server', () => {
    const candidate = nodeWith({
      role: 'candidate',
      currentTerm: 2,
      log: logOf(1, 1),
      votesGranted: [true, true, false, false, false],
    })
    const result = step(
      candidate,
      {
        type: 'message',
        message: { type: 'RequestVoteResponse', from: 2, to: 0, term: 2, voteGranted: true },
      },
      TEST_CONFIG,
    )
    expect(result.state.role).toBe('leader')
    expect(result.outbox).toHaveLength(4)
    for (const message of result.outbox) {
      expect(message.type).toBe('AppendEntries')
      if (message.type !== 'AppendEntries') throw new Error('unreachable')
      expect(message.entries).toHaveLength(0)
      expect(message.prevLogIndex).toBe(2)
    }
    expect(result.timers.filter((t) => t.kind === 'heartbeat')).toHaveLength(1)
  })

  it('rule 1: reinitialises nextIndex to last log index + 1 and matchIndex to 0', () => {
    const candidate = nodeWith({
      role: 'candidate',
      currentTerm: 2,
      log: logOf(1, 1, 1),
      votesGranted: [true, true, false, false, false],
    })
    const result = step(
      candidate,
      {
        type: 'message',
        message: { type: 'RequestVoteResponse', from: 2, to: 0, term: 2, voteGranted: true },
      },
      TEST_CONFIG,
    )
    expect(result.state.nextIndex).toEqual([4, 4, 4, 4, 4])
    // The leader's own matchIndex reflects its log, so commit counting is uniform.
    expect(result.state.matchIndex).toEqual([3, 0, 0, 0, 0])
  })

  it('rule 2: appends a client command at the leader current term', () => {
    const leader = nodeWith({ role: 'leader', currentTerm: 4, log: logOf(1, 2) })
    const result = step(leader, { type: 'client-request', command: 'set x=1' }, TEST_CONFIG)
    expect(terms(result.state.log)).toEqual([1, 2, 4])
    expect(result.state.log[2]?.command).toBe('set x=1')
  })

  it('rule 2: a non-leader does not append a client command', () => {
    const follower = nodeWith({ role: 'follower', currentTerm: 4 })
    const result = step(follower, { type: 'client-request', command: 'set x=1' }, TEST_CONFIG)
    expect(result.state.log).toHaveLength(0)
    expect(result.outbox).toHaveLength(0)
  })

  it('rule 3: sends entries from nextIndex', () => {
    const leader = nodeWith({
      role: 'leader',
      currentTerm: 3,
      log: logOf(1, 2, 3, 3),
      nextIndex: [5, 3, 5, 5, 5],
      matchIndex: [4, 2, 0, 0, 0],
    })
    const result = step(
      leader,
      { type: 'heartbeat-timeout', timerId: leader.heartbeatTimerId },
      TEST_CONFIG,
    )
    const toOne = result.outbox.find((m) => m.to === 1)
    expect(toOne?.type).toBe('AppendEntries')
    if (toOne?.type !== 'AppendEntries') throw new Error('unreachable')
    expect(toOne.prevLogIndex).toBe(2)
    expect(toOne.prevLogTerm).toBe(2)
    expect(terms(toOne.entries)).toEqual([3, 3])
  })

  it('rule 3: on success, updates nextIndex and matchIndex', () => {
    const leader = nodeWith({
      role: 'leader',
      currentTerm: 3,
      log: logOf(1, 2, 3),
      nextIndex: [4, 2, 4, 4, 4],
      matchIndex: [3, 1, 0, 0, 0],
    })
    const result = step(
      leader,
      {
        type: 'message',
        message: {
          type: 'AppendEntriesResponse',
          from: 1,
          to: 0,
          term: 3,
          success: true,
          matchIndex: 3,
        },
      },
      TEST_CONFIG,
    )
    expect(result.state.matchIndex[1]).toBe(3)
    expect(result.state.nextIndex[1]).toBe(4)
  })

  it('rule 3: a delayed duplicate success never moves matchIndex backwards', () => {
    const leader = nodeWith({
      role: 'leader',
      currentTerm: 3,
      log: logOf(1, 2, 3),
      nextIndex: [4, 4, 4, 4, 4],
      matchIndex: [3, 3, 0, 0, 0],
    })
    const result = step(
      leader,
      {
        type: 'message',
        message: {
          type: 'AppendEntriesResponse',
          from: 1,
          to: 0,
          term: 3,
          success: true,
          matchIndex: 1,
        },
      },
      TEST_CONFIG,
    )
    expect(result.state.matchIndex[1]).toBe(3)
  })

  it('rule 3: on failure, walks nextIndex back and retries', () => {
    const leader = nodeWith({
      role: 'leader',
      currentTerm: 3,
      log: logOf(1, 2, 3),
      nextIndex: [4, 3, 4, 4, 4],
      matchIndex: [3, 0, 0, 0, 0],
    })
    const result = step(
      leader,
      {
        type: 'message',
        message: {
          type: 'AppendEntriesResponse',
          from: 1,
          to: 0,
          term: 3,
          success: false,
          matchIndex: 1,
        },
      },
      TEST_CONFIG,
    )
    expect(result.state.nextIndex[1]).toBe(2)
    expect(result.outbox).toHaveLength(1)
    expect(result.outbox[0]?.type).toBe('AppendEntries')
  })

  it('rule 3: nextIndex never walks below 1', () => {
    const leader = nodeWith({
      role: 'leader',
      currentTerm: 3,
      log: logOf(1, 2, 3),
      nextIndex: [4, 1, 4, 4, 4],
      matchIndex: [3, 0, 0, 0, 0],
    })
    const result = step(
      leader,
      {
        type: 'message',
        message: {
          type: 'AppendEntriesResponse',
          from: 1,
          to: 0,
          term: 3,
          success: false,
          matchIndex: 0,
        },
      },
      TEST_CONFIG,
    )
    expect(result.state.nextIndex[1]).toBe(1)
  })

  it('final rule: commits index N when a majority holds it and log[N].term == currentTerm', () => {
    const leader = nodeWith({
      role: 'leader',
      currentTerm: 3,
      log: logOf(1, 3),
      nextIndex: [3, 3, 3, 3, 3],
      matchIndex: [2, 2, 0, 0, 0],
    })
    const result = step(
      leader,
      {
        type: 'message',
        message: {
          type: 'AppendEntriesResponse',
          from: 2,
          to: 0,
          term: 3,
          success: true,
          matchIndex: 2,
        },
      },
      TEST_CONFIG,
    )
    // Three of five hold index 2, whose term is the leader's own.
    expect(result.state.commitIndex).toBe(2)
    // Committing index 2 carries index 1 with it.
    expect(result.applied.map((a) => a.index)).toEqual([1, 2])
  })

  it('final rule: refuses to commit an entry from an earlier term by replica count (§5.4.2)', () => {
    const leader = nodeWith({
      role: 'leader',
      currentTerm: 4,
      log: logOf(1, 2),
      nextIndex: [3, 3, 3, 3, 3],
      matchIndex: [2, 2, 0, 0, 0],
    })
    const result = step(
      leader,
      {
        type: 'message',
        message: {
          type: 'AppendEntriesResponse',
          from: 2,
          to: 0,
          term: 4,
          success: true,
          matchIndex: 2,
        },
      },
      TEST_CONFIG,
    )
    // A majority holds index 2, but its term is 2, not 4. This is Figure 8.
    expect(result.state.commitIndex).toBe(0)
  })

  it('final rule: committing a current-term entry commits everything before it', () => {
    const leader = nodeWith({
      role: 'leader',
      currentTerm: 4,
      log: logOf(1, 2, 4),
      nextIndex: [4, 4, 4, 4, 4],
      matchIndex: [3, 3, 0, 0, 0],
    })
    const result = step(
      leader,
      {
        type: 'message',
        message: {
          type: 'AppendEntriesResponse',
          from: 2,
          to: 0,
          term: 4,
          success: true,
          matchIndex: 3,
        },
      },
      TEST_CONFIG,
    )
    expect(result.state.commitIndex).toBe(3)
  })
})

describe('Figure 2 — All Servers rules', () => {
  it('rule 1: applies committed entries in index order', () => {
    const follower = nodeWith({ currentTerm: 3, log: logOf(1, 1, 3) })
    const result = step(
      follower,
      {
        type: 'message',
        message: appendEntries({ term: 3, prevLogIndex: 3, prevLogTerm: 3, leaderCommit: 3 }),
      },
      TEST_CONFIG,
    )
    expect(result.state.lastApplied).toBe(3)
    expect(result.applied.map((a) => a.index)).toEqual([1, 2, 3])
    expect(result.state.stateMachine).toEqual(['c1', 'c2', 'c3'])
  })

  it('rule 2: adopts a higher term from a request and reverts to follower (§5.1)', () => {
    const leader = nodeWith({ role: 'leader', currentTerm: 2, votedFor: 0 })
    const result = step(
      leader,
      { type: 'message', message: appendEntries({ term: 7, leaderId: 1 }) },
      TEST_CONFIG,
    )
    expect(result.state.currentTerm).toBe(7)
    expect(result.state.role).toBe('follower')
  })

  it('rule 2: adopts a higher term from a *response* and reverts to follower', () => {
    const leader = nodeWith({ role: 'leader', currentTerm: 2 })
    const result = step(
      leader,
      {
        type: 'message',
        message: {
          type: 'AppendEntriesResponse',
          from: 3,
          to: 0,
          term: 9,
          success: false,
          matchIndex: 0,
        },
      },
      TEST_CONFIG,
    )
    expect(result.state.currentTerm).toBe(9)
    expect(result.state.role).toBe('follower')
    expect(result.state.votedFor).toBeNull()
    // A demoted leader must start counting down, or it never campaigns again.
    expect(result.timers.filter((t) => t.kind === 'election')).toHaveLength(1)
  })

  it('rule 2: leaves the term alone when the incoming term is not higher', () => {
    const leader = nodeWith({ role: 'leader', currentTerm: 5, votedFor: 0 })
    const result = step(
      leader,
      { type: 'heartbeat-timeout', timerId: leader.heartbeatTimerId },
      TEST_CONFIG,
    )
    expect(result.state.role).toBe('leader')
    expect(result.state.currentTerm).toBe(5)
  })
})

describe('Figure 2 — State: persistence across a restart', () => {
  it('keeps currentTerm, votedFor and the log; reinitialises volatile state', () => {
    const leader = nodeWith({
      role: 'leader',
      currentTerm: 6,
      votedFor: 0,
      log: logOf(1, 2, 6),
      commitIndex: 3,
      lastApplied: 3,
      matchIndex: [3, 3, 3, 0, 0],
    })
    const result = step(leader, { type: 'restart' }, TEST_CONFIG)
    expect(result.state.currentTerm).toBe(6)
    expect(result.state.votedFor).toBe(0)
    expect(terms(result.state.log)).toEqual([1, 2, 6])
    expect(result.state.role).toBe('follower')
    expect(result.state.commitIndex).toBe(0)
    expect(result.state.lastApplied).toBe(0)
    expect(result.state.matchIndex).toEqual([0, 0, 0, 0, 0])
    expect(result.timers.filter((t) => t.kind === 'election')).toHaveLength(1)
  })
})
