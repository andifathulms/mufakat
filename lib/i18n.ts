/**
 * Indonesian first, English second.
 *
 * Algorithm terms stay in English throughout — *term*, *leader*, *commit index*,
 * *AppendEntries*, *log* — because a reader should recognise them in the paper
 * afterwards. Only the interface and the explanation are translated.
 */

export const LOCALES = ['id', 'en'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'id'

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value)
}

interface Dictionary {
  readonly nav: {
    readonly simulation: string
    readonly scenarios: string
    readonly ablation: string
    readonly tagline: string
  }
  readonly home: {
    readonly lede: string
    readonly priorArtTitle: string
    readonly priorArt: string
    readonly contributionTitle: string
    readonly contribution: string
    readonly start: string
    readonly openFigure8: string
    readonly sourceTitle: string
    readonly source: string
  }
  readonly sim: {
    readonly cluster: string
    readonly ledger: string
    readonly invariants: string
    readonly timeline: string
    readonly step: string
    readonly time: string
    readonly play: string
    readonly pause: string
    readonly back: string
    readonly forward: string
    readonly start: string
    readonly end: string
    readonly speed: string
    readonly nextTerm: string
    readonly nextElection: string
    readonly nextCommit: string
    readonly nextViolation: string
    readonly computing: string
    readonly inFlight: string
    readonly noMessages: string
    readonly event: string
    readonly share: string
    readonly shared: string
    readonly submit: string
    readonly submitHint: string
    readonly crash: string
    readonly restart: string
    readonly isolate: string
    readonly heal: string
    readonly truncated: string
    readonly seed: string
    readonly rerun: string
  }
  readonly roles: Readonly<Record<'follower' | 'candidate' | 'leader' | 'crashed', string>>
  readonly ledger: {
    readonly index: string
    readonly committed: string
    readonly applied: string
    readonly uncommitted: string
    readonly empty: string
    readonly legend: string
  }
  readonly invariants: {
    readonly holding: string
    readonly broken: string
    readonly allHolding: string
    readonly atStep: string
    readonly stepBack: string
    readonly names: Readonly<Record<string, string>>
  }
  readonly ablation: {
    readonly lede: string
    readonly protects: string
    readonly section: string
    readonly figure2: string
    readonly callSite: string
    readonly scenario: string
    readonly on: string
    readonly off: string
    readonly modified: string
    readonly modifiedLong: string
    readonly unmodified: string
    readonly reset: string
    readonly rules: Readonly<Record<string, { readonly title: string; readonly body: string }>>
  }
  readonly scenarios: {
    readonly lede: string
    readonly phenomenon: string
    readonly open: string
    readonly breaksWith: string
  }
}

const id: Dictionary = {
  nav: {
    simulation: 'Simulasi',
    scenarios: 'Skenario',
    ablation: 'Ablasi',
    tagline: 'Simulator konsensus Raft',
  },
  home: {
    lede: 'Simulator Raft yang bisa Anda rusak dengan sengaja. Simulasi diskret deterministik, pemeriksaan invariant keamanan yang berjalan terus, dan mode ablasi yang mematikan satu per satu aturan Raft supaya jaminan yang dijaganya benar-benar terlihat gagal.',
    priorArtTitle: 'Karya terdahulu',
    priorArt:
      'RaftScope sudah ada, kualitasnya bagus, dan ditulis oleh penulis makalah Raft sendiri. Ia adalah visualiser Raft yang kanonis — kalau Anda ingin melihat Raft berjalan, mulailah dari sana. The Secret Lives of Data juga penjelasan yang baik.',
    contributionTitle: 'Yang ditambahkan proyek ini',
    contribution:
      'Bukan pengganti keduanya. Kontribusinya sempit: ablasi dan pemeriksaan invariant. RaftScope menunjukkan mekanismenya; di sini Anda mematikan sebuah aturan lalu menonton properti keamanan yang dijaganya runtuh, sementara lima indikator invariant menyebutkan mana yang gagal dan mengapa.',
    start: 'Mulai simulasi',
    openFigure8: 'Buka Figure 8',
    sourceTitle: 'Sumber normatif',
    source:
      'Ongaro & Ousterhout, In Search of an Understandable Consensus Algorithm (USENIX ATC 2014), versi extended — terutama Figure 2. Setiap aturan di lib/raft menyebutkan nomor figure dan rule yang diimplementasikannya.',
  },
  sim: {
    cluster: 'Cluster',
    ledger: 'Log ledger',
    invariants: 'Invariant',
    timeline: 'Linimasa',
    step: 'Langkah',
    time: 'Waktu',
    play: 'Jalankan',
    pause: 'Jeda',
    back: 'Mundur',
    forward: 'Maju',
    start: 'Awal',
    end: 'Akhir',
    speed: 'Kecepatan',
    nextTerm: 'Term berikutnya',
    nextElection: 'Election berikutnya',
    nextCommit: 'Commit berikutnya',
    nextViolation: 'Pelanggaran berikutnya',
    computing: 'Menghitung jejak…',
    inFlight: 'Pesan di jalan',
    noMessages: 'Tidak ada pesan di jalan.',
    event: 'Peristiwa',
    share: 'Salin tautan',
    shared: 'Tautan disalin',
    submit: 'Kirim entry',
    submitHint: 'Kirim ke node mana pun — follower akan meneruskannya ke leader.',
    crash: 'Matikan',
    restart: 'Hidupkan',
    isolate: 'Isolasi',
    heal: 'Sambung ulang',
    truncated: 'Jejak dipotong pada batas peristiwa.',
    seed: 'Seed',
    rerun: 'Jalankan ulang',
  },
  roles: {
    follower: 'Follower',
    candidate: 'Candidate',
    leader: 'Leader',
    crashed: 'Mati',
  },
  ledger: {
    index: 'Index',
    committed: 'Committed',
    applied: 'Applied',
    uncommitted: 'Belum committed',
    empty: 'Log kosong',
    legend:
      'Baris disejajarkan pada index. Log yang menyimpang terbaca sebagai garis yang patah.',
  },
  invariants: {
    holding: 'Berlaku',
    broken: 'Dilanggar',
    allHolding:
      'Kelima properti berlaku. Di bawah tekanan jaringan yang buruk, ini sendiri sudah informatif.',
    atStep: 'pada langkah',
    stepBack: 'Lompat ke sana',
    names: {
      'election-safety': 'Election Safety',
      'leader-append-only': 'Leader Append-Only',
      'log-matching': 'Log Matching',
      'leader-completeness': 'Leader Completeness',
      'state-machine-safety': 'State Machine Safety',
    },
  },
  ablation: {
    lede: 'Setiap aturan yang tidak jelas alasannya di Raft menjaga satu properti keamanan tertentu. Matikan aturannya, lalu lihat propertinya gagal. Itulah rute tercepat untuk memahami mengapa aturan itu ada.',
    protects: 'Menjaga',
    section: 'Bagian makalah',
    figure2: 'Letak di Figure 2',
    callSite: 'Satu-satunya call site',
    scenario: 'Skenario yang membuktikannya',
    on: 'Aktif',
    off: 'Mati',
    modified: 'MODIFIED RAFT',
    modifiedLong:
      'Menjalankan Raft yang sudah dimodifikasi. Perilaku di layar ini bukan Raft. Jangan pakai tangkapan layarnya sebagai gambaran Raft yang sebenarnya.',
    unmodified: 'Raft tanpa modifikasi — keenam aturan aktif.',
    reset: 'Aktifkan semua aturan',
    rules: {
      electionRestriction: {
        title: 'Election restriction',
        body: 'Pemilih menolak candidate yang log-nya kurang up-to-date dibanding log miliknya sendiri — dibandingkan lewat term terakhir dulu, baru index. Inilah yang membuat Leader Completeness berlaku.',
      },
      currentTermCommitRule: {
        title: 'Current-term commit rule',
        body: 'Leader hanya boleh menyatakan sebuah entry committed lewat hitungan replika kalau entry itu berasal dari term-nya sendiri. Entry dari term lama ikut commit secara tidak langsung. Mematikannya mereproduksi Figure 8.',
      },
      appendEntriesConsistencyCheck: {
        title: 'AppendEntries consistency check',
        body: 'AppendEntries membawa prevLogIndex dan prevLogTerm; follower menolak kalau tidak cocok, dan leader menelusuri nextIndex mundur sampai kedua log bertemu. Hanya bagian pencocokan term yang diablasi di sini — menerima melewati ujung log akan melubangi log, bukan membuatnya menyimpang.',
      },
      termIncrementOnCandidacy: {
        title: 'Term increment on candidacy',
        body: 'Menaikkan term adalah yang membuat sebuah pencalonan menjadi pemungutan suara baru. Tanpanya, node yang sudah memilih orang lain mencalonkan diri di term yang sama dan menimpa suaranya sendiri.',
      },
      stepDownOnHigherTerm: {
        title: 'Step down on higher term',
        body: 'Server mana pun yang melihat term lebih tinggi mengadopsinya dan kembali menjadi follower. Yang diablasi hanya perubahan peran, bukan pengadopsian term — mematikan keduanya membuat election buntu, bukan melanggar keamanan.',
      },
      persistVotedFor: {
        title: 'votedFor persistent',
        body: 'votedFor adalah persistent state dan bertahan melewati restart. Kalau hilang, satu node bisa memilih dua kali dalam satu term dan melahirkan dua leader.',
      },
    },
  },
  scenarios: {
    lede: 'Setiap skenario adalah (config, seed, actions, flags) dan satu fenomena yang ingin ditunjukkan. Semuanya replay identik, dan Anda bisa mengambil alih kapan saja.',
    phenomenon: 'Fenomena',
    open: 'Buka',
    breaksWith: 'Rusak kalau aturan ini dimatikan',
  },
}

const en: Dictionary = {
  ...id,
  nav: {
    simulation: 'Simulation',
    scenarios: 'Scenarios',
    ablation: 'Ablation',
    tagline: 'A Raft consensus simulator',
  },
  home: {
    lede: 'A Raft simulator you can break on purpose. Deterministic discrete-event simulation, continuous safety-invariant checking, and an ablation mode that turns individual Raft rules off so you can watch the guarantee they protect actually fail.',
    priorArtTitle: 'Prior art',
    priorArt:
      'RaftScope exists, it is excellent, and it was written by the author of the Raft paper. It is the canonical Raft visualiser — if you want to watch Raft run, start there. The Secret Lives of Data is a fine explainer too.',
    contributionTitle: 'What this adds',
    contribution:
      'Not a replacement for either. Its contribution is narrower: ablation and invariant checking. RaftScope shows you the mechanism; here you switch a rule off and watch the safety property it defends break, while five indicators tell you which one failed and why.',
    start: 'Open the simulation',
    openFigure8: 'Open Figure 8',
    sourceTitle: 'Normative source',
    source:
      'Ongaro & Ousterhout, In Search of an Understandable Consensus Algorithm (USENIX ATC 2014), extended version — Figure 2 in particular. Every rule in lib/raft cites the figure and rule number it implements.',
  },
  sim: {
    cluster: 'Cluster',
    ledger: 'Log ledger',
    invariants: 'Invariants',
    timeline: 'Timeline',
    step: 'Step',
    time: 'Time',
    play: 'Play',
    pause: 'Pause',
    back: 'Back',
    forward: 'Forward',
    start: 'Start',
    end: 'End',
    speed: 'Speed',
    nextTerm: 'Next term change',
    nextElection: 'Next election',
    nextCommit: 'Next commit',
    nextViolation: 'Next violation',
    computing: 'Computing trace…',
    inFlight: 'In flight',
    noMessages: 'Nothing in flight.',
    event: 'Event',
    share: 'Copy link',
    shared: 'Link copied',
    submit: 'Submit entry',
    submitHint: 'Submit to any node — a follower redirects to the leader.',
    crash: 'Crash',
    restart: 'Restart',
    isolate: 'Isolate',
    heal: 'Heal',
    truncated: 'Trace truncated at the event budget.',
    seed: 'Seed',
    rerun: 'Re-run',
  },
  roles: {
    follower: 'Follower',
    candidate: 'Candidate',
    leader: 'Leader',
    crashed: 'Down',
  },
  ledger: {
    index: 'Index',
    committed: 'Committed',
    applied: 'Applied',
    uncommitted: 'Uncommitted',
    empty: 'Empty log',
    legend: 'Rows align on index. A divergent log reads as a broken line.',
  },
  invariants: {
    holding: 'Holding',
    broken: 'Violated',
    allHolding:
      'All five properties hold. Under an adversarial network that is itself informative.',
    atStep: 'at step',
    stepBack: 'Jump there',
    names: id.invariants.names,
  },
  ablation: {
    lede: 'Every non-obvious rule in Raft defends a specific safety property. Turn the rule off and watch the property break — the fastest route to understanding why the rule is there.',
    protects: 'Protects',
    section: 'Paper section',
    figure2: 'In Figure 2',
    callSite: 'Single call site',
    scenario: 'Scenario that proves it',
    on: 'On',
    off: 'Off',
    modified: 'MODIFIED RAFT',
    modifiedLong:
      'This run has a rule switched off. What you are watching is not Raft. Do not screenshot it as though it were.',
    unmodified: 'Unmodified Raft — all six rules enforced.',
    reset: 'Enforce every rule',
    rules: {
      electionRestriction: {
        title: 'Election restriction',
        body: "A voter refuses a candidate whose log is less up-to-date than its own — comparing last term first, then index. This is what makes Leader Completeness hold.",
      },
      currentTermCommitRule: {
        title: 'Current-term commit rule',
        body: "A leader may only mark an entry committed by counting replicas if that entry is from its own term. Older entries commit indirectly. Removing this reproduces Figure 8.",
      },
      appendEntriesConsistencyCheck: {
        title: 'AppendEntries consistency check',
        body: 'AppendEntries carries prevLogIndex and prevLogTerm; the follower rejects on mismatch and the leader walks nextIndex back until the logs agree. Only the term half is ablated here — accepting past the end of a log would punch a hole in it rather than diverge it.',
      },
      termIncrementOnCandidacy: {
        title: 'Term increment on candidacy',
        body: 'Incrementing the term is what makes a campaign a new ballot. Without it, a server that has already voted for someone else campaigns inside the same term and overwrites its own vote.',
      },
      stepDownOnHigherTerm: {
        title: 'Step down on higher term',
        body: 'Any server seeing a higher term adopts it and reverts to follower. Only the role change is ablated, not the term adoption — suppressing both deadlocks elections rather than breaking safety.',
      },
      persistVotedFor: {
        title: 'Persistent votedFor',
        body: 'votedFor is persistent state and survives a restart. Lose it and one server can vote twice in a term, electing two leaders in it.',
      },
    },
  },
  scenarios: {
    lede: 'Each scenario is (config, seed, actions, flags) and one phenomenon it exists to show. They replay identically, and you can take control at any point.',
    phenomenon: 'Phenomenon',
    open: 'Open',
    breaksWith: 'Breaks with this rule off',
  },
}

const DICTIONARIES: Readonly<Record<Locale, Dictionary>> = { id, en }

export function dictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale]
}

export type { Dictionary }
