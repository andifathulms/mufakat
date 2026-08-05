/**
 * Ablation guards.
 *
 * Every non-obvious rule in Raft defends a specific safety property. Turning a rule
 * off and watching its property break is the fastest route to understanding why the
 * rule is there — and it is this project's reason to exist.
 *
 * Each guard lives here and is consulted at **exactly one** call site, named in the
 * descriptor below. That is what makes a toggle honest rather than cosmetic: there is
 * no second place where the rule is quietly still enforced, and no way for a toggle
 * to be a UI label with nothing behind it.
 *
 * A run with any flag off is *modified Raft* and is labelled as such, permanently and
 * visibly, everywhere it can be seen or shared.
 */

// The five properties are defined by the checker, not by the algorithm. The
// dependency points this way on purpose: `lib/invariants` imports nothing at all,
// so it cannot inherit an assumption from the implementation it is checking.
import type { SafetyProperty } from '@/lib/invariants/types'

export interface AblationFlags {
  /**
   * §5.4.1 — a voter refuses a candidate whose log is less up-to-date than its own.
   * Defends Leader Completeness.
   */
  readonly electionRestriction: boolean
  /**
   * §5.4.2 — a leader may only commit by counting replicas for entries from its
   * *own* term. Older entries commit indirectly. Removing this reproduces Figure 8.
   */
  readonly currentTermCommitRule: boolean
  /**
   * §5.3 — AppendEntries carries `prevLogIndex`/`prevLogTerm` and the follower
   * rejects on mismatch. Defends Log Matching.
   */
  readonly appendEntriesConsistencyCheck: boolean
  /** §5.2 — a candidate increments `currentTerm` when it starts an election. */
  readonly termIncrementOnCandidacy: boolean
  /** §5.1 — any server seeing a higher term adopts it and reverts to follower. */
  readonly stepDownOnHigherTerm: boolean
  /** §5.2 — `votedFor` is persistent state and survives a restart. */
  readonly persistVotedFor: boolean
  /**
   * §6 — a membership change passes through a joint configuration C-old,new in which
   * agreement requires separate majorities of both the old and the new server sets.
   * Defends Election Safety; removing it is Figure 10.
   */
  readonly jointConsensus: boolean
}

/** Unmodified Raft: every rule enforced. The only configuration that is Raft. */
export const UNMODIFIED_RAFT: AblationFlags = {
  electionRestriction: true,
  currentTermCommitRule: true,
  appendEntriesConsistencyCheck: true,
  termIncrementOnCandidacy: true,
  stepDownOnHigherTerm: true,
  persistVotedFor: true,
  jointConsensus: true,
}

export type AblationFlagName = keyof AblationFlags

export const ABLATION_FLAG_NAMES: readonly AblationFlagName[] = [
  'electionRestriction',
  'currentTermCommitRule',
  'appendEntriesConsistencyCheck',
  'termIncrementOnCandidacy',
  'stepDownOnHigherTerm',
  'persistVotedFor',
  'jointConsensus',
]

export interface RuleDescriptor {
  readonly flag: AblationFlagName
  /** The property that breaks when this rule is off. */
  readonly protects: SafetyProperty
  /** Section of the paper that justifies the rule. */
  readonly paperSection: string
  /** Where in Figure 2 the rule appears. */
  readonly figure2: string
  /** The single call site consulting this guard. */
  readonly callSite: string
  /** Scenario in the library that breaks when this rule is off. */
  readonly scenarioId: string
}

export const RULE_DESCRIPTORS: readonly RuleDescriptor[] = [
  {
    flag: 'electionRestriction',
    protects: 'leader-completeness',
    paperSection: '§5.4.1',
    figure2: 'RequestVote RPC, receiver rule 2',
    callSite: 'lib/raft/election.ts — handleRequestVote',
    scenarioId: 'election-restriction-overwrite',
  },
  {
    flag: 'currentTermCommitRule',
    protects: 'state-machine-safety',
    paperSection: '§5.4.2',
    figure2: 'Rules for Servers, Leaders, final rule',
    callSite: 'lib/raft/commit.ts — advanceCommitIndex',
    scenarioId: 'figure-8',
  },
  {
    flag: 'appendEntriesConsistencyCheck',
    protects: 'log-matching',
    paperSection: '§5.3',
    figure2: 'AppendEntries RPC, receiver rule 2',
    callSite: 'lib/raft/replication.ts — handleAppendEntries',
    scenarioId: 'log-matching-break',
  },
  {
    flag: 'termIncrementOnCandidacy',
    protects: 'election-safety',
    paperSection: '§5.2',
    figure2: 'Rules for Servers, Candidates, rule 1',
    callSite: 'lib/raft/election.ts — startElection',
    scenarioId: 'double-candidacy',
  },
  {
    flag: 'stepDownOnHigherTerm',
    protects: 'election-safety',
    paperSection: '§5.1',
    figure2: 'Rules for Servers, All Servers, rule 2',
    callSite: 'lib/raft/node.ts — observeTerm',
    scenarioId: 'partition-stranded-leader',
  },
  {
    flag: 'persistVotedFor',
    protects: 'election-safety',
    paperSection: '§5.2',
    figure2: 'State, Persistent state on all servers',
    callSite: 'lib/raft/node.ts — restart',
    scenarioId: 'double-vote-restart',
  },
  {
    flag: 'jointConsensus',
    protects: 'election-safety',
    paperSection: '§6',
    figure2: 'Not in Figure 2 — Figure 10, and §6',
    callSite: 'lib/raft/replication.ts — beginConfigurationChange',
    scenarioId: 'membership-change',
  },
]

// ---------------------------------------------------------------------------
// The guards. One function each; one call site each.
// ---------------------------------------------------------------------------

/**
 * Consulted in `lib/raft/election.ts — handleRequestVote`.
 * Off: voters grant votes regardless of how up-to-date the candidate's log is, so a
 * node missing committed entries can win — breaking Leader Completeness.
 */
export function enforceElectionRestriction(flags: AblationFlags): boolean {
  return flags.electionRestriction
}

/**
 * Consulted in `lib/raft/commit.ts — advanceCommitIndex`.
 * Off: a leader commits entries from previous terms by counting replicas, which is
 * exactly the Figure 8 hazard — such an entry can still be overwritten later.
 */
export function enforceCurrentTermCommitRule(flags: AblationFlags): boolean {
  return flags.currentTermCommitRule
}

/**
 * Consulted in `lib/raft/replication.ts — handleAppendEntries`.
 * Off: the follower accepts an AppendEntries whose `prevLogTerm` disagrees with its
 * own log, so two logs can hold the same (index, term) over different prefixes —
 * breaking Log Matching.
 *
 * Only the *term* half of the check is ablated. The length half — rejecting when the
 * follower has no entry at `prevLogIndex` — is retained, because accepting there
 * would punch a hole in the log rather than diverge it, and a log with holes is not
 * a Raft log at all. This is the honest ablation: it removes the guarantee, not the
 * data structure.
 */
export function enforceAppendEntriesConsistencyCheck(flags: AblationFlags): boolean {
  return flags.appendEntriesConsistencyCheck
}

/**
 * Consulted in `lib/raft/election.ts — startElection`.
 * Off: a candidate campaigns in the term it is already in, having possibly already
 * voted for someone else in it — so two leaders can be elected in one term, breaking
 * Election Safety.
 */
export function incrementTermOnCandidacy(flags: AblationFlags): boolean {
  return flags.termIncrementOnCandidacy
}

/**
 * Consulted in `lib/raft/node.ts — observeTerm`.
 * Off: a superseded leader adopts the higher term but keeps its role, so it goes on
 * issuing AppendEntries as leader of the same term as the server that deposed it.
 *
 * Only the conversion is ablated, not the term adoption. Suppressing both would
 * deadlock elections rather than break a safety property — every server would hold
 * the vote it cast in its old term forever — and that would teach the wrong lesson
 * about what this rule defends.
 */
export function stepDownOnHigherTerm(flags: AblationFlags): boolean {
  return flags.stepDownOnHigherTerm
}

/**
 * Consulted in `lib/raft/node.ts — restart`.
 * Off: `votedFor` is lost on restart, so a node can vote twice in one term and elect
 * two leaders in it — breaking Election Safety. `currentTerm` and the log remain
 * persistent; only the vote record is ablated.
 */
export function persistVotedForAcrossRestart(flags: AblationFlags): boolean {
  return flags.persistVotedFor
}

// ---------------------------------------------------------------------------

/**
 * Consulted in `lib/raft/replication.ts — beginConfigurationChange`.
 * Off: the leader switches straight from C-old to C-new with no transitional
 * configuration, so for a while some servers believe C-old and others C-new. Those two
 * sets can contain *disjoint* majorities — and two disjoint majorities elect two
 * leaders in the same term. This is Figure 10, and it is the reason joint consensus
 * exists rather than the obvious one-step switch.
 */
export function enforceJointConsensus(flags: AblationFlags): boolean {
  return flags.jointConsensus
}

/** True if any rule is off. Such a run is labelled *modified Raft* everywhere. */
export function isModifiedRaft(flags: AblationFlags): boolean {
  return ABLATION_FLAG_NAMES.some((name) => !flags[name])
}

/** The disabled rules, in a stable order, for labelling and for share links. */
export function disabledRules(flags: AblationFlags): readonly AblationFlagName[] {
  return ABLATION_FLAG_NAMES.filter((name) => !flags[name])
}

export function descriptorFor(flag: AblationFlagName): RuleDescriptor {
  const found = RULE_DESCRIPTORS.find((rule) => rule.flag === flag)
  if (found === undefined) throw new Error(`No descriptor for ablation flag ${flag}`)
  return found
}
