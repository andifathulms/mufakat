/**
 * The simulation driver.
 *
 * `run(scenario) -> Trace` is a pure function of `(config, seed, actions, flags)`.
 * Byte-identical on any machine. There is no wall-clock time, no `Math.random`, and
 * no iteration over an unordered collection anywhere in this file.
 *
 * The invariant checker runs after every single event, so a violation is caught at
 * the step that caused it rather than at the end of the run.
 */

import { check, EMPTY_CHECKER_STATE } from '@/lib/invariants/checker'
import type { CheckerState, ClusterSnapshot, Violation } from '@/lib/invariants/types'
import { createNode, step as raftStep } from '@/lib/raft/node'
import { resetElectionTimer, resetHeartbeatTimer } from '@/lib/raft/timers'
import { UNMODIFIED_RAFT, type AblationFlags } from '@/lib/raft/rules'
import type { Message, NodeId, NodeState, RaftConfig, TimerRequest } from '@/lib/raft/types'
import { EventQueue } from './clock'
import {
  DEFAULT_NETWORK,
  assignPartition,
  canReach,
  fullyConnected,
  healPartitions,
  route,
  type NetworkConfig,
  type NetworkState,
} from './network'
import { prngFromSeed, type Prng } from './prng'
import type { AppliedRecord, InFlight, Trace, TraceEvent, TraceStep } from './trace'

/** A scripted user action, fixed to a virtual timestamp. */
export type Action =
  | { readonly at: number; readonly kind: 'client-request'; readonly node: NodeId; readonly command: string }
  | { readonly at: number; readonly kind: 'crash'; readonly node: NodeId }
  | { readonly at: number; readonly kind: 'restart'; readonly node: NodeId }
  | { readonly at: number; readonly kind: 'partition'; readonly partitionOf: readonly number[] }
  | { readonly at: number; readonly kind: 'heal' }

export interface Scenario {
  readonly nodeCount: number
  readonly seed: number
  readonly network: NetworkConfig
  readonly electionTimeoutMin: number
  readonly electionTimeoutMax: number
  readonly heartbeatInterval: number
  readonly flags: AblationFlags
  readonly actions: readonly Action[]
  /** Event budget. Bounded runs keep fuzzing and trace memory finite. */
  readonly maxSteps: number
  readonly maxTime: number
  /**
   * Start from this cluster state instead of a fresh one.
   *
   * Some scenarios worth showing begin in the middle of a history — Figure 8 opens on
   * a leader that has already partially replicated an entry, and building up to that
   * position from an empty cluster would take a hundred uninteresting steps and would
   * not be reproducible anyway. This is a scenario-schema affordance, not a change to
   * the algorithm: the state machine cannot tell the difference between a state it
   * reached and a state it was handed.
   */
  readonly initialNodes?: readonly NodeState[]
}

export const DEFAULT_SCENARIO: Omit<Scenario, 'seed'> = {
  nodeCount: 5,
  network: DEFAULT_NETWORK,
  // The paper's guidance: an election timeout an order of magnitude above the
  // broadcast time, and a spread wide enough that split votes resolve. §5.6.
  electionTimeoutMin: 150,
  electionTimeoutMax: 300,
  heartbeatInterval: 50,
  flags: UNMODIFIED_RAFT,
  actions: [],
  maxSteps: 4000,
  maxTime: 40_000,
}

export function scenario(overrides: Partial<Scenario> & { seed: number }): Scenario {
  return { ...DEFAULT_SCENARIO, ...overrides }
}

/** Internal queue payload. */
type SimEvent =
  | { readonly kind: 'deliver'; readonly message: Message; readonly isDuplicate: boolean }
  | { readonly kind: 'lost'; readonly message: Message; readonly isDuplicate: boolean }
  | { readonly kind: 'timer'; readonly node: NodeId; readonly timer: TimerRequest }
  | { readonly kind: 'action'; readonly action: Action; readonly redirected: boolean }

function toRaftConfig(spec: Scenario): RaftConfig {
  return {
    nodeCount: spec.nodeCount,
    electionTimeoutMin: spec.electionTimeoutMin,
    electionTimeoutMax: spec.electionTimeoutMax,
    heartbeatInterval: spec.heartbeatInterval,
    flags: spec.flags,
  }
}

/**
 * Convert simulation state into the checker's own shapes. This is the only place the
 * two sides meet, and they meet as plain data.
 */
export function snapshotOf(
  nodes: readonly NodeState[],
  crashed: readonly boolean[],
  stepIndex: number,
  time: number,
): ClusterSnapshot {
  return {
    stepIndex,
    time,
    nodes: nodes.map((node) => ({
      id: node.id,
      // A crashed server is not exercising leadership, whatever its frozen role says.
      isLeader: node.role === 'leader' && crashed[node.id] !== true,
      currentTerm: node.currentTerm,
      log: node.log.map((entry) => ({ term: entry.term, command: entry.command })),
      commitIndex: node.commitIndex,
      applied: node.stateMachine,
      lastApplied: node.lastApplied,
    })),
  }
}

class Simulation {
  private readonly spec: Scenario
  private readonly raft: RaftConfig
  private readonly queue = new EventQueue<SimEvent>()
  private nodes: NodeState[]
  private crashed: boolean[]
  private network: NetworkState
  /** The network's own PRNG stream, independent of every node's. */
  private prng: Prng
  private inFlight: InFlight[] = []
  private checker: CheckerState = EMPTY_CHECKER_STATE
  private readonly steps: TraceStep[] = []
  private readonly violations: Violation[] = []

  constructor(spec: Scenario) {
    this.spec = spec
    this.raft = toRaftConfig(spec)
    const fresh = Array.from({ length: spec.nodeCount }, (_, id) =>
      createNode(id, spec.nodeCount, spec.seed),
    )
    if (spec.initialNodes !== undefined && spec.initialNodes.length !== spec.nodeCount) {
      throw new Error(
        `initialNodes has ${spec.initialNodes.length} entries but nodeCount is ${spec.nodeCount}`,
      )
    }
    this.nodes = spec.initialNodes === undefined ? fresh : [...spec.initialNodes]
    this.crashed = new Array<boolean>(spec.nodeCount).fill(false)
    this.network = fullyConnected(spec.nodeCount)
    // Stream 0 belongs to the network; nodes take streams 1..n.
    this.prng = prngFromSeed(spec.seed, 0)
  }

  run(): Trace {
    // Startup, in a fixed order: every node arms a timer, ascending by id, then the
    // scripted actions are queued. Equal-timestamp ties therefore resolve the same
    // way on every machine.
    for (let id = 0; id < this.spec.nodeCount; id += 1) {
      const node = this.nodes[id]
      if (node === undefined) continue
      if (node.role === 'leader') {
        // A scenario may open on an already-elected leader. It heartbeats; it has no
        // election timeout.
        const armed = resetHeartbeatTimer(node, this.raft)
        this.nodes[id] = armed.state
        this.queue.schedule(armed.timer.delay, { kind: 'timer', node: id, timer: armed.timer })
        continue
      }
      const armed = resetElectionTimer(node, this.raft)
      this.nodes[id] = armed.state
      this.queue.schedule(armed.timer.delay, { kind: 'timer', node: id, timer: armed.timer })
    }
    // Sorted by time, then by the order written in the scenario. Never by object key
    // order or by any other incidental property.
    const actions = [...this.spec.actions]
      .map((action, ordinal) => ({ action, ordinal }))
      .sort((a, b) => a.action.at - b.action.at || a.ordinal - b.ordinal)
    for (const { action } of actions) {
      this.queue.schedule(action.at, { kind: 'action', action, redirected: false })
    }

    this.record({ kind: 'start' }, 0, [])

    let truncated = false
    while (this.steps.length < this.spec.maxSteps) {
      const peek = this.queue.peekTime()
      if (peek === null) break
      if (peek > this.spec.maxTime) break
      const event = this.queue.pop()
      if (event === null) break
      this.process(event.payload, event.seq)
    }
    if (this.queue.size > 0 && (this.queue.peekTime() ?? Infinity) <= this.spec.maxTime) {
      truncated = true
    }

    return { steps: this.steps, violations: this.violations, truncated }
  }

  private process(event: SimEvent, seq: number): void {
    this.inFlight = this.inFlight.filter((flight) => flight.seq !== seq)

    switch (event.kind) {
      case 'deliver': {
        const { message } = event
        if (this.crashed[message.to] === true) {
          this.record({ kind: 'drop', message, reason: 'crashed-receiver' }, this.queue.now, [])
          return
        }
        if (!canReach(this.network, message.from, message.to)) {
          // The link was severed while this message was on it.
          this.record({ kind: 'drop', message, reason: 'partition' }, this.queue.now, [])
          return
        }
        const applied = this.deliver(message.to, { type: 'message', message })
        this.record({ kind: 'deliver', message, isDuplicate: event.isDuplicate }, this.queue.now, applied)
        return
      }

      case 'lost': {
        this.record({ kind: 'drop', message: event.message, reason: 'network' }, this.queue.now, [])
        return
      }

      case 'timer': {
        if (this.crashed[event.node] === true) return
        const input =
          event.timer.kind === 'election'
            ? ({ type: 'election-timeout', timerId: event.timer.id } as const)
            : ({ type: 'heartbeat-timeout', timerId: event.timer.id } as const)
        const before = this.nodes[event.node]
        const applied = this.deliver(event.node, input)
        const after = this.nodes[event.node]
        // A stale generation changes nothing. Recording it would fill the trace with
        // steps in which literally nothing happened.
        if (before === after && applied.length === 0) return
        this.record({ kind: 'timer', node: event.node, timer: event.timer.kind }, this.queue.now, applied)
        return
      }

      case 'action':
        this.act(event.action, event.redirected)
        return

      default: {
        const unreachable: never = event
        throw new Error(`Unhandled sim event: ${JSON.stringify(unreachable)}`)
      }
    }
  }

  private act(action: Action, redirected: boolean): void {
    switch (action.kind) {
      case 'client-request': {
        const node = this.nodes[action.node]
        if (node === undefined) return
        if (this.crashed[action.node] === true) {
          this.record(
            { kind: 'client-request', node: action.node, command: action.command, accepted: false, redirectedTo: null },
            this.queue.now,
            [],
          )
          return
        }
        if (node.role === 'leader') {
          const applied = this.deliver(action.node, { type: 'client-request', command: action.command })
          this.record(
            { kind: 'client-request', node: action.node, command: action.command, accepted: true, redirectedTo: null },
            this.queue.now,
            applied,
          )
          return
        }
        // A follower does not accept client entries. It redirects to the leader it
        // knows about — which is how someone submitting to a follower discovers that
        // redirection is part of the protocol. One hop only; if the leader it names
        // has since been deposed, the request is simply lost, as it would be.
        const target = node.leaderId
        this.record(
          {
            kind: 'client-request',
            node: action.node,
            command: action.command,
            accepted: false,
            redirectedTo: redirected ? null : target,
          },
          this.queue.now,
          [],
        )
        if (!redirected && target !== null) {
          this.queue.scheduleAfter(0, {
            kind: 'action',
            action: { ...action, node: target, at: this.queue.now },
            redirected: true,
          })
        }
        return
      }

      case 'crash': {
        this.crashed = this.crashed.map((down, id) => (id === action.node ? true : down))
        this.record({ kind: 'crash', node: action.node }, this.queue.now, [])
        return
      }

      case 'restart': {
        this.crashed = this.crashed.map((down, id) => (id === action.node ? false : down))
        const applied = this.deliver(action.node, { type: 'restart' })
        this.record({ kind: 'restart', node: action.node }, this.queue.now, applied)
        return
      }

      case 'partition': {
        let network = fullyConnected(this.spec.nodeCount)
        for (let id = 0; id < this.spec.nodeCount; id += 1) {
          network = assignPartition(network, id, action.partitionOf[id] ?? 0)
        }
        this.network = network
        this.record({ kind: 'partition', partitionOf: this.network.partitionOf }, this.queue.now, [])
        return
      }

      case 'heal': {
        this.network = healPartitions(this.network)
        this.record({ kind: 'heal' }, this.queue.now, [])
        return
      }

      default: {
        const unreachable: never = action
        throw new Error(`Unhandled action: ${JSON.stringify(unreachable)}`)
      }
    }
  }

  /** Step one node, then place its outbox on the wire and arm its timers. */
  private deliver(
    id: NodeId,
    input: Parameters<typeof raftStep>[1],
  ): readonly AppliedRecord[] {
    const node = this.nodes[id]
    if (node === undefined) return []
    const result = raftStep(node, input, this.raft)
    this.nodes = this.nodes.map((existing, index) => (index === id ? result.state : existing))

    for (const timer of result.timers) {
      this.queue.scheduleAfter(timer.delay, { kind: 'timer', node: id, timer })
    }
    // Outbox order is the order the algorithm produced, which is ascending by peer id.
    for (const message of result.outbox) {
      this.send(message)
    }

    return result.applied.map((entry) => ({
      node: id,
      index: entry.index,
      term: entry.term,
      command: entry.command,
    }))
  }

  private send(message: Message): void {
    const routed = route(this.prng, this.spec.network)
    this.prng = routed.prng
    if (routed.delivery.kind === 'dropped') {
      const scheduled = this.queue.scheduleAfter(routed.delivery.delay, {
        kind: 'lost',
        message,
        isDuplicate: false,
      })
      this.inFlight.push({
        message,
        sentAt: this.queue.now,
        arrivesAt: scheduled.time,
        seq: scheduled.seq,
        isDuplicate: false,
      })
      return
    }
    routed.delivery.delays.forEach((delay, copy) => {
      const scheduled = this.queue.scheduleAfter(delay, {
        kind: 'deliver',
        message,
        isDuplicate: copy > 0,
      })
      this.inFlight.push({
        message,
        sentAt: this.queue.now,
        arrivesAt: scheduled.time,
        seq: scheduled.seq,
        isDuplicate: copy > 0,
      })
    })
  }

  /** Append a trace step and run the checker against the resulting cluster state. */
  private record(event: TraceEvent, time: number, applied: readonly AppliedRecord[]): void {
    const index = this.steps.length
    const checked = check(this.checker, snapshotOf(this.nodes, this.crashed, index, time))
    this.checker = checked.state
    this.violations.push(...checked.violations)
    this.steps.push({
      index,
      time,
      event,
      nodes: this.nodes,
      crashed: this.crashed,
      network: this.network,
      // In-flight is genuinely per-step: it is the only field that cannot be shared.
      inFlight: [...this.inFlight].sort((a, b) => a.arrivesAt - b.arrivesAt || a.seq - b.seq),
      applied,
      violations: checked.violations,
    })
  }
}

/** Run a scenario to completion. Pure: same input, byte-identical trace. */
export function run(spec: Scenario): Trace {
  return new Simulation(spec).run()
}
