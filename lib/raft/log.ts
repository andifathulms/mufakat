/**
 * The one documented place where the paper's 1-based log indexing meets JavaScript's
 * 0-based arrays.
 *
 * The paper numbers log entries from 1, and index 0 means "before the first entry"
 * with an implicit term of 0. Every rule in Figure 2 is written in those terms, so
 * the algorithm code stays 1-based and the offset lives here. Nothing outside this
 * file may index `log` directly.
 */

import type { LogEntry } from './types'

/** The index before the first entry. `prevLogIndex` is 0 for an empty leader log. */
export const NO_INDEX = 0

/** The term at `NO_INDEX`. Chosen so the consistency check trivially passes there. */
export const NO_TERM = 0

/** Index of the last entry, or `NO_INDEX` for an empty log. */
export function lastLogIndex(log: readonly LogEntry[]): number {
  return log.length
}

/** Entry at a 1-based index, or undefined if absent. */
export function entryAt(log: readonly LogEntry[], index: number): LogEntry | undefined {
  if (index < 1 || index > log.length) return undefined
  return log[index - 1]
}

/** Term at a 1-based index; `NO_TERM` at index 0, and for any index past the end. */
export function termAt(log: readonly LogEntry[], index: number): number {
  if (index === NO_INDEX) return NO_TERM
  return entryAt(log, index)?.term ?? NO_TERM
}

/** Term of the last entry, or `NO_TERM` for an empty log. */
export function lastLogTerm(log: readonly LogEntry[]): number {
  return termAt(log, lastLogIndex(log))
}

/** True if the log holds an entry at `index`. */
export function hasIndex(log: readonly LogEntry[], index: number): boolean {
  return index >= 1 && index <= log.length
}

/** Entries from `index` to the end, inclusive. */
export function sliceFrom(log: readonly LogEntry[], index: number): readonly LogEntry[] {
  if (index < 1) return log
  return log.slice(index - 1)
}

/** The prefix ending at `index`, inclusive. `truncateTo(log, 0)` is the empty log. */
export function truncateTo(log: readonly LogEntry[], index: number): readonly LogEntry[] {
  if (index >= log.length) return log
  return log.slice(0, Math.max(0, index))
}

/** Append entries at the end. */
export function append(
  log: readonly LogEntry[],
  entries: readonly LogEntry[],
): readonly LogEntry[] {
  if (entries.length === 0) return log
  return [...log, ...entries]
}

/**
 * Figure 2, RequestVote RPC, receiver rule 2 / §5.4.1 — "at least as up-to-date".
 *
 * Raft compares logs by *last term first, then length*. Comparing length alone is the
 * single most common way to get this wrong, and it silently breaks Leader
 * Completeness: a node with a long log of stale entries would beat a node with a
 * shorter log containing a committed entry from a later term.
 */
export function isAtLeastAsUpToDate(
  candidateLastTerm: number,
  candidateLastIndex: number,
  voterLog: readonly LogEntry[],
): boolean {
  const voterLastTerm = lastLogTerm(voterLog)
  const voterLastIndex = lastLogIndex(voterLog)
  if (candidateLastTerm !== voterLastTerm) return candidateLastTerm > voterLastTerm
  return candidateLastIndex >= voterLastIndex
}
