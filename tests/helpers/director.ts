/**
 * A director: a deterministic message-passing harness for scripted scenarios.
 *
 * The full simulator drives Raft through a virtual clock and a lossy network, which
 * is right for fuzzing and wrong for reproducing a specific figure. Here the test
 * decides exactly which node acts and exactly which messages are delivered, so a
 * published scenario can be replayed move for move.
 *
 * The algorithm and the invariant checker are the real ones. Only the network is
 * replaced — by the test's own hand.
 */

import { step as raftStep } from '@/lib/raft/node'
import type { Input, Message, NodeId, NodeState, RaftConfig } from '@/lib/raft/types'
import { check, EMPTY_CHECKER_STATE } from '@/lib/invariants/checker'
import type { CheckerState, SafetyProperty, Violation } from '@/lib/invariants/types'
import { snapshotOf } from '@/lib/sim/simulation'

export class Director {
  readonly config: RaftConfig
  nodes: NodeState[]
  crashed: boolean[]
  /** Messages sent and not yet delivered, in send order. */
  wire: Message[] = []
  readonly violations: Violation[] = []
  private checker: CheckerState = EMPTY_CHECKER_STATE
  private clock = 0

  constructor(config: RaftConfig, nodes: readonly NodeState[]) {
    this.config = config
    this.nodes = [...nodes]
    this.crashed = new Array<boolean>(nodes.length).fill(false)
    this.observe()
  }

  private node(id: NodeId): NodeState {
    const node = this.nodes[id]
    if (node === undefined) throw new Error(`No node ${id}`)
    return node
  }

  /** Run the invariant checker over the whole cluster. Called after every input. */
  private observe(): void {
    this.clock += 1
    const result = check(this.checker, snapshotOf(this.nodes, this.crashed, this.clock, this.clock))
    this.checker = result.state
    this.violations.push(...result.violations)
  }

  input(id: NodeId, input: Input): void {
    if (this.crashed[id] === true) return
    const result = raftStep(this.node(id), input, this.config)
    this.nodes = this.nodes.map((existing, index) => (index === id ? result.state : existing))
    this.wire.push(...result.outbox)
    this.observe()
  }

  /** Force `id` to time out and start an election. */
  campaign(id: NodeId): void {
    this.input(id, { type: 'election-timeout', timerId: this.node(id).electionTimerId })
  }

  /** Force the leader's heartbeat sweep. */
  heartbeat(id: NodeId): void {
    this.input(id, { type: 'heartbeat-timeout', timerId: this.node(id).heartbeatTimerId })
  }

  clientRequest(id: NodeId, command: string): void {
    this.input(id, { type: 'client-request', command })
  }

  crash(id: NodeId): void {
    this.crashed = this.crashed.map((down, index) => (index === id ? true : down))
    // A crashed server's in-flight messages are lost, in both directions.
    this.wire = this.wire.filter((message) => message.from !== id && message.to !== id)
    this.observe()
  }

  restart(id: NodeId): void {
    this.crashed = this.crashed.map((down, index) => (index === id ? false : down))
    this.input(id, { type: 'restart' })
  }

  /**
   * Deliver every message whose sender and receiver are both in `reachable`, and
   * discard the rest. Repeats until the wire is quiet or `rounds` is exhausted, so
   * one call carries a request and its response to completion.
   */
  flush(reachable: readonly NodeId[], rounds = 12): void {
    for (let round = 0; round < rounds; round += 1) {
      const pending = this.wire
      this.wire = []
      const deliverable = pending.filter(
        (message) =>
          reachable.includes(message.from) &&
          reachable.includes(message.to) &&
          this.crashed[message.to] !== true,
      )
      if (deliverable.length === 0) return
      for (const message of deliverable) {
        this.input(message.to, { type: 'message', message })
      }
    }
  }

  /** Discard everything on the wire. */
  clearWire(): void {
    this.wire = []
  }

  leaderOf(term: number): NodeId | null {
    const found = this.nodes.find(
      (node) => node.role === 'leader' && node.currentTerm === term && this.crashed[node.id] !== true,
    )
    return found?.id ?? null
  }

  /** Terms of a node's log, for asserting against the figure. */
  logTerms(id: NodeId): number[] {
    return this.node(id).log.map((entry) => entry.term)
  }

  logCommands(id: NodeId): string[] {
    return this.node(id).log.map((entry) => entry.command)
  }

  violationsOf(property: SafetyProperty): Violation[] {
    return this.violations.filter((violation) => violation.property === property)
  }
}
