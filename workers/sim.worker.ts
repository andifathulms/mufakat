/**
 * The simulation worker.
 *
 * Long runs and fuzzing must never touch the main thread. The worker takes a
 * scenario and returns the trace; the trace is the only thing that crosses back.
 */

import { run, type Scenario } from '@/lib/sim/simulation'
import type { Trace } from '@/lib/sim/trace'

export interface SimRequest {
  readonly id: number
  readonly spec: Scenario
}

export interface SimResponse {
  readonly id: number
  readonly trace?: Trace
  readonly error?: string
}

self.addEventListener('message', (event: MessageEvent<SimRequest>) => {
  const { id, spec } = event.data
  try {
    const trace = run(spec)
    const response: SimResponse = { id, trace }
    self.postMessage(response)
  } catch (error) {
    const response: SimResponse = {
      id,
      error: error instanceof Error ? error.message : String(error),
    }
    self.postMessage(response)
  }
})
