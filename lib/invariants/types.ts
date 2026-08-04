/**
 * Types for the invariant checker.
 *
 * This module deliberately imports **nothing** — not even types from `lib/raft`. The
 * checker evaluates the five safety properties from their published definitions over
 * a structural snapshot of the cluster. A checker that shared the implementation's
 * types and assumptions would validate its own bugs, and that isolation is not
 * negotiable. The simulation converts its state into these shapes at the boundary.
 */

/** The five safety properties, Raft paper §5.4.3, Figure 3. */
export type SafetyProperty =
  | 'election-safety'
  | 'leader-append-only'
  | 'log-matching'
  | 'leader-completeness'
  | 'state-machine-safety'

export const SAFETY_PROPERTIES: readonly SafetyProperty[] = [
  'election-safety',
  'leader-append-only',
  'log-matching',
  'leader-completeness',
  'state-machine-safety',
]

/** The property statements, verbatim from Figure 3 of the paper. */
export const PROPERTY_STATEMENTS: Readonly<Record<SafetyProperty, string>> = {
  'election-safety': 'At most one leader can be elected in a given term.',
  'leader-append-only':
    'A leader never overwrites or deletes entries in its log; it only appends new entries.',
  'log-matching':
    'If two logs contain an entry with the same index and term, then the logs are identical in all entries up through the given index.',
  'leader-completeness':
    'If a log entry is committed in a given term, then that entry will be present in the logs of the leaders for all higher-numbered terms.',
  'state-machine-safety':
    'If a server has applied a log entry at a given index to its state machine, no other server will ever apply a different log entry for the same index.',
}

/** A log entry, described structurally. */
export interface SnapshotEntry {
  readonly term: number
  readonly command: string
}

/** One server, as the checker sees it. Roles are strings, not the algorithm's union. */
export interface NodeSnapshot {
  readonly id: number
  readonly isLeader: boolean
  readonly currentTerm: number
  readonly log: readonly SnapshotEntry[]
  /**
   * The highest index this server considers committed. The checker takes the
   * server's word for it — that is precisely what makes the check meaningful. If the
   * implementation commits something it should not have, the checker sees the claim
   * and holds the algorithm to it.
   */
  readonly commitIndex: number
  /** Commands applied to the state machine, by 1-based index: `applied[i - 1]`. */
  readonly applied: readonly (string | undefined)[]
  readonly lastApplied: number
}

export interface ClusterSnapshot {
  readonly stepIndex: number
  readonly time: number
  readonly nodes: readonly NodeSnapshot[]
}

export interface Violation {
  readonly property: SafetyProperty
  readonly stepIndex: number
  readonly time: number
  /** Log index the violation concerns, where the property is about an entry. */
  readonly logIndex: number | null
  /** Servers involved, ascending. */
  readonly nodes: readonly number[]
  /** Terms involved, in the order they are referred to in the summary. */
  readonly terms: readonly number[]
  /** Flat English statement of the mechanism. The UI renders Indonesian from the fields. */
  readonly summary: string
}

/** Accumulated observations. Violations are historical facts, so the checker remembers. */
export interface CheckerState {
  /** Leaders seen per term, ascending by term. */
  readonly leadersByTerm: readonly { readonly term: number; readonly leader: number }[]
  /** The last log observed for each node while it held leadership in a given term. */
  readonly leaderLogs: readonly (LeaderLogRecord | null)[]
  /** Entries observed as committed, by 1-based index. */
  readonly committed: readonly (CommittedRecord | undefined)[]
  /** Commands observed as applied, by 1-based index. */
  readonly appliedAt: readonly (AppliedRecord | undefined)[]
  /** Properties that have been violated at least once in this run. */
  readonly broken: readonly SafetyProperty[]
}

export interface LeaderLogRecord {
  readonly term: number
  readonly log: readonly SnapshotEntry[]
}

export interface CommittedRecord {
  readonly entry: SnapshotEntry
  /** `currentTerm` of the first server observed to consider this index committed. */
  readonly committedInTerm: number
  readonly byNode: number
}

export interface AppliedRecord {
  readonly command: string
  readonly byNode: number
}

export const EMPTY_CHECKER_STATE: CheckerState = {
  leadersByTerm: [],
  leaderLogs: [],
  committed: [],
  appliedAt: [],
  broken: [],
}
