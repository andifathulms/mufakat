'use client'

/**
 * The simulation workbench: cluster, ledger, invariants, timeline, ablation.
 *
 * Everything on this page is a rendering of the trace. Nothing here computes
 * algorithm state or evaluates a property — when a component needs to know whether an
 * entry is committed, it reads `commitIndex` from the trace, and when it needs to
 * know whether Log Matching holds, it reads the checker's verdict.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AblationPanel, ModifiedBanner } from '@/components/ablation/AblationPanel'
import { NodeRing } from '@/components/cluster/NodeRing'
import { InvariantPanel } from '@/components/invariants/InvariantPanel'
import { LogLedger } from '@/components/ledger/LogLedger'
import { Timeline } from '@/components/timeline/Timeline'
import { SCENARIOS, scenarioById } from '@/data/scenarios'
import { dictionary, type Locale } from '@/lib/i18n'
import { UNMODIFIED_RAFT, type AblationFlagName } from '@/lib/raft/rules'
import { members } from '@/lib/raft/configuration'
import { configurationOf } from '@/lib/raft/log'
import { decodeShare, encodeShare, specFromShare, type ShareState } from '@/lib/share'
import type { Action } from '@/lib/sim/simulation'
import { commitSteps, electionSteps, termChangeSteps, violationSteps } from '@/lib/sim/trace'
import { useSimulation } from '@/lib/useSimulation'

export function Simulator({ locale }: { locale: Locale }) {
  const dict = dictionary(locale)
  const [share, setShare] = useState<ShareState>(() => ({
    scenarioId: SCENARIOS[0]?.id ?? 'clean-election',
    seed: SCENARIOS[0]?.spec.seed ?? 1,
    flags: UNMODIFIED_RAFT,
    extraActions: [],
    step: null,
  }))
  const [hydrated, setHydrated] = useState(false)
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(2)
  const [selected, setSelected] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)

  // The hash is the whole state, so a shared link reproduces the run exactly —
  // including any violation, and including the fact that a rule was switched off.
  useEffect(() => {
    const load = () => {
      const decoded = decodeShare(window.location.hash)
      setShare(decoded)
      if (decoded.step !== null) setStep(decoded.step)
      setHydrated(true)
    }
    load()
    // Also on `hashchange`, which is how the browser's back button, and a link from
    // the scenario or ablation page while already on this one, arrive. Without this
    // the URL would say one thing and the run would be another.
    window.addEventListener('hashchange', load)
    return () => window.removeEventListener('hashchange', load)
  }, [])

  const spec = useMemo(() => specFromShare(share), [share])
  const { trace, running, error } = useSimulation(spec)

  useEffect(() => {
    if (!hydrated) return
    const hash = encodeShare({ ...share, step: null })
    if (window.location.hash.slice(1) !== hash) {
      window.history.replaceState(null, '', `#${hash}`)
    }
    setCopied(false)
  }, [share, hydrated])

  useEffect(() => {
    if (trace === null) return
    setStep((current) => Math.min(current, Math.max(0, trace.steps.length - 1)))
  }, [trace])

  const marks = useMemo(() => {
    if (trace === null) return { terms: [], elections: [], commits: [], violations: [] }
    return {
      terms: termChangeSteps(trace),
      elections: electionSteps(trace),
      commits: commitSteps(trace),
      violations: violationSteps(trace),
    }
  }, [trace])

  const current = trace?.steps[step] ?? null

  const addAction = useCallback(
    (action: Action) => {
      setPlaying(false)
      setShare((state) => ({ ...state, extraActions: [...state.extraActions, action] }))
    },
    [],
  )

  const onNodeAction = useCallback(
    (node: number, kind: 'crash' | 'restart' | 'isolate') => {
      if (current === null) return
      // Actions land at the moment being viewed, so direct manipulation composes
      // with the scenario script rather than fighting it.
      const at = current.time + 1
      if (kind === 'isolate') {
        const partitionOf = current.nodes.map((_, id) => (id === node ? 1 : 0))
        addAction({ at, kind: 'partition', partitionOf })
        return
      }
      addAction({ at, kind, node })
    },
    [current, addAction],
  )

  const onSubmitEntry = useCallback(
    (node: number) => {
      if (current === null) return
      const ordinal = share.extraActions.filter((a) => a.kind === 'client-request').length + 1
      addAction({ at: current.time + 1, kind: 'client-request', node, command: `entry ${ordinal}` })
    },
    [current, share.extraActions, addAction],
  )

  const onToggle = useCallback((flag: AblationFlagName, enabled: boolean) => {
    setPlaying(false)
    setShare((state) => ({ ...state, flags: { ...state.flags, [flag]: enabled } }))
  }, [])

  const definition = scenarioById(share.scenarioId)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 font-sans text-xs">
          <span className="text-ink-faint">{dict.nav.scenarios}</span>
          <select
            value={share.scenarioId}
            onChange={(event) => {
              const id = event.target.value
              const chosen = scenarioById(id)
              setPlaying(false)
              setStep(0)
              setShare({
                scenarioId: id,
                seed: chosen.spec.seed,
                flags: chosen.spec.flags,
                extraActions: [],
                step: null,
              })
            }}
            className="border border-ink bg-stock-pale px-2 py-1 font-mono text-xs"
          >
            {SCENARIOS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.id}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 font-sans text-xs">
          <span className="text-ink-faint">{dict.sim.seed}</span>
          <input
            type="number"
            value={share.seed}
            onChange={(event) => {
              const seed = Number(event.target.value)
              if (!Number.isInteger(seed)) return
              setPlaying(false)
              setShare((state) => ({ ...state, seed }))
            }}
            className="w-24 border border-ink bg-stock-pale px-2 py-1 font-mono tabular text-xs"
          />
        </label>

        <button
          type="button"
          onClick={() => {
            setPlaying(false)
            setStep(0)
            setShare((state) => ({ ...state, extraActions: [] }))
          }}
          className="border border-ink-edge px-3 py-1 font-sans text-xs hover:bg-stock-deep"
        >
          {dict.sim.rerun}
        </button>

        <button
          type="button"
          onClick={() => {
            const url = `${window.location.origin}${window.location.pathname}#${encodeShare({
              ...share,
              step,
            })}`
            void navigator.clipboard?.writeText(url).then(() => setCopied(true))
          }}
          className="border border-ink-rule px-3 py-1 font-sans text-xs hover:bg-stock-deep"
        >
          {copied ? dict.sim.shared : dict.sim.share}
        </button>

        <p className="ml-auto max-w-md font-sans text-xs text-ink-faint">{definition.summary}</p>
      </div>

      <ModifiedBanner flags={share.flags} dict={dict} />

      {error !== null && (
        <p className="border border-vermilion bg-vermilion/10 px-3 py-2 font-mono text-xs text-vermilion">
          {error}
        </p>
      )}

      {trace === null || current === null ? (
        <p className="py-16 text-center font-sans text-sm text-ink-faint">
          {running ? dict.sim.computing : '—'}
        </p>
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)_minmax(0,300px)]">
            <section aria-label={dict.sim.cluster} className="flex flex-col gap-3">
              <h2 className="border-b border-ink font-serif text-lg">{dict.sim.cluster}</h2>
              <NodeRing
                step={current}
                dict={dict}
                selected={selected}
                onSelect={setSelected}
                onNodeAction={onNodeAction}
              />
              <div className="flex flex-wrap gap-2 font-sans text-xs">
                {current.nodes.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => onSubmitEntry(node.id)}
                    className="border border-ink-rule px-2 py-1 hover:bg-stock-deep"
                  >
                    {dict.sim.submit} → n{node.id}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => addAction({ at: current.time + 1, kind: 'heal' })}
                  className="border border-ink-rule px-2 py-1 hover:bg-stock-deep"
                >
                  {dict.sim.heal}
                </button>
              </div>
              <InFlightList step={current} dict={dict} />
            </section>

            <section aria-label={dict.sim.ledger} className="flex flex-col gap-3 min-w-0">
              <h2 className="border-b border-ink font-serif text-lg">{dict.sim.ledger}</h2>
              <LogLedger step={current} dict={dict} />
            </section>

            <section aria-label={dict.sim.invariants} className="flex flex-col gap-3">
              <h2 className="border-b border-ink font-serif text-lg">{dict.sim.invariants}</h2>
              <InvariantPanel
                violations={trace.violations}
                upToStep={step}
                dict={dict}
                onJump={(target) => {
                  setPlaying(false)
                  setStep(target)
                }}
              />
            </section>
          </div>

          <section className="border-t-2 border-ink pt-4">
            <Timeline
              trace={trace}
              step={step}
              onStep={setStep}
              playing={playing}
              onPlaying={setPlaying}
              speed={speed}
              onSpeed={setSpeed}
              marks={marks}
              dict={dict}
            />
          </section>

          <details className="border-t border-ink-rule pt-4">
            <summary className="cursor-pointer font-serif text-lg">{dict.nav.ablation}</summary>
            <div className="mt-3 max-w-3xl">
              <AblationPanel
                flags={share.flags}
                onToggle={onToggle}
                onReset={() => setShare((state) => ({ ...state, flags: UNMODIFIED_RAFT }))}
                dict={dict}
                locale={locale}
                compact
              />
            </div>
          </details>
        </>
      )}
    </div>
  )
}

function InFlightList({
  step,
  dict,
}: {
  step: { inFlight: readonly { message: { type: string; from: number; to: number; term: number }; arrivesAt: number; seq: number }[] }
  dict: ReturnType<typeof dictionary>
}) {
  return (
    <div>
      <h3 className="font-sans text-xs text-ink-faint">{dict.sim.inFlight}</h3>
      {step.inFlight.length === 0 ? (
        <p className="font-sans text-xs text-ink-faint">{dict.sim.noMessages}</p>
      ) : (
        <ul className="mt-1 max-h-32 overflow-y-auto font-mono text-[11px] tabular text-ink-soft">
          {step.inFlight.slice(0, 12).map((flight) => (
            <li key={flight.seq}>
              n{flight.message.from}→n{flight.message.to} {flight.message.type} t
              {flight.message.term} @{flight.arrivesAt}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
