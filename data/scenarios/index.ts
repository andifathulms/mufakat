/**
 * The scenario library.
 *
 * Each entry is a `(config, seed, actions, flags)` tuple and a documented
 * `phenomenon` — the one thing it exists to show. Scenarios replay identically, and
 * the user can take control at any point and diverge from them.
 *
 * Curation is content work, and it is on the critical path. Random fuzzing produces
 * runs that are either boring or incomprehensible; these are built by hand and the
 * seeds are chosen so the intended thing actually happens. Where a scenario was found
 * by the fuzz suite rather than hand-built, it says so.
 *
 * Scenario ids are stable and readable, because they appear in shared URLs.
 */

import { createNode } from '@/lib/raft/node'
import type { AblationFlagName } from '@/lib/raft/rules'
import { UNMODIFIED_RAFT } from '@/lib/raft/rules'
import type { NodeState } from '@/lib/raft/types'
import type { SafetyProperty } from '@/lib/invariants/types'
import { scenario, type Scenario } from '@/lib/sim/simulation'
import type { NetworkConfig } from '@/lib/sim/network'

/** Deterministic and quiet, so a scripted sequence plays out as written. */
const SCRIPTED_NETWORK: NetworkConfig = {
  latencyMin: 10,
  latencyMax: 25,
  dropPerMille: 0,
  duplicatePerMille: 0,
}

/** Lossy, as Raft assumes. Used where the point is behaviour under a real network. */
const LOSSY_NETWORK: NetworkConfig = {
  latencyMin: 12,
  latencyMax: 45,
  dropPerMille: 80,
  duplicatePerMille: 20,
}

export interface ScenarioDefinition {
  readonly id: string
  readonly title: string
  /** One-line description, Indonesian. Algorithm terms stay in English. */
  readonly summary: string
  /** The single named thing this scenario demonstrates. */
  readonly phenomenon: string
  readonly spec: Scenario
  /**
   * The rule to switch off to see this scenario's point, and the property that then
   * breaks. Absent for scenarios that illustrate unmodified Raft.
   */
  readonly ablation?: {
    readonly flag: AblationFlagName
    readonly breaks: SafetyProperty
  }
}

/**
 * Figure 8, panel (a): S1 (node 0) is leader of term 2 and has partially replicated
 * the entry at index 2 — it has reached S2 (node 1) and nobody else. Index 1 is
 * committed everywhere.
 *
 * The scenario starts here rather than building up to it, because the eighty
 * uninteresting steps that would produce this position are not the lesson.
 */
export function figure8PanelA(seed: number): readonly NodeState[] {
  const base = (id: number): NodeState => ({
    ...createNode(id, 5, seed),
    currentTerm: 2,
    votedFor: 0,
    log: [{ term: 1, command: 'a' }],
    commitIndex: 1,
    lastApplied: 1,
    stateMachine: ['a'],
  })
  const withIndexTwo = (id: number): NodeState => ({
    ...base(id),
    log: [
      { term: 1, command: 'a' },
      { term: 2, command: 'b' },
    ],
  })
  return [
    {
      ...withIndexTwo(0),
      role: 'leader',
      leaderId: 0,
      nextIndex: [3, 3, 2, 2, 2],
      // Index 2 is on S1 and S2 only: two of five, short of a majority.
      matchIndex: [2, 2, 1, 1, 1],
    },
    withIndexTwo(1),
    base(2),
    base(3),
    base(4),
  ]
}

export const SCENARIOS: readonly ScenarioDefinition[] = [
  {
    id: 'clean-election',
    title: 'Pemilihan bersih',
    summary:
      'Lima node, jaringan yang kehilangan sebagian pesan. Satu leader terpilih, lalu entry direplikasi dan commit.',
    phenomenon:
      'A leader is elected from a standing start and client entries commit, under a network that loses messages — the ordinary case, which is worth seeing before anything breaks.',
    spec: scenario({
      seed: 5,
      nodeCount: 5,
      network: LOSSY_NETWORK,
      actions: [
        { at: 1500, kind: 'client-request', node: 0, command: 'set x=1' },
        { at: 2600, kind: 'client-request', node: 0, command: 'set y=2' },
        { at: 3700, kind: 'client-request', node: 2, command: 'set z=3' },
      ],
      maxTime: 7000,
      maxSteps: 4000,
    }),
  },

  {
    id: 'split-vote',
    title: 'Split vote',
    summary:
      'Election timeout yang hampir seragam membuat beberapa node mencalonkan diri bersamaan. Tidak ada tiebreak — jitter timeout yang menyelesaikannya.',
    phenomenon:
      'With the randomized election timeout narrowed almost to nothing, candidates collide and split the vote. Raft has no tiebreak rule: the split is resolved only because the next round of timeouts differs. This is what the randomization is for.',
    spec: scenario({
      seed: 3,
      nodeCount: 5,
      network: SCRIPTED_NETWORK,
      // A jitter range of eight ticks against a heartbeat of 45. Real Raft would use
      // a spread comparable to the timeout itself; §5.2.
      electionTimeoutMin: 150,
      electionTimeoutMax: 158,
      heartbeatInterval: 45,
      actions: [{ at: 2500, kind: 'client-request', node: 0, command: 'set x=1' }],
      maxTime: 6000,
      maxSteps: 4000,
    }),
  },

  {
    id: 'partition-stranded-leader',
    title: 'Leader terdampar di minoritas',
    summary:
      'Leader terpotong ke sisi minoritas. Ia tetap mengira dirinya leader, tetapi tidak bisa commit apa pun; sisi mayoritas memilih leader baru di term yang lebih tinggi.',
    phenomenon:
      'A leader partitioned into a minority still believes it leads, and still accepts client entries — but it can never commit them, because commitment needs a majority. The majority side elects a new leader in a higher term, and when the partition heals the stale leader learns of that term and steps down. Ablating the step-down rule leaves two leaders in one term.',
    spec: scenario({
      seed: 13,
      nodeCount: 5,
      network: SCRIPTED_NETWORK,
      actions: [
        { at: 1200, kind: 'client-request', node: 0, command: 'set a=1' },
        { at: 2000, kind: 'partition', partitionOf: [1, 0, 0, 0, 0] },
        { at: 3000, kind: 'client-request', node: 1, command: 'set b=2' },
        { at: 5000, kind: 'heal' },
        { at: 6000, kind: 'client-request', node: 1, command: 'set c=3' },
      ],
      maxTime: 9000,
      maxSteps: 8000,
    }),
    ablation: { flag: 'stepDownOnHigherTerm', breaks: 'election-safety' },
  },

  {
    id: 'log-divergence-repair',
    title: 'Divergensi log dan perbaikannya',
    summary:
      'Dua sisi partisi menerima entry berbeda pada index yang sama. Setelah heal, leader baru menelusuri nextIndex mundur sampai log cocok, lalu menimpa ekor yang menyimpang.',
    phenomenon:
      'The old leader, stranded with one follower, appends entries that can never commit. The majority elects a new leader that appends different entries at the same indices. When the partition heals, the AppendEntries consistency check fails, the leader walks nextIndex backwards until the logs agree, and overwrites the divergent tail. This is the signature view: rows that fail to line up, and then line up again.',
    spec: scenario({
      seed: 8,
      nodeCount: 5,
      network: SCRIPTED_NETWORK,
      actions: [
        { at: 1200, kind: 'client-request', node: 0, command: 'set a=1' },
        { at: 2000, kind: 'partition', partitionOf: [0, 0, 1, 1, 1] },
        { at: 2400, kind: 'client-request', node: 0, command: 'stranded 1' },
        { at: 2800, kind: 'client-request', node: 0, command: 'stranded 2' },
        { at: 3200, kind: 'client-request', node: 2, command: 'set b=2' },
        { at: 3800, kind: 'client-request', node: 2, command: 'set c=3' },
        { at: 5000, kind: 'heal' },
        { at: 6500, kind: 'client-request', node: 2, command: 'set d=4' },
      ],
      maxTime: 9000,
      maxSteps: 8000,
    }),
  },

  {
    id: 'leader-crash-mid-replication',
    title: 'Leader jatuh di tengah replikasi',
    summary:
      'Leader menerima entry lalu jatuh sebelum mayoritas menyimpannya. Leader berikutnya memutuskan nasib entry itu.',
    phenomenon:
      'A leader accepts an entry and crashes before a majority stores it. The entry is neither committed nor discarded: whether it survives depends entirely on whether the next leader happens to hold it, which the election restriction decides.',
    spec: scenario({
      seed: 4,
      nodeCount: 5,
      network: SCRIPTED_NETWORK,
      actions: [
        { at: 1200, kind: 'client-request', node: 0, command: 'set a=1' },
        { at: 2500, kind: 'client-request', node: 0, command: 'in flight' },
        { at: 2502, kind: 'partition', partitionOf: [1, 0, 0, 0, 0] },
        { at: 2510, kind: 'crash', node: 0 },
        { at: 2600, kind: 'heal' },
        { at: 4500, kind: 'client-request', node: 1, command: 'set b=2' },
        { at: 6000, kind: 'restart', node: 0 },
      ],
      maxTime: 9000,
      maxSteps: 8000,
    }),
  },

  {
    id: 'election-restriction-overwrite',
    title: 'Kandidat dengan log tertinggal',
    summary:
      'Satu node terisolasi selama cluster meng-commit beberapa entry. Term-nya menanjak, lognya tidak. Election restriction yang menahannya agar tidak pernah menang.',
    phenomenon:
      'An isolated node campaigns over and over, so its term climbs far above everyone else while its log stays short. When the partition heals its high term forces a new election — and the election restriction is the only thing stopping it from winning with a log that is missing committed entries. Turn the restriction off and those entries are lost.',
    spec: scenario({
      seed: 3,
      nodeCount: 5,
      network: SCRIPTED_NETWORK,
      actions: [
        { at: 500, kind: 'partition', partitionOf: [0, 0, 0, 0, 1] },
        { at: 1500, kind: 'client-request', node: 0, command: 'set a=1' },
        { at: 2200, kind: 'client-request', node: 0, command: 'set b=2' },
        { at: 2900, kind: 'client-request', node: 1, command: 'set c=3' },
        { at: 4500, kind: 'heal' },
        { at: 7000, kind: 'client-request', node: 1, command: 'set d=4' },
      ],
      maxTime: 11_000,
      maxSteps: 8000,
    }),
    ablation: { flag: 'electionRestriction', breaks: 'leader-completeness' },
  },

  {
    id: 'figure-8',
    title: 'Figure 8',
    summary:
      'Skenario dari makalah, dimainkan langsung. Sebuah entry dari term lama tersimpan di mayoritas — dan masih bisa ditimpa.',
    phenomenon:
      "The paper's Figure 8, played out in the simulator. It opens at panel (a): S1 leads term 2 and has replicated index 2 to S2 only. S1 crashes, S5 wins term 3 and writes a different entry at index 2, S1 returns and wins term 4 and pushes its index 2 onto a majority — and that entry is still not safe. Turn off the current-term commit rule and it is declared committed, then overwritten. The exact panel-by-panel reproduction lives in tests/figure8.",
    spec: scenario({
      seed: 1,
      nodeCount: 5,
      network: { latencyMin: 10, latencyMax: 20, dropPerMille: 0, duplicatePerMille: 0 },
      initialNodes: figure8PanelA(1),
      actions: [
        // (b) S1 crashes; S5 wins term 3 and accepts a different entry at index 2.
        { at: 5, kind: 'crash', node: 0 },
        { at: 5, kind: 'crash', node: 1 },
        { at: 1200, kind: 'client-request', node: 4, command: 'c' },
        { at: 1201, kind: 'partition', partitionOf: [0, 0, 0, 0, 1] },
        { at: 1230, kind: 'crash', node: 4 },
        { at: 1231, kind: 'heal' },
        // S3 and S4 are held down briefly so that S1's second campaign — the one that
        // wins — lands in term 4 exactly as the figure has it, rather than being
        // overtaken by one of theirs.
        { at: 1232, kind: 'crash', node: 2 },
        { at: 1232, kind: 'crash', node: 3 },
        // (c) S1 restarts, wins term 4, and pushes index 2 onto a majority.
        { at: 1240, kind: 'restart', node: 0 },
        { at: 1600, kind: 'restart', node: 2 },
        { at: 1600, kind: 'restart', node: 3 },
        { at: 1900, kind: 'restart', node: 1 },
        // S1 accepts an entry of its own term and crashes before replicating it.
        { at: 3000, kind: 'client-request', node: 0, command: 'd' },
        { at: 3001, kind: 'partition', partitionOf: [1, 0, 0, 0, 0] },
        { at: 3005, kind: 'crash', node: 0 },
        { at: 3005, kind: 'crash', node: 1 },
        // (d) S5 returns. Its last term, 3, beats everyone else's 2, so only it can
        // win — and it overwrites index 2 everywhere.
        { at: 3010, kind: 'restart', node: 4 },
        { at: 3100, kind: 'heal' },
        { at: 4500, kind: 'client-request', node: 4, command: 'e' },
        { at: 5200, kind: 'restart', node: 1 },
      ],
      maxTime: 7000,
      maxSteps: 6000,
    }),
    ablation: { flag: 'currentTermCommitRule', breaks: 'state-machine-safety' },
  },

  {
    id: 'double-vote-restart',
    title: 'Memilih dua kali setelah restart',
    summary:
      'Satu node memberi suara, jatuh, lalu hidup kembali. Karena votedFor persistent, ia menolak memilih lagi di term yang sama.',
    phenomenon:
      'A follower votes, crashes and restarts. Because votedFor is persistent state, it remembers and refuses to vote a second time in the same term. Make votedFor volatile and the same node hands a second candidate the majority it needs, producing two leaders in one term.',
    spec: scenario({
      seed: 11,
      nodeCount: 3,
      network: { latencyMin: 10, latencyMax: 20, dropPerMille: 0, duplicatePerMille: 0 },
      actions: [
        // Node 2 is held down so the other two elect a leader between them.
        { at: 1, kind: 'crash', node: 2 },
        // The leader is cut off; the remaining follower is restarted, losing its vote.
        { at: 2500, kind: 'partition', partitionOf: [1, 0, 0] },
        { at: 2550, kind: 'crash', node: 1 },
        { at: 2600, kind: 'restart', node: 2 },
        { at: 2650, kind: 'restart', node: 1 },
      ],
      maxTime: 9000,
      maxSteps: 5000,
    }),
    ablation: { flag: 'persistVotedFor', breaks: 'election-safety' },
  },

  {
    id: 'log-matching-break',
    title: 'Consistency check dimatikan',
    summary:
      'Ditemukan oleh fuzz suite: partisi, kehilangan pesan, dan dua log yang sepakat di satu (index, term) tetapi berbeda sebelumnya.',
    phenomenon:
      'Found by the fuzz suite rather than built by hand, because the AppendEntries consistency check only fails to matter when nextIndex happens to point past a divergence — a coincidence of timing that is hard to script and easy to search for. With the check off, two logs come to hold the same entry at the same index and term over different prefixes, which is Log Matching failing exactly as stated.',
    spec: scenario({
      seed: 22,
      nodeCount: 5,
      network: { latencyMin: 14, latencyMax: 53, dropPerMille: 116, duplicatePerMille: 49 },
      electionTimeoutMin: 150,
      electionTimeoutMax: 300,
      heartbeatInterval: 40,
      actions: [
        { at: 991, kind: 'client-request', node: 3, command: 'v5' },
        { at: 2195, kind: 'partition', partitionOf: [0, 0, 1, 1, 0] },
        { at: 2763, kind: 'client-request', node: 3, command: 'v4' },
        { at: 3293, kind: 'client-request', node: 0, command: 'v2' },
        { at: 10_191, kind: 'client-request', node: 0, command: 'v1' },
        { at: 10_879, kind: 'partition', partitionOf: [1, 0, 0, 0, 1] },
        { at: 22_398, kind: 'client-request', node: 4, command: 'v3' },
        { at: 23_036, kind: 'heal' },
      ],
      maxTime: 25_000,
      maxSteps: 6000,
    }),
    ablation: { flag: 'appendEntriesConsistencyCheck', breaks: 'log-matching' },
  },

  {
    id: 'double-candidacy',
    title: 'Mencalonkan diri tanpa menaikkan term',
    summary:
      'Ditemukan oleh fuzz suite: sebuah node yang sudah memilih orang lain mencalonkan diri di term yang sama, menimpa suaranya sendiri.',
    phenomenon:
      "Found by the fuzz suite. Incrementing the term on candidacy is what makes a campaign a new ballot. Without it a server that has already voted for someone else campaigns inside the same term and overwrites its own vote — so one term can hold two majorities, and two leaders.",
    spec: scenario({
      seed: 795,
      nodeCount: 3,
      network: { latencyMin: 11, latencyMax: 33, dropPerMille: 30, duplicatePerMille: 47 },
      electionTimeoutMin: 150,
      electionTimeoutMax: 300,
      heartbeatInterval: 40,
      actions: [
        { at: 1182, kind: 'client-request', node: 0, command: 'v1' },
        { at: 1363, kind: 'client-request', node: 1, command: 'v6' },
        { at: 4159, kind: 'client-request', node: 0, command: 'v4' },
        { at: 8189, kind: 'partition', partitionOf: [1, 0, 1] },
        { at: 11_854, kind: 'partition', partitionOf: [0, 0, 1] },
        { at: 16_717, kind: 'client-request', node: 1, command: 'v5' },
        { at: 18_348, kind: 'heal' },
        { at: 18_829, kind: 'client-request', node: 0, command: 'v2' },
        { at: 20_362, kind: 'client-request', node: 0, command: 'v3' },
      ],
      maxTime: 25_000,
      maxSteps: 6000,
    }),
    ablation: { flag: 'termIncrementOnCandidacy', breaks: 'election-safety' },
  },
]

export function scenarioById(id: string): ScenarioDefinition {
  const found = SCENARIOS.find((entry) => entry.id === id)
  if (found === undefined) throw new Error(`No scenario with id ${id}`)
  return found
}

/** The scenario designated to break when `flag` is switched off. */
export function scenarioForFlag(flag: AblationFlagName): ScenarioDefinition {
  const found = SCENARIOS.find((entry) => entry.ablation?.flag === flag)
  if (found === undefined) throw new Error(`No scenario designated for ablation flag ${flag}`)
  return found
}

/** The same scenario with a rule switched off. */
export function ablated(definition: ScenarioDefinition, flag: AblationFlagName): Scenario {
  return { ...definition.spec, flags: { ...UNMODIFIED_RAFT, [flag]: false } }
}
