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
  /**
   * The single named thing this scenario demonstrates. Bilingual: it is shown to the
   * reader, and Indonesian is the language of explanation.
   */
  readonly phenomenon: { readonly id: string; readonly en: string }
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

/**
 * `log-matching-break`, opening position.
 *
 * Node 0 leads term 4 with `[1, 1, 2]`; node 4 holds `[1, 1, 3]`. The two disagree at
 * index 3 with *different terms*, so Log Matching says nothing about them yet and the
 * position is legal. What matters is that the leader's `nextIndex` starts at 4, so its
 * first probe lands on index 3 — exactly the divergent index — which is the only
 * arrangement in which the consistency check is load-bearing.
 *
 * The history that produces it, which is worth stating because a hand-built position
 * is only worth anything if Raft could actually have reached it:
 *
 *   - A term-2 leader with `[1, 1]` appended index 3 and replicated it to node 1.
 *   - A candidate holding `[1, 1]` won term 3 on votes from nodes 2, 3 and itself —
 *     nodes 0 and 1 refused it, their last term being 2 — and appended its own index 3,
 *     reaching node 4 alone.
 *   - Node 0 then won term 4 on votes from node 1 and node 2. Node 4 refused it, its
 *     last term being 3 against node 0's 2, and a majority did not need node 4.
 *
 * That last step is also the reason this is not a Leader Completeness problem: index 3
 * was never committed on either side, so losing either version costs nothing.
 */
export function logMatchingStart(seed: number): readonly NodeState[] {
  const prefix = [
    { term: 1, command: 'a' },
    { term: 1, command: 'b' },
  ]
  const base = (id: number, log: readonly { term: number; command: string }[]): NodeState => ({
    ...createNode(id, 5, seed),
    currentTerm: 4,
    votedFor: 0,
    log,
    commitIndex: 2,
    lastApplied: 2,
    stateMachine: ['a', 'b'],
  })
  const oldEntry = { term: 2, command: 'c-lama' }
  const newEntry = { term: 3, command: 'c-baru' }
  return [
    {
      ...base(0, [...prefix, oldEntry]),
      role: 'leader',
      leaderId: 0,
      // The probe that matters: nextIndex 4 means prevLogIndex 3, the divergent index.
      nextIndex: [4, 4, 4, 4, 4],
      matchIndex: [3, 0, 0, 0, 0],
    },
    base(1, [...prefix, oldEntry]),
    base(2, prefix),
    base(3, prefix),
    base(4, [...prefix, newEntry]),
  ]
}

/**
 * `double-candidacy`, opening position.
 *
 * Node 0 leads term 1, elected on its own vote and node 1's. Node 2's `votedFor` is
 * still empty because the RequestVote addressed to it was lost — which is ordinary on
 * a lossy network, and is the whole hinge of the scenario. A majority of three needs
 * only two votes, so node 0 won without it.
 *
 * Every log is identical and committed, so the election restriction has nothing to say
 * and cannot be confused for the rule under test.
 */
export function doubleCandidacyStart(seed: number): readonly NodeState[] {
  const base = (id: number, votedFor: number | null): NodeState => ({
    ...createNode(id, 3, seed),
    currentTerm: 1,
    votedFor,
    log: [{ term: 1, command: 'a' }],
    commitIndex: 1,
    lastApplied: 1,
    stateMachine: ['a'],
  })
  return [
    { ...base(0, 0), role: 'leader', leaderId: 0, nextIndex: [2, 2, 2], matchIndex: [1, 1, 1] },
    base(1, 0),
    // Never heard the request, so never cast a vote in term 1. It is still free to.
    base(2, null),
  ]
}

export const SCENARIOS: readonly ScenarioDefinition[] = [
  {
    id: 'clean-election',
    title: 'Pemilihan bersih',
    summary:
      'Lima node, jaringan yang kehilangan sebagian pesan. Satu leader terpilih, lalu entry direplikasi dan commit.',
    phenomenon: {
      id:
        'Leader terpilih dari keadaan awal dan entry dari klien berhasil commit, di bawah jaringan yang kehilangan pesan — kasus biasa, yang layak dilihat sebelum apa pun dirusak.',
      en: 'A leader is elected from a standing start and client entries commit, under a network that loses messages — the ordinary case, which is worth seeing before anything breaks.',
    },
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
    phenomenon: {
      id:
        'Dengan randomisasi election timeout dipersempit hampir habis, para candidate bertabrakan dan suara terbelah. Raft tidak punya aturan tiebreak: perpecahan itu selesai semata-mata karena putaran timeout berikutnya berbeda. Untuk inilah randomisasi ada.',
      en: 'With the randomized election timeout narrowed almost to nothing, candidates collide and split the vote. Raft has no tiebreak rule: the split is resolved only because the next round of timeouts differs. This is what the randomization is for.',
    },
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
    phenomenon: {
      id:
        'Leader yang terpotong ke minoritas tetap mengira dirinya memimpin, dan tetap menerima entry dari klien — tetapi tidak akan pernah bisa meng-commit-nya, karena commit butuh mayoritas. Sisi mayoritas memilih leader baru di term yang lebih tinggi, dan ketika partisi tersambung kembali leader basi itu mengetahui term tersebut lalu mundur. Mematikan aturan step-down meninggalkan dua leader dalam satu term.',
      en: 'A leader partitioned into a minority still believes it leads, and still accepts client entries — but it can never commit them, because commitment needs a majority. The majority side elects a new leader in a higher term, and when the partition heals the stale leader learns of that term and steps down. Ablating the step-down rule leaves two leaders in one term.',
    },
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
    phenomenon: {
      id:
        'Leader lama, terdampar bersama satu follower, menambahkan entry yang tidak akan pernah bisa commit. Mayoritas memilih leader baru yang menambahkan entry berbeda pada index yang sama. Setelah partisi sembuh, AppendEntries consistency check gagal, leader menelusuri nextIndex mundur sampai kedua log bertemu, lalu menimpa ekor yang menyimpang. Inilah tampilan ciri khasnya: baris yang gagal sejajar, lalu sejajar kembali.',
      en: 'The old leader, stranded with one follower, appends entries that can never commit. The majority elects a new leader that appends different entries at the same indices. When the partition heals, the AppendEntries consistency check fails, the leader walks nextIndex backwards until the logs agree, and overwrites the divergent tail. This is the signature view: rows that fail to line up, and then line up again.',
    },
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
    phenomenon: {
      id:
        'Leader menerima sebuah entry lalu jatuh sebelum mayoritas menyimpannya. Entry itu tidak committed dan juga tidak dibuang: apakah ia bertahan sepenuhnya bergantung pada apakah leader berikutnya kebetulan memilikinya — dan itulah yang diputuskan oleh election restriction.',
      en: 'A leader accepts an entry and crashes before a majority stores it. The entry is neither committed nor discarded: whether it survives depends entirely on whether the next leader happens to hold it, which the election restriction decides.',
    },
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
    phenomenon: {
      id:
        'Node yang terisolasi mencalonkan diri berkali-kali, sehingga term-nya menanjak jauh di atas yang lain sementara lognya tetap pendek. Ketika partisi sembuh, term tingginya memaksa election baru — dan election restriction adalah satu-satunya yang mencegahnya menang dengan log yang kehilangan entry yang sudah committed. Matikan restriction itu dan entry tersebut hilang.',
      en: 'An isolated node campaigns over and over, so its term climbs far above everyone else while its log stays short. When the partition heals its high term forces a new election — and the election restriction is the only thing stopping it from winning with a log that is missing committed entries. Turn the restriction off and those entries are lost.',
    },
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
    phenomenon: {
      id:
        'Figure 8 dari makalah, dimainkan di dalam simulator. Dimulai dari panel (a): S1 memimpin term 2 dan baru mereplikasi index 2 ke S2 saja. S1 jatuh, S5 memenangkan term 3 dan menulis entry berbeda di index 2, S1 kembali dan memenangkan term 4 lalu mendorong index 2 miliknya ke mayoritas — dan entry itu tetap belum aman. Matikan current-term commit rule dan ia dinyatakan committed, lalu ditimpa. Reproduksi persis panel demi panel ada di tests/figure8.',
      en: "The paper's Figure 8, played out in the simulator. It opens at panel (a): S1 leads term 2 and has replicated index 2 to S2 only. S1 crashes, S5 wins term 3 and writes a different entry at index 2, S1 returns and wins term 4 and pushes its index 2 onto a majority — and that entry is still not safe. Turn off the current-term commit rule and it is declared committed, then overwritten. The exact panel-by-panel reproduction lives in tests/figure8.",
    },
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
    phenomenon: {
      id:
        'Seorang follower memberi suara, jatuh, lalu hidup kembali. Karena votedFor adalah persistent state, ia mengingatnya dan menolak memilih untuk kedua kalinya di term yang sama. Buat votedFor volatile dan node yang sama menyerahkan mayoritas yang dibutuhkan candidate kedua, menghasilkan dua leader dalam satu term.',
      en: 'A follower votes, crashes and restarts. Because votedFor is persistent state, it remembers and refuses to vote a second time in the same term. Make votedFor volatile and the same node hands a second candidate the majority it needs, producing two leaders in one term.',
    },
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
      'Leader menyelidiki follower pada index yang sudah menyimpang. Dengan consistency check aktif ia ditolak dan memperbaiki; tanpa check itu ia diterima, dan dua log sepakat di satu (index, term) di atas prefix yang berbeda.',
    phenomenon: {
      id:
        'AppendEntries consistency check baru benar-benar terasa ketika nextIndex menunjuk tepat pada index yang sudah menyimpang. Di sini node 4 memegang term 3 di index 3 sementara leader term 4 memegang term 2 di sana. Probe pertama leader jatuh persis di index itu. Dengan check aktif, node 4 menolak, leader menelusuri mundur, dan ekor yang menyimpang ditimpa. Dengan check dimatikan, node 4 menerimanya, leader mengira log mereka cocok, lalu menambahkan entry baru di atas prefix yang berbeda — dan keduanya kini memuat (index 4, term 4) di atas isi yang tidak sama. Lebih buruk lagi, leader menghitung node 4 sebagai replika saat meng-commit.',
      en: 'The AppendEntries consistency check only bites when nextIndex lands exactly on a divergent index. Here node 4 holds a term-3 entry at index 3 while the term-4 leader holds a term-2 entry there, and the leader\'s first probe falls on precisely that index. With the check on, node 4 rejects, the leader walks back, and the divergent tail is overwritten. With the check off, node 4 accepts, the leader believes their logs agree, and the next entry is appended on top of a different prefix — so both now hold (index 4, term 4) over contents that differ. Worse, the leader counts node 4 as a replica when committing.',
    },
    spec: scenario({
      seed: 1,
      nodeCount: 5,
      network: SCRIPTED_NETWORK,
      initialNodes: logMatchingStart(1),
      actions: [
        { at: 400, kind: 'client-request', node: 0, command: 'd' },
        { at: 1200, kind: 'client-request', node: 0, command: 'e' },
      ],
      maxTime: 4000,
      maxSteps: 4000,
    }),
    ablation: { flag: 'appendEntriesConsistencyCheck', breaks: 'log-matching' },
  },

  {
    id: 'double-candidacy',
    title: 'Mencalonkan diri tanpa menaikkan term',
    summary:
      'Node 1 sudah memilih node 0 di term 1. Ia mencalonkan diri lagi — dengan term dinaikkan itu pemungutan suara baru; tanpa dinaikkan ia menimpa suaranya sendiri di term yang sama.',
    phenomenon: {
      id:
        'Menaikkan term saat mencalonkan diri adalah yang membuat sebuah kampanye menjadi pemungutan suara baru. Node 0 memimpin term 1 dengan suara dari dirinya dan node 1; node 2 tidak pernah menerima permintaan suaranya, jadi votedFor-nya masih kosong. Setelah node 0 terpotong, node 1 mencalonkan diri. Dengan aturan aktif ia pindah ke term 2, dan dua leader itu berada di term berbeda — bukan pelanggaran. Tanpa aturan itu ia berkampanye di dalam term 1, menimpa suaranya sendiri untuk node 0, dan node 2 yang belum memilih memberinya mayoritas kedua di term yang sama.',
      en: 'Incrementing the term on candidacy is what makes a campaign a new ballot. Node 0 leads term 1 on its own vote and node 1\'s; node 2 never received its RequestVote, so node 2\'s votedFor is still empty. Once node 0 is cut off, node 1 campaigns. With the rule on it moves to term 2, and the two leaders sit in different terms — not a violation. Without it, node 1 campaigns inside term 1, overwrites its own vote for node 0, and node 2 — which has not voted — hands it a second majority in the very same term.',
    },
    spec: scenario({
      seed: 6,
      nodeCount: 3,
      network: SCRIPTED_NETWORK,
      initialNodes: doubleCandidacyStart(6),
      actions: [
        { at: 300, kind: 'partition', partitionOf: [1, 0, 0] },
        { at: 4000, kind: 'heal' },
      ],
      maxTime: 7000,
      maxSteps: 5000,
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
