import { describe, expect, it } from 'vitest'
import { step } from '@/lib/raft/node'
import { isAtLeastAsUpToDate } from '@/lib/raft/log'
import type { RequestVoteRequest, RequestVoteResponse } from '@/lib/raft/types'
import { TEST_CONFIG, logOf, nodeWith } from '../helpers/nodes'

/** Figure 2, RequestVote RPC — Arguments, Results, Receiver implementation. */

function requestVote(overrides: Partial<RequestVoteRequest> = {}): RequestVoteRequest {
  return {
    type: 'RequestVote',
    from: 1,
    to: 0,
    term: 2,
    candidateId: 1,
    lastLogIndex: 0,
    lastLogTerm: 0,
    ...overrides,
  }
}

function voteResponse(result: { outbox: readonly unknown[] }): RequestVoteResponse {
  const message = result.outbox[0]
  if (
    message === undefined ||
    typeof message !== 'object' ||
    (message as { type?: string }).type !== 'RequestVoteResponse'
  ) {
    throw new Error('expected a RequestVoteResponse')
  }
  return message as RequestVoteResponse
}

describe('Figure 2 — RequestVote RPC, receiver rule 1', () => {
  it('replies false if term < currentTerm (§5.1)', () => {
    const voter = nodeWith({ currentTerm: 5 })
    const result = step(voter, { type: 'message', message: requestVote({ term: 4 }) }, TEST_CONFIG)
    const response = voteResponse(result)
    expect(response.voteGranted).toBe(false)
    // The reply carries the receiver's term, so the stale candidate steps down.
    expect(response.term).toBe(5)
    expect(result.state.votedFor).toBeNull()
  })
})

describe('Figure 2 — RequestVote RPC, receiver rule 2', () => {
  it('grants the vote when votedFor is null and the log is up-to-date (§5.2, §5.4)', () => {
    const voter = nodeWith({ currentTerm: 2, votedFor: null })
    const result = step(voter, { type: 'message', message: requestVote() }, TEST_CONFIG)
    expect(voteResponse(result).voteGranted).toBe(true)
    expect(result.state.votedFor).toBe(1)
  })

  it('grants the vote again to the same candidate — RequestVote is idempotent', () => {
    const voter = nodeWith({ currentTerm: 2, votedFor: 1 })
    const result = step(voter, { type: 'message', message: requestVote() }, TEST_CONFIG)
    expect(voteResponse(result).voteGranted).toBe(true)
  })

  it('refuses a second candidate in the same term — one vote per term', () => {
    const voter = nodeWith({ currentTerm: 2, votedFor: 3 })
    const result = step(voter, { type: 'message', message: requestVote() }, TEST_CONFIG)
    expect(voteResponse(result).voteGranted).toBe(false)
    expect(result.state.votedFor).toBe(3)
  })

  it('refuses a candidate whose last log term is lower (§5.4.1)', () => {
    const voter = nodeWith({ currentTerm: 3, log: logOf(1, 2) })
    const message = requestVote({ term: 3, lastLogIndex: 5, lastLogTerm: 1 })
    const result = step(voter, { type: 'message', message }, TEST_CONFIG)
    // A longer log does not win. Last term is compared first.
    expect(voteResponse(result).voteGranted).toBe(false)
  })

  it('refuses a candidate with an equal last term but a shorter log (§5.4.1)', () => {
    const voter = nodeWith({ currentTerm: 3, log: logOf(1, 2, 2) })
    const message = requestVote({ term: 3, lastLogIndex: 2, lastLogTerm: 2 })
    expect(voteResponse(step(voter, { type: 'message', message }, TEST_CONFIG)).voteGranted).toBe(
      false,
    )
  })

  it('grants to a candidate with a higher last log term even if its log is shorter', () => {
    const voter = nodeWith({ currentTerm: 3, log: logOf(1, 1, 1, 1) })
    const message = requestVote({ term: 4, lastLogIndex: 2, lastLogTerm: 2 })
    expect(voteResponse(step(voter, { type: 'message', message }, TEST_CONFIG)).voteGranted).toBe(
      true,
    )
  })

  it('grants when logs are exactly equal', () => {
    const voter = nodeWith({ currentTerm: 3, log: logOf(1, 2) })
    const message = requestVote({ term: 3, lastLogIndex: 2, lastLogTerm: 2 })
    expect(voteResponse(step(voter, { type: 'message', message }, TEST_CONFIG)).voteGranted).toBe(
      true,
    )
  })

  it('resets the election timer on granting a vote (Followers rule 2)', () => {
    const voter = nodeWith({ currentTerm: 2 })
    const result = step(voter, { type: 'message', message: requestVote() }, TEST_CONFIG)
    expect(result.timers.some((t) => t.kind === 'election')).toBe(true)
  })

  it('does not reset the election timer on refusing a vote', () => {
    const voter = nodeWith({ currentTerm: 2, votedFor: 3 })
    const result = step(voter, { type: 'message', message: requestVote() }, TEST_CONFIG)
    expect(result.timers).toHaveLength(0)
  })
})

describe('§5.4.1 — "at least as up-to-date" compares last term, then index', () => {
  it('orders by last term first', () => {
    expect(isAtLeastAsUpToDate(2, 1, logOf(1, 1, 1, 1))).toBe(true)
    expect(isAtLeastAsUpToDate(1, 9, logOf(1, 2))).toBe(false)
  })

  it('orders by index only when last terms are equal', () => {
    expect(isAtLeastAsUpToDate(2, 3, logOf(1, 2, 2))).toBe(true)
    expect(isAtLeastAsUpToDate(2, 2, logOf(1, 2, 2))).toBe(false)
  })

  it('treats an empty log as term 0, index 0', () => {
    expect(isAtLeastAsUpToDate(0, 0, [])).toBe(true)
    expect(isAtLeastAsUpToDate(0, 0, logOf(1))).toBe(false)
    expect(isAtLeastAsUpToDate(1, 1, [])).toBe(true)
  })
})

describe('Figure 2 — Candidates rules', () => {
  it('rule 1: increments currentTerm, votes for self, resets the timer, sends RequestVote', () => {
    const follower = nodeWith({ currentTerm: 4 })
    const result = step(
      follower,
      { type: 'election-timeout', timerId: follower.electionTimerId },
      TEST_CONFIG,
    )
    expect(result.state.role).toBe('candidate')
    expect(result.state.currentTerm).toBe(5)
    expect(result.state.votedFor).toBe(0)
    expect(result.state.votesGranted[0]).toBe(true)
    expect(result.timers.filter((t) => t.kind === 'election')).toHaveLength(1)
    expect(result.outbox).toHaveLength(TEST_CONFIG.nodeCount - 1)
    for (const message of result.outbox) {
      expect(message.type).toBe('RequestVote')
      expect(message.term).toBe(5)
    }
  })

  it('rule 1: RequestVote carries the candidate last log index and term', () => {
    const follower = nodeWith({ currentTerm: 1, log: logOf(1, 1, 2) })
    const result = step(
      follower,
      { type: 'election-timeout', timerId: follower.electionTimerId },
      TEST_CONFIG,
    )
    const request = result.outbox[0]
    expect(request?.type).toBe('RequestVote')
    if (request?.type !== 'RequestVote') throw new Error('unreachable')
    expect(request.lastLogIndex).toBe(3)
    expect(request.lastLogTerm).toBe(2)
  })

  it('rule 2: becomes leader on a majority of votes, not before', () => {
    // 5 nodes: majority is 3. Self plus one is not enough.
    const candidate = nodeWith({
      role: 'candidate',
      currentTerm: 3,
      votedFor: 0,
      votesGranted: [true, false, false, false, false],
    })
    const first = step(
      candidate,
      {
        type: 'message',
        message: { type: 'RequestVoteResponse', from: 1, to: 0, term: 3, voteGranted: true },
      },
      TEST_CONFIG,
    )
    expect(first.state.role).toBe('candidate')

    const second = step(
      first.state,
      {
        type: 'message',
        message: { type: 'RequestVoteResponse', from: 2, to: 0, term: 3, voteGranted: true },
      },
      TEST_CONFIG,
    )
    expect(second.state.role).toBe('leader')
  })

  it('rule 2: ignores a vote granted in an earlier term', () => {
    const candidate = nodeWith({
      role: 'candidate',
      currentTerm: 5,
      votesGranted: [true, false, false, false, false],
    })
    const result = step(
      candidate,
      {
        type: 'message',
        message: { type: 'RequestVoteResponse', from: 1, to: 0, term: 4, voteGranted: true },
      },
      TEST_CONFIG,
    )
    expect(result.state.votesGranted[1]).toBe(false)
    expect(result.state.role).toBe('candidate')
  })

  it('rule 3: converts to follower on AppendEntries from a new leader', () => {
    const candidate = nodeWith({ role: 'candidate', currentTerm: 3, votedFor: 0 })
    const result = step(
      candidate,
      {
        type: 'message',
        message: {
          type: 'AppendEntries',
          from: 1,
          to: 0,
          term: 3,
          leaderId: 1,
          prevLogIndex: 0,
          prevLogTerm: 0,
          entries: [],
          leaderCommit: 0,
        },
      },
      TEST_CONFIG,
    )
    expect(result.state.role).toBe('follower')
    expect(result.state.leaderId).toBe(1)
  })

  it('rule 4: a repeated election timeout starts a fresh election in a new term', () => {
    const candidate = nodeWith({ role: 'candidate', currentTerm: 3, votedFor: 0 })
    const result = step(
      candidate,
      { type: 'election-timeout', timerId: candidate.electionTimerId },
      TEST_CONFIG,
    )
    expect(result.state.currentTerm).toBe(4)
    expect(result.state.role).toBe('candidate')
    expect(result.state.votesGranted.filter(Boolean)).toHaveLength(1)
  })

  it('ignores an election timeout from a stale generation', () => {
    const follower = nodeWith({ currentTerm: 4, electionTimerId: 7 })
    const result = step(follower, { type: 'election-timeout', timerId: 3 }, TEST_CONFIG)
    expect(result.state.currentTerm).toBe(4)
    expect(result.state.role).toBe('follower')
    expect(result.outbox).toHaveLength(0)
  })
})
