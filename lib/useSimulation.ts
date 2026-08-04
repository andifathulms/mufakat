'use client'

/**
 * Runs a scenario in a worker and hands back the trace.
 *
 * The trace is the only interface between simulation and rendering: nothing
 * downstream of this hook computes algorithm state, evaluates an invariant, or
 * decides what happened.
 */

import { useEffect, useRef, useState } from 'react'
import { run, type Scenario } from '@/lib/sim/simulation'
import type { Trace } from '@/lib/sim/trace'
import type { SimRequest, SimResponse } from '@/workers/sim.worker'

export interface SimulationResult {
  readonly trace: Trace | null
  readonly running: boolean
  readonly error: string | null
}

export function useSimulation(spec: Scenario): SimulationResult {
  const [trace, setTrace] = useState<Trace | null>(null)
  const [running, setRunning] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const requestId = useRef(0)

  // A structural key, so the effect re-runs when the scenario genuinely changes
  // rather than whenever the object identity does.
  const key = JSON.stringify(spec)

  useEffect(() => {
    let cancelled = false
    setRunning(true)
    setError(null)

    if (typeof Worker === 'undefined') {
      // No worker available — server render, or an old browser. Run inline. The
      // result is identical; only the thread differs.
      try {
        setTrace(run(spec))
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught))
      }
      setRunning(false)
      return
    }

    if (workerRef.current === null) {
      workerRef.current = new Worker(new URL('../workers/sim.worker.ts', import.meta.url))
    }
    const worker = workerRef.current
    const id = (requestId.current += 1)

    const onMessage = (event: MessageEvent<SimResponse>) => {
      if (cancelled || event.data.id !== requestId.current) return
      if (event.data.error !== undefined) setError(event.data.error)
      if (event.data.trace !== undefined) setTrace(event.data.trace)
      setRunning(false)
    }
    worker.addEventListener('message', onMessage)
    const request: SimRequest = { id, spec }
    worker.postMessage(request)

    return () => {
      cancelled = true
      worker.removeEventListener('message', onMessage)
    }
    // `spec` is covered by `key`; depending on the object itself would re-run on
    // every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    return () => {
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [])

  return { trace, running, error }
}
