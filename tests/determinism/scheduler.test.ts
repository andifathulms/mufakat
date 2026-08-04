import { describe, expect, it } from 'vitest'
import { EventQueue } from '@/lib/sim/clock'
import { nextChance, nextInt, nextUint32, prngFromSeed } from '@/lib/sim/prng'

/**
 * M0 gate. The scheduler must replay byte-identically before any Raft code exists.
 * If these fail, nothing built on top of the scheduler can be trusted.
 */

function drivePrng(seed: number, draws: number): number[] {
  let prng = prngFromSeed(seed)
  const out: number[] = []
  for (let i = 0; i < draws; i += 1) {
    const drawn = nextUint32(prng)
    prng = drawn.prng
    out.push(drawn.value)
  }
  return out
}

/**
 * Randomly schedules and pops events, deliberately producing many ties on the same
 * tick, and records the exact interleaving. Two runs with the same seed must agree.
 */
function driveQueue(seed: number, steps: number): string[] {
  const queue = new EventQueue<string>()
  let prng = prngFromSeed(seed, 7)
  const log: string[] = []
  let minted = 0

  for (let step = 0; step < steps; step += 1) {
    const howMany = nextInt(prng, 0, 4)
    prng = howMany.prng
    for (let i = 0; i < howMany.value; i += 1) {
      // A tiny delay range guarantees frequent ties, which is the interesting case.
      const delay = nextInt(prng, 0, 3)
      prng = delay.prng
      minted += 1
      queue.scheduleAfter(delay.value, `e${minted}`)
    }
    const shouldPop = nextChance(prng, 700)
    prng = shouldPop.prng
    if (shouldPop.value) {
      const event = queue.pop()
      if (event !== null) log.push(`${event.time}:${event.seq}:${event.payload}`)
    }
  }
  for (;;) {
    const event = queue.pop()
    if (event === null) break
    log.push(`${event.time}:${event.seq}:${event.payload}`)
  }
  return log
}

describe('prng', () => {
  it('is a pure function of its seed', () => {
    expect(drivePrng(42, 64)).toEqual(drivePrng(42, 64))
  })

  it('produces uncorrelated streams for adjacent seeds', () => {
    const a = drivePrng(1, 32)
    const b = drivePrng(2, 32)
    expect(a).not.toEqual(b)
    // Adjacent seeds must not merely be offset copies of one another.
    expect(a.slice(1)).not.toEqual(b.slice(0, 31))
  })

  it('produces independent streams from the same seed', () => {
    let a = prngFromSeed(99, 0)
    let b = prngFromSeed(99, 1)
    expect(a).not.toEqual(b)
    for (let i = 0; i < 16; i += 1) {
      const da = nextUint32(a)
      const db = nextUint32(b)
      a = da.prng
      b = db.prng
      expect(da.value).not.toEqual(db.value)
    }
  })

  it('emits only integers in range', () => {
    let prng = prngFromSeed(7)
    for (let i = 0; i < 5000; i += 1) {
      const drawn = nextInt(prng, 150, 300)
      prng = drawn.prng
      expect(Number.isInteger(drawn.value)).toBe(true)
      expect(drawn.value).toBeGreaterThanOrEqual(150)
      expect(drawn.value).toBeLessThanOrEqual(300)
    }
  })

  it('covers its whole range roughly uniformly', () => {
    const counts = new Array<number>(10).fill(0)
    let prng = prngFromSeed(2024)
    const draws = 100_000
    for (let i = 0; i < draws; i += 1) {
      const drawn = nextInt(prng, 0, 9)
      prng = drawn.prng
      counts[drawn.value] = (counts[drawn.value] ?? 0) + 1
    }
    for (const count of counts) {
      expect(count).toBeGreaterThan(draws / 10 - draws / 100)
      expect(count).toBeLessThan(draws / 10 + draws / 100)
    }
  })

  it('honours per-mille chances', () => {
    let prng = prngFromSeed(5)
    let hits = 0
    const draws = 100_000
    for (let i = 0; i < draws; i += 1) {
      const drawn = nextChance(prng, 250)
      prng = drawn.prng
      if (drawn.value) hits += 1
    }
    expect(hits / draws).toBeGreaterThan(0.24)
    expect(hits / draws).toBeLessThan(0.26)
  })
})

describe('event queue', () => {
  it('replays byte-identically for the same seed', () => {
    const a = driveQueue(12345, 400)
    const b = driveQueue(12345, 400)
    expect(a.join('\n')).toEqual(b.join('\n'))
    expect(a.length).toBeGreaterThan(100)
  })

  it('diverges for different seeds', () => {
    expect(driveQueue(1, 200)).not.toEqual(driveQueue(2, 200))
  })

  it('pops in nondecreasing virtual time', () => {
    const queue = new EventQueue<number>()
    let prng = prngFromSeed(31)
    for (let i = 0; i < 500; i += 1) {
      const delay = nextInt(prng, 0, 50)
      prng = delay.prng
      queue.scheduleAfter(delay.value, i)
    }
    let previous = -1
    for (;;) {
      const event = queue.pop()
      if (event === null) break
      expect(event.time).toBeGreaterThanOrEqual(previous)
      previous = event.time
    }
  })

  it('breaks ties by schedule order, never by heap shape', () => {
    const queue = new EventQueue<string>()
    // All at the same tick. The only correct order is insertion order.
    for (let i = 0; i < 50; i += 1) queue.schedule(100, `e${i}`)
    const popped: string[] = []
    for (;;) {
      const event = queue.pop()
      if (event === null) break
      popped.push(event.payload)
    }
    expect(popped).toEqual(Array.from({ length: 50 }, (_, i) => `e${i}`))
  })

  it('orders equal-time events scheduled after an intervening pop', () => {
    const queue = new EventQueue<string>()
    queue.schedule(10, 'first')
    queue.schedule(20, 'later-a')
    expect(queue.pop()?.payload).toBe('first')
    queue.schedule(20, 'later-b')
    expect(queue.pop()?.payload).toBe('later-a')
    expect(queue.pop()?.payload).toBe('later-b')
  })

  it('advances now only on pop', () => {
    const queue = new EventQueue<string>()
    queue.schedule(500, 'x')
    expect(queue.now).toBe(0)
    queue.pop()
    expect(queue.now).toBe(500)
  })

  it('refuses to schedule into the past', () => {
    const queue = new EventQueue<string>()
    queue.schedule(100, 'x')
    queue.pop()
    expect(() => queue.schedule(99, 'y')).toThrow(/before now/)
  })

  it('refuses non-integer timestamps', () => {
    const queue = new EventQueue<string>()
    expect(() => queue.schedule(1.5, 'x')).toThrow(/integer/)
  })

  it('reports queued events in pop order', () => {
    const queue = new EventQueue<string>()
    queue.schedule(30, 'c')
    queue.schedule(10, 'a')
    queue.schedule(30, 'd')
    queue.schedule(20, 'b')
    expect(queue.toOrderedArray().map((e) => e.payload)).toEqual(['a', 'b', 'c', 'd'])
  })
})
