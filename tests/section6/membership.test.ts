import { describe, expect, it } from 'vitest'
import {
  allServers,
  hasQuorum,
  isMember,
  jointConfiguration,
  members,
  replicationTargets,
  simpleConfiguration,
  targetOf,
} from '@/lib/raft/configuration'
import { configurationOf, heldEntries, lastLogIndex, logFrom } from '@/lib/raft/log'
import { step } from '@/lib/raft/node'
import { transitionInProgress } from '@/lib/raft/replication'
import { TEST_CONFIG, configWith, nodeWith } from '../helpers/nodes'

/**
 * §6 — cluster membership changes.
 *
 * The section has one argument and three loose ends. The argument is joint consensus,
 * and Figure 10 is the picture of what happens without it. The loose ends are new
 * servers arriving empty, a leader that removes itself, and removed servers disrupting
 * the cluster. All four are below.
 */

describe('§6 — quorum arithmetic', () => {
  it('a simple configuration needs a strict majority', () => {
    const three = simpleConfiguration([0, 1, 2])
    expect(hasQuorum(three, (id) => [0].includes(id))).toBe(false)
    expect(hasQuorum(three, (id) => [0, 1].includes(id))).toBe(true)
    const four = simpleConfiguration([0, 1, 2, 3])
    expect(hasQuorum(four, (id) => [0, 1].includes(id))).toBe(false)
    expect(hasQuorum(four, (id) => [0, 1, 2].includes(id))).toBe(true)
  })

  it('counts only servers that are members', () => {
    const configuration = simpleConfiguration([0, 1, 2])
    // Nodes 3 and 4 exist but are not in the cluster; their agreement is worth nothing.
    expect(hasQuorum(configuration, (id) => [0, 3, 4].includes(id))).toBe(false)
  })

  it('a joint configuration needs a majority of BOTH halves — this is the whole rule', () => {
    const joint = jointConfiguration([0, 1, 2], [2, 3, 4])
    // A majority of the old set alone is not agreement.
    expect(hasQuorum(joint, (id) => [0, 1].includes(id))).toBe(false)
    // Nor is a majority of the new set alone.
    expect(hasQuorum(joint, (id) => [3, 4].includes(id))).toBe(false)
    // Both together is.
    expect(hasQuorum(joint, (id) => [0, 1, 2, 3].includes(id))).toBe(true)
  })

  it('Figure 10: the two halves can hold disjoint majorities', () => {
    // {0,1} is a majority of {0,1,2}; {3,4} is a majority of {2,3,4}; they share nobody.
    // Under two *simple* configurations both would succeed — two leaders, one term.
    const oldConfiguration = simpleConfiguration([0, 1, 2])
    const newConfiguration = simpleConfiguration([2, 3, 4])
    expect(hasQuorum(oldConfiguration, (id) => [0, 1].includes(id))).toBe(true)
    expect(hasQuorum(newConfiguration, (id) => [3, 4].includes(id))).toBe(true)

    // The joint configuration is exactly what removes that possibility.
    const joint = jointConfiguration([0, 1, 2], [2, 3, 4])
    expect(hasQuorum(joint, (id) => [0, 1].includes(id))).toBe(false)
    expect(hasQuorum(joint, (id) => [3, 4].includes(id))).toBe(false)
  })

  it('a joint configuration includes servers on their way out', () => {
    const joint = jointConfiguration([0, 1, 2], [2, 3, 4])
    expect(members(joint)).toEqual([0, 1, 2, 3, 4])
    // Node 0 is being removed and is still a full member until C-new commits.
    expect(isMember(joint, 0)).toBe(true)
    expect(replicationTargets(joint, 2)).toEqual([0, 1, 3, 4])
  })

  it('resolves to the new set', () => {
    expect(targetOf(jointConfiguration([0, 1, 2], [2, 3, 4]))).toEqual(
      simpleConfiguration([2, 3, 4]),
    )
  })
})

describe('§6 — the configuration lives in the log', () => {
  it('takes effect on append, not on commit', () => {
    const leader = nodeWith({
      role: 'leader',
      currentTerm: 3,
      log: logFrom([{ term: 1, command: 'a' }], allServers(3)),
      commitIndex: 1,
      lastApplied: 1,
      matchIndex: [1, 1, 1, 0, 0],
      nextIndex: [2, 2, 2, 2, 2],
    })
    const result = step(leader, { type: 'change-configuration', servers: [0, 1, 2, 3] }, TEST_CONFIG)

    // The entry is appended and nothing has committed it, yet the server is already
    // using it. Waiting for commitment would be circular: the configuration is what
    // decides which servers form the majority that would commit it.
    expect(result.state.commitIndex).toBe(1)
    const configuration = configurationOf(result.state.log)
    expect(configuration.type).toBe('joint')
    expect(members(configuration)).toEqual([0, 1, 2, 3])
  })

  it('survives a restart, because the log does', () => {
    const leader = nodeWith({
      role: 'leader',
      currentTerm: 3,
      log: logFrom([{ term: 1, command: 'a' }], allServers(3)),
      commitIndex: 1,
      lastApplied: 1,
    })
    const changed = step(leader, { type: 'change-configuration', servers: [0, 1, 2, 3] }, TEST_CONFIG)
    const rebooted = step(changed.state, { type: 'restart' }, TEST_CONFIG)
    expect(members(configurationOf(rebooted.state.log))).toEqual([0, 1, 2, 3])
  })

  it('a snapshot carries the configuration, or a compacted server would forget it', () => {
    const compacting = configWith({ snapshotThreshold: 1 })
    const leader = nodeWith({
      role: 'leader',
      currentTerm: 3,
      log: logFrom([{ term: 1, command: 'a' }], simpleConfiguration([0, 1, 2])),
      commitIndex: 1,
      lastApplied: 0,
      matchIndex: [1, 1, 1, 0, 0],
    })
    // Applying index 1 crosses the threshold, so the server compacts it away.
    const settled = step(leader, { type: 'heartbeat-timeout', timerId: leader.heartbeatTimerId }, compacting)
    expect(settled.state.log.lastIncludedIndex).toBe(1)
    expect(heldEntries(settled.state.log)).toHaveLength(0)
    // The entries are gone and the cluster is not.
    expect(members(configurationOf(settled.state.log))).toEqual([0, 1, 2])
  })
})

describe('§6 — one change at a time', () => {
  it('refuses a second change while the first is still in flight', () => {
    const leader = nodeWith({
      role: 'leader',
      currentTerm: 3,
      log: logFrom([{ term: 1, command: 'a' }], allServers(3)),
      commitIndex: 1,
      lastApplied: 1,
    })
    const first = step(leader, { type: 'change-configuration', servers: [0, 1, 2, 3] }, TEST_CONFIG)
    expect(transitionInProgress(first.state)).toBe(true)
    const second = step(first.state, { type: 'change-configuration', servers: [0, 1] }, TEST_CONFIG)
    // Unchanged: overlapping changes are what §6 forbids, and the refusal is silent
    // because there is no client to tell — the request simply does not take.
    expect(lastLogIndex(second.state.log)).toBe(lastLogIndex(first.state.log))
    expect(members(configurationOf(second.state.log))).toEqual([0, 1, 2, 3])
  })

  it('refuses a change that is not a change, and refuses an empty cluster', () => {
    const leader = nodeWith({
      role: 'leader',
      currentTerm: 3,
      log: logFrom([{ term: 1, command: 'a' }], simpleConfiguration([0, 1, 2])),
      commitIndex: 1,
      lastApplied: 1,
    })
    expect(
      lastLogIndex(step(leader, { type: 'change-configuration', servers: [2, 1, 0] }, TEST_CONFIG).state.log),
    ).toBe(1)
    expect(
      lastLogIndex(step(leader, { type: 'change-configuration', servers: [] }, TEST_CONFIG).state.log),
    ).toBe(1)
  })

  it('only a leader starts one', () => {
    const follower = nodeWith({
      currentTerm: 3,
      log: logFrom([{ term: 1, command: 'a' }], allServers(3)),
    })
    const result = step(follower, { type: 'change-configuration', servers: [0, 1] }, TEST_CONFIG)
    expect(lastLogIndex(result.state.log)).toBe(1)
  })
})

describe('§6, third issue — removed servers must not disrupt the cluster', () => {
  const appendEntries = (term: number) =>
    ({
      type: 'AppendEntries' as const,
      from: 1,
      to: 0,
      term,
      leaderId: 1,
      prevLogIndex: 0,
      prevLogTerm: 0,
      entries: [],
      leaderCommit: 0,
    })

  const requestVote = (term: number) =>
    ({
      type: 'RequestVote' as const,
      from: 2,
      to: 0,
      term,
      candidateId: 2,
      lastLogIndex: 0,
      lastLogTerm: 0,
    })

  it('a server that has heard from a leader disregards RequestVote entirely', () => {
    const follower = nodeWith({ currentTerm: 2 })
    const heard = step(follower, { type: 'message', message: appendEntries(2) }, TEST_CONFIG)
    expect(heard.state.heardFromLeader).toBe(true)

    // A candidate arrives with a *higher* term. Disregarded means disregarded: no vote,
    // and — the part that matters — no term adoption either. Adopting it would depose
    // the healthy leader on every attempt, which is the disruption itself.
    const result = step(heard.state, { type: 'message', message: requestVote(9) }, TEST_CONFIG)
    expect(result.state.currentTerm).toBe(2)
    expect(result.state.votedFor).toBeNull()
    const reply = result.outbox[0]
    expect(reply?.type).toBe('RequestVoteResponse')
    if (reply?.type !== 'RequestVoteResponse') throw new Error('unreachable')
    expect(reply.voteGranted).toBe(false)
    expect(reply.term).toBe(2)
  })

  it('stops disregarding once its own election timer fires', () => {
    const follower = nodeWith({ currentTerm: 2 })
    const heard = step(follower, { type: 'message', message: appendEntries(2) }, TEST_CONFIG)
    // The timer firing is what ends the window — the server has now waited a full
    // election timeout without hearing anything.
    const timedOut = step(
      heard.state,
      { type: 'election-timeout', timerId: heard.state.electionTimerId },
      TEST_CONFIG,
    )
    expect(timedOut.state.heardFromLeader).toBe(false)
  })

  it('a leader never disregards, or two leaders could coexist', () => {
    const leader = nodeWith({ role: 'leader', currentTerm: 2, heardFromLeader: true })
    const result = step(leader, { type: 'message', message: requestVote(9) }, TEST_CONFIG)
    // All Servers rule 2 still applies to it.
    expect(result.state.currentTerm).toBe(9)
    expect(result.state.role).toBe('follower')
  })

  it('a restart clears the belief, because nothing has been heard since', () => {
    const follower = nodeWith({ currentTerm: 2 })
    const heard = step(follower, { type: 'message', message: appendEntries(2) }, TEST_CONFIG)
    const rebooted = step(heard.state, { type: 'restart' }, TEST_CONFIG)
    expect(rebooted.state.heardFromLeader).toBe(false)
  })
})
