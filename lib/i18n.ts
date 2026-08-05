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
  /**
   * The plain-language layer.
   *
   * Everything else in this file assumes the reader knows what a *term* or an
   * *AppendEntries* is. This section assumes nothing. It is not a simplification of
   * the technical copy sitting beside it — both are true, and the reader chooses
   * which altitude to read at.
   */
  readonly plain: {
    readonly headline: string
    readonly lede: string
    readonly whyHard: string
    readonly stepsTitle: string
    readonly steps: readonly { readonly title: string; readonly body: string }[]
    readonly tryTitle: string
    readonly legendTitle: string
    readonly roles: Readonly<Record<'follower' | 'candidate' | 'leader' | 'crashed', string>>
    readonly propertiesTitle: string
    readonly propertiesIntro: string
    readonly properties: Readonly<Record<string, string>>
    readonly messagesTitle: string
    readonly messages: readonly { readonly code: string; readonly body: string }[]
    readonly whatHappening: string
    readonly technicalDetail: string
    readonly newHere: string
    readonly guide: string
    readonly hide: string
    readonly clusterHelp: string
    readonly ledgerHelp: string
    readonly invariantsHelp: string
    readonly ablationHelp: string
    readonly forExperts: string
    readonly readMore: string
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
    readonly jumpTo: string
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
    readonly configuration: string
    readonly addServer: string
    readonly removeServer: string
  }
  readonly roles: Readonly<Record<'follower' | 'candidate' | 'leader' | 'crashed', string>>
  readonly ledger: {
    readonly index: string
    readonly committed: string
    readonly applied: string
    readonly uncommitted: string
    readonly empty: string
    readonly legend: string
    readonly compacted: string
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
    readonly ifOff: string
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
  plain: {
    headline: 'Beberapa komputer, satu daftar yang sama.',
    lede: 'Layanan besar tidak menyimpan datanya di satu komputer — kalau komputer itu mati, habis sudah. Datanya disimpan di beberapa komputer sekaligus, dan semuanya harus punya daftar catatan yang isinya persis sama. Masalahnya: komputer bisa mati kapan saja, dan jaringan bisa putus di tengah pengiriman. Raft adalah aturan main yang membuat mereka tetap sepakat meski hal-hal itu terjadi.',
    whyHard: 'Bagian yang baru saja Anda baca adalah bagian yang mudah. Yang sulit adalah beberapa aturan kecil di Raft yang terlihat berlebihan — sampai Anda mematikannya. Itulah yang bisa Anda lakukan di sini: matikan satu aturan, lalu tonton jaminan yang dijaganya runtuh di depan mata.',
    stepsTitle: 'Cara kerjanya, singkatnya',
    steps: [
      {
        title: 'Satu ketua dipilih',
        body: 'Setiap komputer menunggu kabar. Yang paling lama tidak mendengar kabar akan mencalonkan diri dan meminta suara. Begitu lebih dari separuh memilihnya, ia menjadi leader — satu-satunya yang boleh mencatat hal baru.',
      },
      {
        title: 'Catatan disalin ke semua',
        body: 'Setiap catatan baru dikirim leader ke semua anggota. Begitu lebih dari separuh menyimpannya, catatan itu dinyatakan committed: sah, dan tidak boleh berubah lagi selamanya.',
      },
      {
        title: 'Yang tertinggal disusulkan',
        body: 'Komputer yang sempat mati atau terputus akan disamakan catatannya begitu tersambung lagi. Kalau catatannya sempat menyimpang, bagian yang salah ditimpa oleh milik leader.',
      },
    ],
    tryTitle: 'Mulai dari mana',
    legendTitle: 'Cara membaca gambar',
    roles: {
      follower: 'Anggota biasa. Menunggu kabar dari leader dan menyalin catatannya.',
      candidate: 'Sedang mencalonkan diri dan meminta suara untuk menjadi leader.',
      leader: 'Ketua. Satu-satunya yang boleh menerima catatan baru dan menyebarkannya.',
      crashed: 'Sedang mati. Tidak mengirim dan tidak menerima apa pun.',
    },
    propertiesTitle: 'Lima janji yang tidak boleh dilanggar',
    propertiesIntro: 'Raft berjanji lima hal. Aplikasi ini memeriksa kelimanya setelah setiap peristiwa — bukan di akhir, tapi terus-menerus — dan menyebutkan mana yang gagal begitu ada yang gagal.',
    properties: {
      'election-safety': 'Tidak pernah ada dua ketua sekaligus dalam satu putaran.',
      'leader-append-only': 'Ketua hanya menambah catatan di ujung; ia tidak pernah menghapus catatannya sendiri.',
      'log-matching': 'Kalau dua komputer punya catatan yang sama di satu baris, seluruh catatan di atasnya juga sama.',
      'leader-completeness': 'Catatan yang sudah sah tidak akan pernah hilang dari ketua mana pun sesudahnya.',
      'state-machine-safety': 'Tidak akan ada dua komputer yang menjalankan isi berbeda pada baris yang sama.',
    },
    messagesTitle: 'Pesan yang berlalu-lalang',
    messages: [
      { code: 'RV', body: 'Minta suara — sebuah calon meminta dipilih.' },
      { code: 'RV✓', body: 'Suara diberikan.' },
      { code: 'RV✗', body: 'Suara ditolak.' },
      { code: 'HB', body: 'Kabar berkala dari leader: “saya masih memimpin”.' },
      { code: 'AE·n', body: 'Leader mengirim n catatan baru untuk disalin.' },
      { code: 'AE✓', body: 'Catatan diterima; kedua log cocok.' },
      { code: 'AE✗', body: 'Ditolak — catatan sebelumnya tidak cocok. Leader akan mundur satu baris.' },
      { code: 'IS', body: 'Snapshot dikirim, karena penerimanya tertinggal terlalu jauh.' },
    ],
    whatHappening: 'Yang sedang terjadi',
    technicalDetail: 'Rincian teknis',
    newHere: 'Baru pertama di sini?',
    guide: 'Panduan singkat',
    hide: 'Sembunyikan',
    clusterHelp: 'Setiap bentuk adalah satu komputer. Kotak kecil di antaranya adalah pesan yang sedang dalam perjalanan — pesan butuh waktu untuk sampai, dan sebagian tidak pernah sampai.',
    ledgerHelp: 'Ini daftar catatan setiap komputer, berdampingan, sejajar pada nomor baris. Selama semua kolom sama, semua sepakat. Baris yang bolong atau berbeda isi berarti catatan mereka menyimpang — dan Anda bisa menonton leader memperbaikinya.',
    invariantsHelp: 'Kelima janji Raft, diperiksa ulang setelah setiap peristiwa. Selama semuanya hijau, algoritmanya bertahan. Kalau satu berubah merah, di situlah letak kerusakannya.',
    ablationHelp: 'Matikan salah satu aturan di bawah ini, lalu jalankan lagi. Aturan yang tampak berlebihan akan menunjukkan gunanya begitu ia tidak ada.',
    forExperts: 'Untuk yang sudah kenal Raft',
    readMore: 'Selengkapnya',
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
    jumpTo: 'Lompat ke',
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
    configuration: 'Konfigurasi',
    addServer: 'Tambahkan',
    removeServer: 'Keluarkan',
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
    compacted: 'sudah di-snapshot (§7)',
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
    unmodified: 'Raft tanpa modifikasi — semua aturan ditegakkan.',
    reset: 'Aktifkan semua aturan',
    ifOff: 'Kalau aturan ini dimatikan, janji berikut bisa gagal',
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
      jointConsensus: {
        title: 'Joint consensus',
        body: 'Perubahan keanggotaan melewati konfigurasi peralihan C-old,new, di mana kesepakatan menuntut mayoritas dari himpunan lama *dan* himpunan baru sekaligus. Tanpa itu, cluster berpindah langsung dari C-old ke C-new — dan karena tidak ada satu saat pun semua server berpindah bersamaan, dua mayoritas yang tidak beririsan bisa memilih dua leader di term yang sama. Itulah Figure 10.',
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
  plain: {
    headline: 'Several computers, one identical list.',
    lede: 'Large services do not keep their data on a single computer — if that one dies, everything is gone. The data lives on several computers at once, and every one of them has to hold exactly the same list of records. The difficulty: any of them can die at any moment, and the network can cut out mid-delivery. Raft is the rulebook that keeps them in agreement anyway.',
    whyHard: 'What you just read is the easy part. The hard part is a handful of small rules in Raft that look redundant — until you switch one off. That is what this app is for: turn a rule off, then watch the guarantee it was defending collapse in front of you.',
    stepsTitle: 'How it works, briefly',
    steps: [
      {
        title: 'One leader is elected',
        body: 'Every computer waits to hear from a leader. Whichever waits longest without hearing anything stands for election and asks for votes. Once more than half vote for it, it is the leader — the only one allowed to record anything new.',
      },
      {
        title: 'Records are copied to everyone',
        body: 'The leader sends each new record to all the others. Once more than half have stored it, it is declared committed: settled, and never to change again.',
      },
      {
        title: 'Stragglers are brought back into line',
        body: 'A computer that was down or cut off gets its list reconciled as soon as it is reachable again. If its list had diverged, the wrong part is overwritten by the leader’s.',
      },
    ],
    tryTitle: 'Where to start',
    legendTitle: 'How to read the picture',
    roles: {
      follower: 'An ordinary member. Waits to hear from the leader and copies its records.',
      candidate: 'Currently standing for election and asking the others for their votes.',
      leader: 'In charge. The only one that accepts new records and distributes them.',
      crashed: 'Currently down. Sends nothing and receives nothing.',
    },
    propertiesTitle: 'Five promises that must never break',
    propertiesIntro: 'Raft promises five things. This app checks all five after every single event — not at the end, but continuously — and names the one that failed the moment it fails.',
    properties: {
      'election-safety': 'There are never two leaders at once in the same round.',
      'leader-append-only': 'A leader only ever adds to the end of its list; it never deletes its own records.',
      'log-matching': 'If two computers hold the same record at a row, everything above that row is identical too.',
      'leader-completeness': 'A record that has been settled never goes missing from any later leader.',
      'state-machine-safety': 'No two computers ever act on different contents at the same row.',
    },
    messagesTitle: 'The messages in flight',
    messages: [
      { code: 'RV', body: 'Asking for a vote — a candidate wants to be elected.' },
      { code: 'RV✓', body: 'Vote granted.' },
      { code: 'RV✗', body: 'Vote refused.' },
      { code: 'HB', body: 'A leader’s periodic “I am still in charge”.' },
      { code: 'AE·n', body: 'The leader is sending n new records to be copied.' },
      { code: 'AE✓', body: 'Records accepted; the two lists agree.' },
      { code: 'AE✗', body: 'Rejected — the preceding record does not match. The leader backs up a row.' },
      { code: 'IS', body: 'A snapshot, sent because the receiver has fallen too far behind.' },
    ],
    whatHappening: 'What is happening',
    technicalDetail: 'Technical detail',
    newHere: 'First time here?',
    guide: 'Quick guide',
    hide: 'Hide',
    clusterHelp: 'Each shape is one computer. The little boxes between them are messages in flight — messages take time to arrive, and some never arrive at all.',
    ledgerHelp: 'Every computer’s list of records, side by side, aligned on row number. While the columns match, everyone agrees. A gap or a different value means their lists have diverged — and you can watch the leader repair it.',
    invariantsHelp: 'Raft’s five promises, re-checked after every event. While they are all green the algorithm is holding. When one turns red, that is where it broke.',
    ablationHelp: 'Switch one of the rules below off, then run it again. A rule that looks redundant makes its case the moment it is gone.',
    forExperts: 'If you already know Raft',
    readMore: 'More',
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
    jumpTo: 'Jump to',
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
    configuration: 'Configuration',
    addServer: 'Add',
    removeServer: 'Remove',
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
    compacted: 'snapshotted away (§7)',
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
    unmodified: 'Unmodified Raft — every rule enforced.',
    reset: 'Enforce every rule',
    ifOff: 'Switch this rule off and the following promise can fail',
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
      jointConsensus: {
        title: 'Joint consensus',
        body: "A membership change passes through a transitional configuration C-old,new, in which agreement requires a majority of the old set *and* of the new one. Without it the cluster switches straight from C-old to C-new — and since there is no instant at which every server switches together, two disjoint majorities can elect two leaders in the same term. That is Figure 10.",
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
