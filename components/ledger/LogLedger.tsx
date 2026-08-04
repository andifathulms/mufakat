'use client'

/**
 * The log ledger — the signature view.
 *
 * Every node's log is a ruled column and every entry a row, and the rows are aligned
 * across nodes **on index**. Divergence appears as rows that fail to line up, and
 * repair appears as the leader walking back and overwriting. The central abstraction
 * of Raft becomes something you can literally watch going wrong and getting fixed.
 */

import type { Dictionary } from '@/lib/i18n'
import type { LogEntry } from '@/lib/raft/types'
import type { TraceStep } from '@/lib/sim/trace'

interface Props {
  readonly step: TraceStep
  readonly dict: Dictionary
}

export function LogLedger({ step, dict }: Props) {
  const highest = Math.max(1, ...step.nodes.map((node) => node.log.length))
  const indices = Array.from({ length: highest }, (_, i) => highest - i)

  // An entry disagrees when some other node holds a different entry at that index.
  const disagreements = new Set<number>()
  for (let index = 1; index <= highest; index += 1) {
    const seen = new Set<string>()
    for (const node of step.nodes) {
      const entry = node.log[index - 1]
      if (entry !== undefined) seen.add(`${entry.term}:${entry.command}`)
    }
    if (seen.size > 1) disagreements.add(index)
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs font-mono tabular">
        <caption className="caption-bottom pt-2 text-left text-[11px] text-ink-faint font-sans">
          {dict.ledger.legend}
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="border-b-2 border-ink px-2 py-1 text-right font-sans text-[11px] text-ink-soft w-14"
            >
              {dict.ledger.index}
            </th>
            {step.nodes.map((node) => (
              <th
                key={node.id}
                scope="col"
                className="border-b-2 border-ink border-l border-ink-rule px-2 py-1 font-sans text-[11px]"
              >
                <span className="block">node {node.id}</span>
                <span className="block text-ink-faint">
                  {node.role === 'leader' ? 'L' : node.role === 'candidate' ? 'C' : 'F'}·t
                  {node.currentTerm}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {indices.map((index) => (
            <tr key={index} className={disagreements.has(index) ? 'bg-stock-deep' : undefined}>
              <th
                scope="row"
                className="border-b border-ink-rule px-2 py-1 text-right text-ink-faint font-normal"
              >
                {index}
              </th>
              {step.nodes.map((node) => (
                <Cell
                  key={node.id}
                  entry={node.log[index - 1]}
                  index={index}
                  committed={node.commitIndex >= index}
                  applied={node.lastApplied >= index}
                  dict={dict}
                />
              ))}
            </tr>
          ))}
          {highest === 1 && step.nodes.every((node) => node.log.length === 0) && (
            <tr>
              <td
                colSpan={step.nodes.length + 1}
                className="px-2 py-6 text-center text-ink-faint font-sans"
              >
                {dict.ledger.empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <Legend dict={dict} />
    </div>
  )
}

function Cell({
  entry,
  index,
  committed,
  applied,
  dict,
}: {
  entry: LogEntry | undefined
  index: number
  committed: boolean
  applied: boolean
  dict: Dictionary
}) {
  if (entry === undefined) {
    // A missing row is what makes divergence read as a broken line.
    return <td className="border-b border-l border-ink-rule px-2 py-1" />
  }
  return (
    <td
      className={[
        'border-b border-l border-ink-rule px-2 py-1',
        committed ? 'bg-committed/10' : 'bg-stock-pale',
      ].join(' ')}
      title={`index ${index}, term ${entry.term}, ${
        committed ? dict.ledger.committed : dict.ledger.uncommitted
      }`}
    >
      <span className="flex items-baseline gap-1.5">
        {/* Everything that distinguishes this cell — the term chip, the fill, the tick
            — is visual. State it in words for anyone who cannot see it. */}
        <span className="sr-only">
          {dict.ledger.index} {index}, term {entry.term},{' '}
          {committed ? dict.ledger.committed : dict.ledger.uncommitted}
          {applied ? `, ${dict.ledger.applied}` : ''}:{' '}
        </span>
        {/* Committed entries are visually settled; uncommitted ones are provisional,
            and say so with an outline rather than a colour. */}
        <span
          className={[
            'inline-block w-5 text-center text-[10px] leading-4 border',
            committed
              ? 'border-committed text-committed font-bold'
              : 'border-dashed border-ink-faint text-ink-faint',
          ].join(' ')}
          aria-hidden
        >
          {entry.term}
        </span>
        <span className={committed ? 'text-ink' : 'text-ink-soft italic'}>{entry.command}</span>
        {applied && (
          <span className="text-committed text-[10px]" title={dict.ledger.applied} aria-hidden>
            ✓
          </span>
        )}
      </span>
    </td>
  )
}

function Legend({ dict }: { dict: Dictionary }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-sans text-ink-soft">
      <li className="flex items-center gap-1.5">
        <span className="inline-block w-5 text-center border border-committed text-committed text-[10px] font-bold">
          2
        </span>
        {dict.ledger.committed}
      </li>
      <li className="flex items-center gap-1.5">
        <span className="inline-block w-5 text-center border border-dashed border-ink-faint text-ink-faint text-[10px]">
          2
        </span>
        {dict.ledger.uncommitted}
      </li>
      <li className="flex items-center gap-1.5">
        <span className="text-committed">✓</span>
        {dict.ledger.applied}
      </li>
    </ul>
  )
}
