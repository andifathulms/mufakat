/**
 * The EventTrace: the only interface between simulation and rendering.
 *
 * No component computes algorithm state, evaluates an invariant, or decides what
 * happened. Everything on screen is a rendering of these records.
 *
 * Storage relies on the algorithm's immutability rather than on copying. One event
 * touches one node, so the `nodes` array of a step shares every unchanged
 * `NodeState` object with the previous step: the marginal cost of a step is one
 * array of pointers, and stepping backwards is free because nothing was overwritten.
 */

import type { Violation } from '@/lib/invariants/types'
import type { LogEntry, Message, NodeId, NodeState } from '@/lib/raft/types'
import type { NetworkState } from './network'

/** A message on the wire: sent, not yet delivered. */
export interface InFlight {
  readonly message: Message
  readonly sentAt: number
  readonly arrivesAt: number
  /** Queue sequence number — the tiebreak that makes delivery order total. */
  readonly seq: number
  /** True for the second copy produced by network duplication. */
  readonly isDuplicate: boolean
}

/** What happened at a step. Discriminated on `kind`; the UI switches exhaustively. */
export type TraceEvent =
  | { readonly kind: 'start' }
  | { readonly kind: 'deliver'; readonly message: Message; readonly isDuplicate: boolean }
  | { readonly kind: 'drop'; readonly message: Message; readonly reason: DropReason }
  | { readonly kind: 'timer'; readonly node: NodeId; readonly timer: 'election' | 'heartbeat' }
  | {
      readonly kind: 'client-request'
      readonly node: NodeId
      readonly command: string
      readonly accepted: boolean
      /** Set when a follower redirected the request to the leader it knows. */
      readonly redirectedTo: NodeId | null
    }
  | { readonly kind: 'crash'; readonly node: NodeId }
  | { readonly kind: 'restart'; readonly node: NodeId }
  | { readonly kind: 'partition'; readonly partitionOf: readonly number[] }
  | { readonly kind: 'heal' }

export type DropReason = 'network' | 'partition' | 'crashed-sender' | 'crashed-receiver'

export interface AppliedRecord {
  readonly node: NodeId
  readonly index: number
  readonly term: number
  readonly command: string
}

export interface TraceStep {
  readonly index: number
  readonly time: number
  readonly event: TraceEvent
  /** Cluster state *after* the event. Structurally shared with the previous step. */
  readonly nodes: readonly NodeState[]
  readonly crashed: readonly boolean[]
  readonly network: NetworkState
  readonly inFlight: readonly InFlight[]
  readonly applied: readonly AppliedRecord[]
  /** Violations newly observed at this step. */
  readonly violations: readonly Violation[]
}

export interface Trace {
  readonly steps: readonly TraceStep[]
  /** Every violation in the run, in the order observed. */
  readonly violations: readonly Violation[]
  /** True when the run was cut short by the event budget rather than running dry. */
  readonly truncated: boolean
}

/** Index of the first step at which any property broke, or null. */
export function firstViolationStep(trace: Trace): number | null {
  const first = trace.violations[0]
  return first === undefined ? null : first.stepIndex
}

/** Step indices where a node's term changed — for "jump to next term change". */
export function termChangeSteps(trace: Trace): readonly number[] {
  const out: number[] = []
  for (let i = 1; i < trace.steps.length; i += 1) {
    const previous = trace.steps[i - 1]
    const current = trace.steps[i]
    if (previous === undefined || current === undefined) continue
    if (current.nodes.some((node, id) => node.currentTerm !== previous.nodes[id]?.currentTerm)) {
      out.push(i)
    }
  }
  return out
}

/** Step indices at which a node became leader. */
export function electionSteps(trace: Trace): readonly number[] {
  const out: number[] = []
  for (let i = 1; i < trace.steps.length; i += 1) {
    const previous = trace.steps[i - 1]
    const current = trace.steps[i]
    if (previous === undefined || current === undefined) continue
    if (current.nodes.some((node, id) => node.role === 'leader' && previous.nodes[id]?.role !== 'leader')) {
      out.push(i)
    }
  }
  return out
}

/** Step indices at which anything was applied. */
export function commitSteps(trace: Trace): readonly number[] {
  const out: number[] = []
  for (const step of trace.steps) {
    if (step.applied.length > 0) out.push(step.index)
  }
  return out
}

/** Step indices at which a violation was observed. */
export function violationSteps(trace: Trace): readonly number[] {
  const out: number[] = []
  for (const step of trace.steps) {
    if (step.violations.length > 0) out.push(step.index)
  }
  return out
}

/**
 * A stable, order-independent digest of a trace. Two runs of the same
 * `(config, seed, actions, flags)` must produce the same string on any machine —
 * this is what the determinism suite compares.
 */
export function traceDigest(trace: Trace): string {
  const lines: string[] = []
  for (const step of trace.steps) {
    lines.push(`${step.index}@${step.time} ${describeEvent(step.event)}`)
    for (const node of step.nodes) {
      lines.push(
        `  n${node.id} ${node.role} t=${node.currentTerm} v=${node.votedFor ?? '-'} ` +
          `c=${node.commitIndex} a=${node.lastApplied} log=${describeLog(node.log)}`,
      )
    }
    for (const flight of step.inFlight) {
      lines.push(`  ~ ${flight.message.type} ${flight.message.from}->${flight.message.to}@${flight.arrivesAt}`)
    }
    for (const violation of step.violations) {
      lines.push(`  ! ${violation.property} ${violation.summary}`)
    }
  }
  return lines.join('\n')
}

function describeLog(log: readonly LogEntry[]): string {
  return log.map((entry) => `${entry.term}:${entry.command}`).join(',')
}

export function describeEvent(event: TraceEvent): string {
  switch (event.kind) {
    case 'start':
      return 'start'
    case 'deliver':
      return `deliver ${event.message.type} ${event.message.from}->${event.message.to} term=${event.message.term}${event.isDuplicate ? ' (duplicate)' : ''}`
    case 'drop':
      return `drop ${event.message.type} ${event.message.from}->${event.message.to} (${event.reason})`
    case 'timer':
      return `timer ${event.timer} n${event.node}`
    case 'client-request':
      return `client n${event.node} "${event.command}"${event.accepted ? '' : event.redirectedTo === null ? ' (no leader known)' : ` (redirected to n${event.redirectedTo})`}`
    case 'crash':
      return `crash n${event.node}`
    case 'restart':
      return `restart n${event.node}`
    case 'partition':
      return `partition [${event.partitionOf.join(',')}]`
    case 'heal':
      return 'heal'
    default: {
      const unreachable: never = event
      throw new Error(`Unhandled trace event: ${JSON.stringify(unreachable)}`)
    }
  }
}
