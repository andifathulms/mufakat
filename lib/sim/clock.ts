/**
 * Virtual clock and event queue.
 *
 * There is no wall-clock time anywhere in the simulation. Advancing time means
 * popping the next event, not waiting. This is what buys determinism, instant
 * fast-forward, and free time travel.
 *
 * Ordering is a *total* order: events sort by virtual timestamp, and ties break on a
 * monotonically increasing sequence number assigned at schedule time. Two events at
 * the same tick therefore always resolve the same way, on every machine, regardless
 * of heap internals. Nothing in this file may depend on insertion luck.
 */

/** A scheduled event. `seq` is the tiebreak; it is assigned by the queue. */
export interface Scheduled<T> {
  readonly time: number
  readonly seq: number
  readonly payload: T
}

/**
 * Total order over scheduled events. Earlier time first; equal times resolve by
 * sequence number. Never returns 0 for two distinct events.
 */
function precedes<T>(a: Scheduled<T>, b: Scheduled<T>): boolean {
  if (a.time !== b.time) return a.time < b.time
  return a.seq < b.seq
}

/**
 * Binary min-heap over `Scheduled`. Deterministic because the comparator is a total
 * order — heap shape can vary, pop order cannot.
 */
export class EventQueue<T> {
  private heap: Scheduled<T>[] = []
  private nextSeq = 0
  private virtualNow = 0

  /** Current virtual time: the timestamp of the most recently popped event. */
  get now(): number {
    return this.virtualNow
  }

  get size(): number {
    return this.heap.length
  }

  /** Sequence number the next `schedule` call will use. Part of the run's identity. */
  get sequence(): number {
    return this.nextSeq
  }

  /**
   * Schedule `payload` to fire at absolute virtual time `time`.
   * Scheduling into the past is a bug in the caller, not something to round away.
   */
  schedule(time: number, payload: T): Scheduled<T> {
    if (!Number.isInteger(time)) {
      throw new Error(`EventQueue.schedule: time must be an integer, got ${time}`)
    }
    if (time < this.virtualNow) {
      throw new Error(`EventQueue.schedule: time ${time} is before now ${this.virtualNow}`)
    }
    const event: Scheduled<T> = { time, seq: this.nextSeq++, payload }
    this.heap.push(event)
    this.siftUp(this.heap.length - 1)
    return event
  }

  /** Schedule `delay` ticks from now. */
  scheduleAfter(delay: number, payload: T): Scheduled<T> {
    return this.schedule(this.virtualNow + delay, payload)
  }

  /** Timestamp of the next event without popping it. */
  peekTime(): number | null {
    const head = this.heap[0]
    return head === undefined ? null : head.time
  }

  /** Pop the next event and advance virtual time to its timestamp. */
  pop(): Scheduled<T> | null {
    const head = this.heap[0]
    if (head === undefined) return null
    const last = this.heap.pop()
    if (last === undefined) return null
    if (this.heap.length > 0) {
      this.heap[0] = last
      this.siftDown(0)
    }
    this.virtualNow = head.time
    return head
  }

  /**
   * Every queued event, in the exact order `pop` would yield them. For assertions and
   * for rendering pending deliveries — never for driving the simulation.
   */
  toOrderedArray(): Scheduled<T>[] {
    return [...this.heap].sort((a, b) => (precedes(a, b) ? -1 : 1))
  }

  private siftUp(startIndex: number): void {
    let index = startIndex
    while (index > 0) {
      const parentIndex = (index - 1) >> 1
      const node = this.heap[index]
      const parent = this.heap[parentIndex]
      if (node === undefined || parent === undefined) return
      if (!precedes(node, parent)) return
      this.heap[index] = parent
      this.heap[parentIndex] = node
      index = parentIndex
    }
  }

  private siftDown(startIndex: number): void {
    let index = startIndex
    const length = this.heap.length
    for (;;) {
      const left = index * 2 + 1
      const right = left + 1
      let smallest = index
      const smallestNode = this.heap[smallest]
      const leftNode = this.heap[left]
      const rightNode = this.heap[right]
      if (smallestNode === undefined) return
      let best = smallestNode
      if (left < length && leftNode !== undefined && precedes(leftNode, best)) {
        smallest = left
        best = leftNode
      }
      if (right < length && rightNode !== undefined && precedes(rightNode, best)) {
        smallest = right
        best = rightNode
      }
      if (smallest === index) return
      const current = this.heap[index]
      if (current === undefined) return
      this.heap[index] = best
      this.heap[smallest] = current
      index = smallest
    }
  }
}
