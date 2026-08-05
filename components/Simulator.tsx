'use client'

/**
 * The simulation workbench: cluster, ledger, invariants, timeline, ablation.
 *
 * Everything on this page is a rendering of the trace. Nothing here computes
 * algorithm state or evaluates a property — when a component needs to know whether an
 * entry is committed, it reads `commitIndex` from the trace, and when it needs to
 * know whether Log Matching holds, it reads the checker's verdict.
 *
 * The reading order is deliberate: what you are running, then a sentence saying what
 * just happened, then the three views, then the controls that move you through it.
 * Somebody who has never seen Raft should be able to read down the page and follow
 * it; somebody who has can start scrubbing immediately.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AblationPanel, ModifiedBanner } from '@/components/ablation/AblationPanel'
import { NodeRing } from '@/components/cluster/NodeRing'
import { InvariantPanel } from '@/components/invariants/InvariantPanel'
import { LogLedger } from '@/components/ledger/LogLedger'
import { SimGuide } from '@/components/SimGuide'
import { Timeline } from '@/components/timeline/Timeline'
import { SCENARIOS, scenarioById } from '@/data/scenarios'
import { dictionary, type Locale } from '@/lib/i18n'
import { narrateEvent } from '@/lib/narrate'
import { UNMODIFIED_RAFT, type AblationFlagName } from '@/lib/raft/rules'
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

  const addAction = useCallback((action: Action) => {
    setPlaying(false)
    setShare((state) => ({ ...state, extraActions: [...state.extraActions, action] }))
  }, [])

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
    <div className="flex flex-col gap-5 pb-8">
      {/* ---- What is loaded, and how to change it. ---- */}
      <section className="card p-4" aria-label={dict.nav.scenarios}>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <label className="flex min-w-[15rem] flex-1 flex-col gap-1.5">
            <span className="field-label">{dict.nav.scenarios}</span>
            {/* Titles, not slugs. `split-vote` means nothing until you already know
                what a split vote is, which is exactly the wrong way round. */}
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
              className="w-full border border-ink-edge bg-stock-pale px-2.5 py-2 font-sans text-label"
            >
              {SCENARIOS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.title}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="field-label">{dict.sim.seed}</span>
            <input
              type="number"
              value={share.seed}
              onChange={(event) => {
                const seed = Number(event.target.value)
                if (!Number.isInteger(seed)) return
                setPlaying(false)
                setShare((state) => ({ ...state, seed }))
              }}
              className="w-28 border border-ink-edge bg-stock-pale px-2.5 py-2 font-mono text-label tabular"
            />
          </label>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setPlaying(false)
                setStep(0)
                setShare((state) => ({ ...state, extraActions: [] }))
              }}
              className="btn"
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
              className="btn"
            >
              {copied ? dict.sim.shared : dict.sim.share}
            </button>
          </div>
        </div>

        <div className="mt-3 border-t border-ink-rule pt-3">
          <p className="max-w-prose font-sans text-label leading-relaxed text-ink-soft">
            {definition.summary}
          </p>
          <p className="mt-1.5 max-w-prose font-sans text-micro leading-relaxed text-ink-faint">
            <span className="font-medium">{dict.scenarios.phenomenon}: </span>
            {definition.phenomenon[locale]}
            <span className="ml-2 font-mono">{definition.id}</span>
          </p>
        </div>
      </section>

      <ModifiedBanner flags={share.flags} dict={dict} />

      {error !== null && (
        <p className="border border-vermilion bg-vermilion/5 px-3 py-2 font-mono text-label text-vermilion">
          {error}
        </p>
      )}

      {trace === null || current === null ? (
        <p className="py-24 text-center font-sans text-body text-ink-faint">
          {running ? dict.sim.computing : '—'}
        </p>
      ) : (
        <>
          {/*
           * The sentence comes before the picture. Somebody watching the ring move
           * without this is guessing; with it they are reading. The technical
           * rendering is one fold away, in the timeline below.
           */}
          <section className="card border-l-4 border-l-leader p-4" aria-live="off">
            <h2 className="field-label">{dict.plain.whatHappening}</h2>
            <p className="mt-1.5 max-w-4xl font-serif text-lede leading-snug text-ink">
              {narrateEvent(current.event, locale)}
            </p>
          </section>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
            <div className="flex flex-col gap-5">
              <section className="card" aria-label={dict.sim.cluster}>
                <div className="panel-head">
                  <h2 className="panel-title">{dict.sim.cluster}</h2>
                  <span className="ml-auto font-mono text-micro tabular text-ink-faint">
                    {dict.sim.time} {current.time}
                  </span>
                </div>
                <div className="p-4">
                  <NodeRing
                    step={current}
                    dict={dict}
                    selected={selected}
                    onSelect={setSelected}
                    onNodeAction={onNodeAction}
                  />
                  <div className="mt-4 border-t border-ink-rule pt-3">
                    <h3 className="field-label">{dict.sim.submit}</h3>
                    <p className="mt-1 font-sans text-micro leading-relaxed text-ink-faint">
                      {dict.sim.submitHint}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {current.nodes.map((node) => (
                        <button
                          key={node.id}
                          type="button"
                          onClick={() => onSubmitEntry(node.id)}
                          className="btn btn-small font-mono"
                        >
                          n{node.id}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => addAction({ at: current.time + 1, kind: 'heal' })}
                        className="btn btn-small ml-auto"
                      >
                        {dict.sim.heal}
                      </button>
                    </div>
                  </div>
                  <InFlightList step={current} dict={dict} />
                </div>
              </section>

              <section className="card" aria-label={dict.sim.invariants}>
                <div className="panel-head">
                  <h2 className="panel-title">{dict.sim.invariants}</h2>
                </div>
                <div className="p-4">
                  <p className="mb-3 font-sans text-micro leading-relaxed text-ink-faint">
                    {dict.plain.invariantsHelp}
                  </p>
                  <InvariantPanel
                    violations={trace.violations}
                    upToStep={step}
                    dict={dict}
                    onJump={(target) => {
                      setPlaying(false)
                      setStep(target)
                    }}
                  />
                </div>
              </section>
            </div>

            <section className="card min-w-0" aria-label={dict.sim.ledger}>
              <div className="panel-head">
                <h2 className="panel-title">{dict.sim.ledger}</h2>
              </div>
              <div className="min-w-0 p-4">
                <p className="mb-3 max-w-prose font-sans text-micro leading-relaxed text-ink-faint">
                  {dict.plain.ledgerHelp}
                </p>
                <LogLedger step={current} dict={dict} />
              </div>
            </section>
          </div>

          <section className="card" aria-label={dict.sim.timeline}>
            <div className="panel-head">
              <h2 className="panel-title">{dict.sim.timeline}</h2>
              <span className="ml-auto font-mono text-micro tabular text-ink-faint">
                {dict.sim.step} {step}/{trace.steps.length - 1}
              </span>
            </div>
            <div className="p-4">
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
            </div>
          </section>

          <SimGuide dict={dict} />

          <section className="card">
            <details>
              <summary className="panel-head cursor-pointer list-none">
                <h2 className="panel-title">{dict.nav.ablation}</h2>
                <span className="ml-auto font-sans text-micro text-ink-faint">
                  {dict.plain.readMore}
                </span>
              </summary>
              <div className="p-4">
                <p className="mb-4 max-w-prose font-sans text-label leading-relaxed text-ink-soft">
                  {dict.plain.ablationHelp}
                </p>
                <div className="max-w-3xl">
                  <AblationPanel
                    flags={share.flags}
                    onToggle={onToggle}
                    onReset={() => setShare((state) => ({ ...state, flags: UNMODIFIED_RAFT }))}
                    dict={dict}
                    locale={locale}
                    compact
                  />
                </div>
              </div>
            </details>
          </section>
        </>
      )}
    </div>
  )
}

function InFlightList({
  step,
  dict,
}: {
  step: {
    inFlight: readonly {
      message: { type: string; from: number; to: number; term: number }
      arrivesAt: number
      seq: number
    }[]
  }
  dict: ReturnType<typeof dictionary>
}) {
  return (
    <div className="mt-4 border-t border-ink-rule pt-3">
      <h3 className="field-label">{dict.sim.inFlight}</h3>
      {step.inFlight.length === 0 ? (
        <p className="mt-1 font-sans text-micro text-ink-faint">{dict.sim.noMessages}</p>
      ) : (
        <ul className="mt-1.5 max-h-32 overflow-y-auto font-mono text-micro tabular text-ink-soft">
          {step.inFlight.slice(0, 12).map((flight) => (
            <li key={flight.seq} className="py-0.5">
              n{flight.message.from}→n{flight.message.to} {flight.message.type} t
              {flight.message.term} @{flight.arrivesAt}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
