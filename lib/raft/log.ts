/**
 * The log, and the one documented place where the paper's 1-based indexing meets
 * JavaScript's 0-based arrays.
 *
 * The paper numbers log entries from 1, and index 0 means "before the first entry"
 * with an implicit term of 0. Every rule in Figure 2 is written in those terms, so
 * the algorithm code stays 1-based and the offset lives here.
 *
 * Log compaction (§7) makes that offset a *variable*. Once a server has snapshotted
 * through some index, the entries at and below it are gone, and the array no longer
 * starts at log index 1 — it starts at `lastIncludedIndex + 1`. A bare
 * `readonly LogEntry[]` cannot express that, and any code holding one would silently
 * compute the wrong index the moment a snapshot happened.
 *
 * So the log is a *bundle* of the entries a server still holds and the snapshot point
 * beneath them. Nothing outside this file indexes `entries` directly. That is not
 * style: with a fixed offset a mistake is a constant-off-by-one that every test
 * catches, and with a variable offset it is a bug that only appears after the first
 * snapshot, in one branch, under load.
 */

import type { LogEntry } from './types'

/** The index before the first entry. `prevLogIndex` is 0 for an empty leader log. */
export const NO_INDEX = 0

/** The term at `NO_INDEX`. Chosen so the consistency check trivially passes there. */
export const NO_TERM = 0

export interface Log {
  /**
   * The entries this server still holds, covering log indices
   * `lastIncludedIndex + 1` through `lastIncludedIndex + entries.length`.
   */
  readonly entries: readonly LogEntry[]
  /**
   * Figure 13, State: the index of the last entry the snapshot replaces. 0 when
   * nothing has been compacted, which is also the state every server starts in.
   */
  readonly lastIncludedIndex: number
  /** Figure 13, State: the term of the entry at `lastIncludedIndex`. */
  readonly lastIncludedTerm: number
}

export const EMPTY_LOG: Log = { entries: [], lastIncludedIndex: NO_INDEX, lastIncludedTerm: NO_TERM }

/** A log that has never been compacted, holding `entries` from index 1. */
export function logFrom(entries: readonly LogEntry[]): Log {
  return { entries, lastIncludedIndex: NO_INDEX, lastIncludedTerm: NO_TERM }
}

/** The entries still held, in index order. For rendering and for digests only. */
export function heldEntries(log: Log): readonly LogEntry[] {
  return log.entries
}

/** Lowest index this server still holds an entry for. */
export function firstLogIndex(log: Log): number {
  return log.lastIncludedIndex + 1
}

/** Index of the last entry, or `lastIncludedIndex` when nothing is held. */
export function lastLogIndex(log: Log): number {
  return log.lastIncludedIndex + log.entries.length
}

/** True when `index` names an entry this server still holds. */
export function hasIndex(log: Log, index: number): boolean {
  return index >= firstLogIndex(log) && index <= lastLogIndex(log)
}

/**
 * True when this server can state the term at `index` — either it holds the entry, or
 * `index` is exactly the snapshot point, whose term it remembers. Below the snapshot
 * point the term is genuinely unknown: those entries have been discarded.
 */
export function knowsTerm(log: Log, index: number): boolean {
  if (index === NO_INDEX) return true
  if (index === log.lastIncludedIndex) return true
  return hasIndex(log, index)
}

/** Entry at a 1-based index, or undefined if not held. */
export function entryAt(log: Log, index: number): LogEntry | undefined {
  if (!hasIndex(log, index)) return undefined
  // The single place the offset is applied.
  return log.entries[index - log.lastIncludedIndex - 1]
}

/**
 * Term at a 1-based index.
 *
 * Returns `NO_TERM` for an index that has been snapshotted away or is past the end.
 * That is deliberately the *safe* direction: no real entry has term 0, so a
 * consistency check against an unknown index fails and the leader backs off — which
 * is exactly what should happen, and is what eventually makes it send a snapshot.
 * Callers that need to tell "unknown" from "absent" use `knowsTerm`.
 */
export function termAt(log: Log, index: number): number {
  if (index === NO_INDEX) return NO_TERM
  if (index === log.lastIncludedIndex) return log.lastIncludedTerm
  return entryAt(log, index)?.term ?? NO_TERM
}

/** Term of the last entry; the snapshot's term when no entries are held. */
export function lastLogTerm(log: Log): number {
  return termAt(log, lastLogIndex(log))
}

/** Number of entries held. Not the last index — use `lastLogIndex` for that. */
export function heldCount(log: Log): number {
  return log.entries.length
}

/** Entries from `index` to the end, inclusive. Clamped to what is still held. */
export function sliceFrom(log: Log, index: number): readonly LogEntry[] {
  const from = Math.max(index, firstLogIndex(log))
  if (from > lastLogIndex(log)) return []
  return log.entries.slice(from - log.lastIncludedIndex - 1)
}

/** The prefix ending at `index`, inclusive. Never resurrects compacted entries. */
export function truncateTo(log: Log, index: number): Log {
  if (index >= lastLogIndex(log)) return log
  const keep = Math.max(0, index - log.lastIncludedIndex)
  return { ...log, entries: log.entries.slice(0, keep) }
}

/** Append entries at the end. */
export function append(log: Log, entries: readonly LogEntry[]): Log {
  if (entries.length === 0) return log
  return { ...log, entries: [...log.entries, ...entries] }
}

/** Replace the entry at `index` and drop everything after it. */
export function replaceFrom(log: Log, index: number, entry: LogEntry): Log {
  return append(truncateTo(log, index - 1), [entry])
}

/** Terms of the held entries, in index order. For fixtures and trace digests. */
export function logTerms(log: Log): number[] {
  return log.entries.map((entry) => entry.term)
}

// ---------------------------------------------------------------------------
// Compaction, §7
// ---------------------------------------------------------------------------

/**
 * Discard the entries at and below `throughIndex`, keeping their summary as the
 * snapshot point. §7: "the entire log up to the point of the snapshot is discarded."
 *
 * A server may only compact up to `lastApplied` — discarding an entry it has not
 * applied would lose it — and the caller is responsible for that. Compacting to an
 * index the server does not hold the term for is refused rather than guessed at.
 */
export function compact(log: Log, throughIndex: number): Log {
  if (throughIndex <= log.lastIncludedIndex) return log
  if (!knowsTerm(log, throughIndex)) return log
  const term = termAt(log, throughIndex)
  return {
    entries: sliceFrom(log, throughIndex + 1),
    lastIncludedIndex: throughIndex,
    lastIncludedTerm: term,
  }
}

/**
 * Figure 13, InstallSnapshot RPC, receiver rules 6 and 7:
 *
 *   6. "If existing log entry has same index and term as snapshot's last included
 *       entry, retain log entries following it and reply"
 *   7. "Discard the entire log"
 *
 * Rule 6 is not an optimisation to be skipped. A follower that has entries beyond the
 * snapshot point which the leader has not yet sent would lose them under rule 7 and
 * have to fetch them again — correct, but slower. Keeping the two apart is what makes
 * the distinction in the figure visible rather than collapsed.
 */
export function installSnapshot(log: Log, lastIncludedIndex: number, lastIncludedTerm: number): Log {
  // A stale snapshot: the server has already compacted at least this far.
  if (lastIncludedIndex <= log.lastIncludedIndex) return log

  // Rule 6.
  if (hasIndex(log, lastIncludedIndex) && termAt(log, lastIncludedIndex) === lastIncludedTerm) {
    return {
      entries: sliceFrom(log, lastIncludedIndex + 1),
      lastIncludedIndex,
      lastIncludedTerm,
    }
  }

  // Rule 7.
  return { entries: [], lastIncludedIndex, lastIncludedTerm }
}

/**
 * Figure 2, RequestVote RPC, receiver rule 2 / §5.4.1 — "at least as up-to-date".
 *
 * Raft compares logs by *last term first, then length*. Comparing length alone is the
 * single most common way to get this wrong, and it silently breaks Leader
 * Completeness: a node with a long log of stale entries would beat a node with a
 * shorter log containing a committed entry from a later term.
 *
 * Compaction changes nothing here, because `lastLogIndex` and `lastLogTerm` are
 * absolute — a server that has snapshotted everything still reports the right pair.
 */
export function isAtLeastAsUpToDate(
  candidateLastTerm: number,
  candidateLastIndex: number,
  voterLog: Log,
): boolean {
  const voterLastTerm = lastLogTerm(voterLog)
  const voterLastIndex = lastLogIndex(voterLog)
  if (candidateLastTerm !== voterLastTerm) return candidateLastTerm > voterLastTerm
  return candidateLastIndex >= voterLastIndex
}
