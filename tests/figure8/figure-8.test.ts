import { describe, expect, it } from 'vitest'
import { UNMODIFIED_RAFT } from '@/lib/raft/rules'
import type { NodeState, RaftConfig } from '@/lib/raft/types'
import { logFrom, heldEntries } from '@/lib/raft/log'
import { createNode } from '@/lib/raft/node'
import { Director } from '../helpers/director'

/**
 * Figure 8 of the Raft paper, reproduced move for move.
 *
 * The figure is the argument for the current-term commit rule (§5.4.2): a leader must
 * not declare an entry from an *earlier* term committed on the strength of a replica
 * count, because such an entry can still be overwritten. It is presented as a static
 * five-panel diagram that most readers do not fully absorb. Here it is a test, and in
 * the app it is a button.
 *
 * The panels, using the paper's names S1..S5 (nodes 0..4 here):
 *
 *   (a) S1 is leader of term 2 and has partially replicated index 2 to S2.
 *   (b) S1 crashes. S5 is elected leader of term 5 [sic: term 3 in the extended
 *       version's panel (b)] with votes from S3, S4 and itself, and accepts a
 *       different entry at index 2.
 *   (c) S5 crashes. S1 restarts, is elected leader of term 4, and continues
 *       replicating index 2 — which now sits on a majority.
 *   (d) S1 crashes. S5 is elected leader again, and overwrites index 2 everywhere.
 *   (e) Had S1 replicated an entry from its *own* term before crashing, that entry
 *       would have committed and S5 could never have won the election in (d).
 *
 * Panel (c) is the hazard: index 2 is on a majority, and it is still not safe.
 */

const CONFIG: RaftConfig = {
  nodeCount: 5,
  electionTimeoutMin: 150,
  electionTimeoutMax: 300,
  heartbeatInterval: 50,
  flags: UNMODIFIED_RAFT,
  snapshotThreshold: 0,
}

const S1 = 0
const S2 = 1
const S3 = 2
const S4 = 3
const S5 = 4
const ALL = [S1, S2, S3, S4, S5]

/**
 * Panel (a): S1 is leader of term 2. Index 1 (term 1) is on everyone and committed;
 * index 2 (term 2) has reached S2 only.
 */
function panelA(config: RaftConfig): NodeState[] {
  const base = (id: number): NodeState => ({
    ...createNode(id, 5, 20_140_000 + id),
    currentTerm: 2,
    votedFor: S1,
    log: logFrom([{ term: 1, command: 'a' }]),
    commitIndex: 1,
    lastApplied: 1,
    stateMachine: ['a'],
  })

  const nodes = ALL.map(base)
  const withEntry = (node: NodeState): NodeState => ({
    ...node,
    log: logFrom([...heldEntries(node.log), { term: 2, command: 'b' }]),
  })

  nodes[S1] = {
    ...withEntry(base(S1)),
    role: 'leader',
    leaderId: S1,
    nextIndex: [3, 3, 2, 2, 2],
    // Index 2 is on S1 and S2 only — two of five, short of a majority.
    matchIndex: [2, 2, 1, 1, 1],
  }
  nodes[S2] = withEntry(base(S2))
  void config
  return nodes
}

function directorFor(flags: Partial<typeof UNMODIFIED_RAFT> = {}): Director {
  const config: RaftConfig = { ...CONFIG, flags: { ...UNMODIFIED_RAFT, ...flags } }
  return new Director(config, panelA(config))
}

/**
 * Panels (b) through (d), driven through the real state machine. Returns the director
 * so the caller can assert on any panel.
 */
function playThroughPanelC(director: Director): void {
  // ---- (a) the starting position ----
  expect(director.logTerms(S1)).toEqual([1, 2])
  expect(director.logTerms(S2)).toEqual([1, 2])
  expect(director.logTerms(S3)).toEqual([1])
  expect(director.logTerms(S4)).toEqual([1])
  expect(director.logTerms(S5)).toEqual([1])

  // ---- (b) S1 crashes; S5 is elected, on votes from S3 and S4 ----
  director.crash(S1)
  director.clearWire()

  // S5 campaigns. S2 refuses — its log holds a term-2 entry and S5's does not, which
  // is the election restriction doing exactly what it is for. S3 and S4 grant.
  director.campaign(S5)
  director.flush([S2, S3, S4, S5])
  expect(director.nodes[S5]?.currentTerm).toBe(3)
  expect(director.nodes[S5]?.role).toBe('leader')
  expect(director.nodes[S2]?.votedFor).not.toBe(S5)

  // S5 accepts a different entry at index 2 and replicates it to nobody.
  director.clientRequest(S5, 'c')
  director.clearWire()
  expect(director.logTerms(S5)).toEqual([1, 3])

  // ---- (c) S5 crashes; S1 restarts and is elected leader of term 4 ----
  director.crash(S5)
  director.restart(S1)
  expect(director.nodes[S1]?.role).toBe('follower')
  expect(director.nodes[S1]?.currentTerm).toBe(2)
  expect(director.logTerms(S1)).toEqual([1, 2])

  // Its first attempt, in term 3, fails: S3 and S4 already voted for S5 in term 3.
  director.campaign(S1)
  director.flush([S1, S2, S3, S4])
  expect(director.nodes[S1]?.currentTerm).toBe(3)
  expect(director.nodes[S1]?.role).toBe('candidate')

  // Its second attempt, in term 4, succeeds. S3 and S4 are free to vote again, and
  // S1's log — last term 2 — beats theirs, last term 1.
  director.campaign(S1)
  director.flush([S1, S2, S3, S4])
  expect(director.nodes[S1]?.currentTerm).toBe(4)
  expect(director.nodes[S1]?.role).toBe('leader')

  // S1 continues replicating index 2. Now S1, S2 and S3 hold it: a majority of five.
  director.heartbeat(S1)
  director.flush([S1, S2, S3, S4])
  expect(director.logTerms(S3)).toEqual([1, 2])
  const held = ALL.filter((id) => director.logTerms(id)[1] === 2)
  expect(held.length).toBeGreaterThanOrEqual(3)
}

describe('Figure 8 — with the current-term commit rule (unmodified Raft)', () => {
  it('refuses to commit index 2 in panel (c), though a majority holds it (§5.4.2)', () => {
    const director = directorFor()
    playThroughPanelC(director)

    // The whole point of the figure. A majority of servers store index 2, and the
    // leader still may not call it committed, because its term is 2 and the leader's
    // is 4. Only an entry from the leader's own term may be committed by counting.
    //
    // commitIndex is 0 rather than 1 because S1 restarted in panel (c) and
    // commitIndex is volatile state — it is rebuilt as entries commit again, and
    // nothing has committed in term 4 yet.
    expect(director.nodes[S1]?.commitIndex).toBe(0)
    expect(director.nodes[S1]?.lastApplied).toBe(0)
    expect(director.violations).toEqual([])
  })

  it('panel (d): S5 overwrites index 2 everywhere, and nothing committed is lost', () => {
    const director = directorFor()
    playThroughPanelC(director)

    // S1 appends an entry of its own term but crashes before replicating it.
    director.clientRequest(S1, 'd')
    director.clearWire()
    expect(director.logTerms(S1)).toEqual([1, 2, 4])
    director.crash(S1)

    // S5 returns and wins term 5: its last term, 3, beats S2 and S3's last term, 2.
    director.restart(S5)
    director.campaign(S5) // term 4 — refused, S2/S3/S4 already voted for S1 in term 4
    director.flush([S2, S3, S4, S5])
    director.campaign(S5) // term 5 — granted
    director.flush([S2, S3, S4, S5])
    expect(director.nodes[S5]?.currentTerm).toBe(5)
    expect(director.nodes[S5]?.role).toBe('leader')

    // S5 replicates its own log, overwriting index 2 on every reachable server.
    director.clientRequest(S5, 'e')
    for (let round = 0; round < 6; round += 1) {
      director.heartbeat(S5)
      director.flush([S2, S3, S4, S5])
    }
    expect(director.logTerms(S2)).toEqual([1, 3, 5])
    expect(director.logTerms(S3)).toEqual([1, 3, 5])
    expect(director.logTerms(S4)).toEqual([1, 3, 5])

    // Index 2 was overwritten on a majority — and that is *legal*, because it was
    // never committed. Not one property is violated.
    expect(director.violations).toEqual([])
  })

  it('panel (e): an entry from the leader own term commits, and closes the hazard', () => {
    const director = directorFor()
    playThroughPanelC(director)

    // S1 appends an entry of term 4 and replicates it to a majority *before* crashing.
    director.clientRequest(S1, 'd')
    director.flush([S1, S2, S3, S4])
    director.heartbeat(S1)
    director.flush([S1, S2, S3, S4])

    // Index 3 is from the leader's own term, so it commits by replica count — and
    // committing it carries index 2 with it, indirectly. §5.4.2.
    expect(director.nodes[S1]?.commitIndex).toBe(3)
    expect(director.nodes[S1]?.stateMachine.slice(0, 3)).toEqual(['a', 'b', 'd'])

    director.crash(S1)
    director.restart(S5)

    // Now S5 can never win: S2 and S3 hold a term-4 entry, and S5's last term is 3.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      director.campaign(S5)
      director.flush([S2, S3, S4, S5])
    }
    expect(director.nodes[S5]?.role).not.toBe('leader')
    expect(director.logTerms(S2)).toEqual([1, 2, 4])
    expect(director.violations).toEqual([])
  })
})

describe('Figure 8 — with the current-term commit rule ablated', () => {
  it('commits index 2 in panel (c) on replica count alone', () => {
    const director = directorFor({ currentTermCommitRule: false })
    playThroughPanelC(director)

    // Without the rule, a majority is enough, and index 2 is declared committed and
    // applied — even though its term is 2 and the leader's is 4.
    expect(director.nodes[S1]?.commitIndex).toBe(2)
    expect(director.nodes[S1]?.stateMachine[1]).toBe('b')
  })

  it('then loses that committed entry in panel (d) — the figure, live', () => {
    const director = directorFor({ currentTermCommitRule: false })
    playThroughPanelC(director)
    expect(director.nodes[S1]?.commitIndex).toBe(2)

    director.clientRequest(S1, 'd')
    director.clearWire()
    director.crash(S1)

    director.restart(S5)
    director.campaign(S5)
    director.flush([S2, S3, S4, S5])
    director.campaign(S5)
    director.flush([S2, S3, S4, S5])
    expect(director.nodes[S5]?.role).toBe('leader')
    expect(director.nodes[S5]?.currentTerm).toBe(5)

    director.clientRequest(S5, 'e')
    for (let round = 0; round < 6; round += 1) {
      director.heartbeat(S5)
      director.flush([S2, S3, S4, S5])
    }

    // Index 2 now holds a different entry on every other server. S2 had already
    // applied "b" there, and its log has been rewritten underneath it — it will never
    // re-apply that index, so its state machine and its log now disagree forever.
    expect(director.logCommands(S2)[1]).toBe('c')
    expect(director.nodes[S2]?.stateMachine[1]).toBe('b')

    // S5 restarted, so its lastApplied was reset and it applies index 2 afresh — as
    // "c". Two servers, the same index, different commands.
    expect(director.nodes[S5]?.stateMachine[1]).toBe('c')

    // The independent checker names both properties that fall.
    const stateMachineSafety = director.violationsOf('state-machine-safety')
    expect(stateMachineSafety.length).toBeGreaterThan(0)
    expect(stateMachineSafety[0]?.logIndex).toBe(2)
    expect(stateMachineSafety[0]?.summary).toMatch(/applied "b" at index 2/)

    const leaderCompleteness = director.violationsOf('leader-completeness')
    expect(leaderCompleteness.length).toBeGreaterThan(0)
    expect(leaderCompleteness[0]?.logIndex).toBe(2)
  })
})
