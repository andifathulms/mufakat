'use client'

/**
 * Scrubber and stepping controls.
 *
 * Stepping backwards is free, because the trace is materialised: nothing is
 * recomputed, the previous step is simply read. Animation timing lives here and never
 * feeds back into the simulation — the virtual clock does not know this component
 * exists.
 */

import { useEffect } from 'react'
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
          className="w-full accent-leader"
        />
        {/* Violation marks sit above the track, in the one colour reserved for them. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1.5">
          {marks.violations.map((mark) => (
            <span
              key={mark}
              className="absolute top-0 h-1.5 w-0.5 bg-vermilion"
              style={{ left: `${last === 0 ? 0 : (mark / last) * 100}%` }}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-xs font-sans">
        <Button onClick={() => { onPlaying(false); onStep(0) }} label="⏮" title={dict.sim.start} />
        <Button
          onClick={() => { onPlaying(false); onStep(Math.max(0, step - 1)) }}
          label="◀"
          title={dict.sim.back}
        />
        <button
          type="button"
          onClick={() => onPlaying(!playing)}
          className="border border-ink px-3 py-1 hover:bg-stock-deep min-w-[5rem]"
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
            className="border border-ink-rule bg-stock-pale px-1 py-0.5"
          >
            {[0.5, 1, 2, 4, 8].map((option) => (
              <option key={option} value={option}>
                {option}×
              </option>
            ))}
          </select>
        </label>

        <span className="ml-auto font-mono tabular text-ink-soft">
          {dict.sim.step} {step}/{last} · {dict.sim.time} {current?.time ?? 0}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5 text-[11px] font-sans">
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

      <p className="border border-ink-rule bg-stock-pale px-2 py-1 font-mono text-[11px] tabular text-ink-soft">
        <span className="text-ink-faint">{dict.sim.event}: </span>
        {current === undefined ? '—' : describeEvent(current.event)}
      </p>
      {trace.truncated && (
        <p className="text-[11px] font-sans text-ink-faint">{dict.sim.truncated}</p>
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
      className="border border-ink-rule px-2 py-1 hover:bg-stock-deep"
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
        'border px-2 py-0.5 disabled:opacity-35 disabled:cursor-not-allowed',
        danger ? 'border-vermilion text-vermilion' : 'border-ink-rule hover:bg-stock-deep',
      ].join(' ')}
    >
      {label}
    </button>
  )
}
