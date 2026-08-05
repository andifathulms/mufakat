'use client'

/**
 * Scrubber and stepping controls.
 *
 * Stepping backwards is free, because the trace is materialised: nothing is
 * recomputed, the previous step is simply read. Animation timing lives here and never
 * feeds back into the simulation — the virtual clock does not know this component
 * exists.
 */

import { useEffect, useMemo } from 'react'
import type { Dictionary } from '@/lib/i18n'
import { describeEvent, type Trace } from '@/lib/sim/trace'

interface Props {
  readonly trace: Trace
  readonly step: number
  readonly onStep: (step: number) => void
  readonly playing: boolean
  readonly onPlaying: (playing: boolean) => void
  readonly speed: number
  readonly onSpeed: (speed: number) => void
  readonly marks: {
    readonly terms: readonly number[]
    readonly elections: readonly number[]
    readonly commits: readonly number[]
    readonly violations: readonly number[]
  }
  readonly dict: Dictionary
}

function nextAfter(marks: readonly number[], current: number): number | null {
  for (const mark of marks) if (mark > current) return mark
  return null
}

/** Collapse an ascending list of step indices into contiguous runs. */
function runsOf(marks: readonly number[]): { from: number; to: number }[] {
  const runs: { from: number; to: number }[] = []
  for (const mark of marks) {
    const open = runs[runs.length - 1]
    if (open !== undefined && mark === open.to + 1) open.to = mark
    else runs.push({ from: mark, to: mark })
  }
  return runs
}

export function Timeline({
  trace,
  step,
  onStep,
  playing,
  onPlaying,
  speed,
  onSpeed,
  marks,
  dict,
}: Props) {
  const last = trace.steps.length - 1
  const current = trace.steps[step]
  const violationRuns = useMemo(() => runsOf(marks.violations), [marks.violations])

  useEffect(() => {
    if (!playing) return
    // `prefers-reduced-motion` disables autoplay; stepping stays instantaneous.
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      onPlaying(false)
      return
    }
    const interval = window.setInterval(() => {
      onStep(Math.min(last, step + 1))
    }, Math.max(16, 500 / speed))
    return () => window.clearInterval(interval)
  }, [playing, speed, step, last, onStep, onPlaying])

  useEffect(() => {
    if (step >= last && playing) onPlaying(false)
  }, [step, last, playing, onPlaying])

  return (
    <section aria-label={dict.sim.timeline} className="flex flex-col gap-2">
      <div className="relative">
        <input
          type="range"
          min={0}
          max={last}
          value={step}
          onChange={(event) => {
            onPlaying(false)
            onStep(Number(event.target.value))
          }}
          aria-label={dict.sim.timeline}
          // The raw step number says nothing on its own. Announce the virtual time and
          // what actually happened, which is what the scrubber is for.
          aria-valuetext={`${dict.sim.step} ${step}, ${dict.sim.time} ${current?.time ?? 0}, ${
            current === undefined ? '' : describeEvent(current.event)
          }`}
          className="w-full accent-leader"
        />
        {/* Violation marks sit above the track, in the one colour reserved for them.
            A broken property stays broken, so these arrive in long unbroken runs —
            collapsed into one span each rather than one per step. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1.5">
          {violationRuns.map((span) => (
            <span
              key={span.from}
              className="absolute top-0 h-1.5 bg-vermilion"
              style={{
                left: `${last === 0 ? 0 : (span.from / last) * 100}%`,
                width: `${last === 0 ? 100 : Math.max(0.3, ((span.to - span.from) / last) * 100)}%`,
              }}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 font-sans text-label">
        <Button onClick={() => { onPlaying(false); onStep(0) }} label="⏮" title={dict.sim.start} />
        <Button
          onClick={() => { onPlaying(false); onStep(Math.max(0, step - 1)) }}
          label="◀"
          title={dict.sim.back}
        />
        <button
          type="button"
          onClick={() => onPlaying(!playing)}
          className="btn min-w-[6rem] border-ink font-medium"
        >
          {playing ? dict.sim.pause : dict.sim.play}
        </button>
        <Button
          onClick={() => { onPlaying(false); onStep(Math.min(last, step + 1)) }}
          label="▶"
          title={dict.sim.forward}
        />
        <Button onClick={() => { onPlaying(false); onStep(last) }} label="⏭" title={dict.sim.end} />

        <label className="ml-2 flex items-center gap-1 text-ink-soft">
          {dict.sim.speed}
          <select
            value={speed}
            onChange={(event) => onSpeed(Number(event.target.value))}
            className="border border-ink-edge bg-stock-pale px-1.5 py-1"
          >
            {[0.5, 1, 2, 4, 8].map((option) => (
              <option key={option} value={option}>
                {option}×
              </option>
            ))}
          </select>
        </label>

        <span className="ml-auto font-mono text-micro tabular text-ink-faint">
          {dict.sim.step} {step}/{last} · {dict.sim.time} {current?.time ?? 0}
        </span>
      </div>

      {/* Jump to the next thing worth looking at. Scrubbing an event at a time is
          how you inspect a run; these are how you find the moment worth inspecting. */}
      <div className="flex flex-wrap items-center gap-1.5 font-sans text-micro">
        <span className="field-label mr-1">{dict.sim.jumpTo}</span>
        <Jump label={dict.sim.nextTerm} target={nextAfter(marks.terms, step)} onStep={onStep} onPlaying={onPlaying} />
        <Jump label={dict.sim.nextElection} target={nextAfter(marks.elections, step)} onStep={onStep} onPlaying={onPlaying} />
        <Jump label={dict.sim.nextCommit} target={nextAfter(marks.commits, step)} onStep={onStep} onPlaying={onPlaying} />
        <Jump
          label={dict.sim.nextViolation}
          target={nextAfter(marks.violations, step)}
          onStep={onStep}
          onPlaying={onPlaying}
          danger
        />
      </div>

      {/* The exact event, in the vocabulary of the paper. Folded away because the
          sentence above the cluster already says what happened — this is here for
          when the sentence is not precise enough, which for some readers is always. */}
      <details className="border border-ink-rule bg-stock-pale">
        <summary className="cursor-pointer px-2.5 py-1.5 font-sans text-micro text-ink-faint hover:text-ink">
          {dict.plain.technicalDetail}
        </summary>
        <p className="border-t border-ink-rule px-2.5 py-1.5 font-mono text-micro tabular text-ink-soft">
          <span className="text-ink-faint">{dict.sim.event}: </span>
          {current === undefined ? '—' : describeEvent(current.event)}
        </p>
      </details>
      {trace.truncated && (
        <p className="font-sans text-micro text-ink-faint">{dict.sim.truncated}</p>
      )}
    </section>
  )
}

function Button({ onClick, label, title }: { onClick: () => void; label: string; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="btn btn-small"
    >
      {label}
    </button>
  )
}

function Jump({
  label,
  target,
  onStep,
  onPlaying,
  danger = false,
}: {
  label: string
  target: number | null
  onStep: (step: number) => void
  onPlaying: (playing: boolean) => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      disabled={target === null}
      onClick={() => {
        if (target === null) return
        onPlaying(false)
        onStep(target)
      }}
      className={[
        'btn btn-small',
        danger ? 'btn-violation' : '',
      ].join(' ')}
    >
      {label}
    </button>
  )
}
