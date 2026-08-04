'use client'

/**
 * The invariant panel: five properties, five indicators, always visible.
 *
 * Evaluated after every event across all nodes by `lib/invariants`, which shares no
 * code with the algorithm. On a violation the panel names the property, the index,
 * the terms and the nodes, and offers to step back to the moment it happened.
 *
 * In normal operation all five stay green, which is itself informative: it shows the
 * algorithm holding under adversarial conditions.
 *
 * Vermilion appears here and nowhere else in the application.
 */

import type { Dictionary } from '@/lib/i18n'
import { SAFETY_PROPERTIES, type SafetyProperty, type Violation } from '@/lib/invariants/types'

interface Props {
  readonly violations: readonly Violation[]
  /** Only violations at or before the step being viewed are shown as having happened. */
  readonly upToStep: number
  readonly dict: Dictionary
  readonly onJump: (step: number) => void
}

export function InvariantPanel({ violations, upToStep, dict, onJump }: Props) {
  const sofar = violations.filter((violation) => violation.stepIndex <= upToStep)
  const firstByProperty = new Map<SafetyProperty, Violation>()
  for (const violation of sofar) {
    if (!firstByProperty.has(violation.property)) firstByProperty.set(violation.property, violation)
  }

  return (
    <section aria-label={dict.sim.invariants} className="flex flex-col gap-2">
      <ul className="flex flex-col">
        {SAFETY_PROPERTIES.map((property) => {
          const violation = firstByProperty.get(property)
          const broken = violation !== undefined
          return (
            <li
              key={property}
              className={[
                'border-b border-ink-rule py-2',
                broken ? 'bg-vermilion/10' : '',
              ].join(' ')}
            >
              <div className="flex items-center gap-2">
                {/* Shape as well as colour: a filled square holds, a struck square
                    does not. Never colour alone. */}
                <span
                  aria-hidden
                  className={[
                    'inline-flex h-4 w-4 shrink-0 items-center justify-center border text-[10px] font-bold leading-none',
                    broken
                      ? 'border-vermilion text-vermilion'
                      : 'border-committed bg-committed text-stock-pale',
                  ].join(' ')}
                >
                  {broken ? '×' : '✓'}
                </span>
                <span className="font-mono text-xs">{dict.invariants.names[property]}</span>
                <span
                  className={[
                    'ml-auto font-sans text-[11px]',
                    broken ? 'text-vermilion font-semibold' : 'text-ink-faint',
                  ].join(' ')}
                >
                  {broken ? dict.invariants.broken : dict.invariants.holding}
                </span>
              </div>
              {violation !== undefined && (
                <div className="mt-1.5 pl-6 text-[11px] font-sans text-ink">
                  {/* Stated flatly, with the mechanism named. No alarm language. */}
                  <p>{violation.summary}</p>
                  <p className="mt-1 text-ink-faint font-mono tabular">
                    {violation.logIndex !== null && <>index {violation.logIndex} · </>}
                    {violation.terms.length > 0 && <>term {violation.terms.join(', ')} · </>}
                    node {violation.nodes.join(', ')} · {dict.invariants.atStep}{' '}
                    {violation.stepIndex}
                  </p>
                  <button
                    type="button"
                    className="mt-1 border border-vermilion px-2 py-0.5 text-vermilion hover:bg-vermilion hover:text-stock-pale"
                    onClick={() => onJump(violation.stepIndex)}
                  >
                    {dict.invariants.stepBack}
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {firstByProperty.size === 0 && (
        <p className="text-[11px] font-sans text-ink-faint">{dict.invariants.allHolding}</p>
      )}
    </section>
  )
}
