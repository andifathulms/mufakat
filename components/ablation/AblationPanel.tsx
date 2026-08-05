'use client'

/**
 * The ablation panel — the flagship.
 *
 * Each rule is toggleable and labelled with the property it protects, the section of
 * the paper that justifies it, its location in Figure 2, and the single place in the
 * source where the guard is consulted. The last of those is what makes the toggle
 * checkable rather than merely claimed.
 */

import Link from 'next/link'
import {
  ABLATION_FLAG_NAMES,
  descriptorFor,
  isModifiedRaft,
  type AblationFlagName,
  type AblationFlags,
} from '@/lib/raft/rules'
import type { Dictionary, Locale } from '@/lib/i18n'
import { scenarioById } from '@/data/scenarios'

interface Props {
  readonly flags: AblationFlags
  readonly onToggle: (flag: AblationFlagName, enabled: boolean) => void
  readonly onReset: () => void
  readonly dict: Dictionary
  readonly locale: Locale
  readonly compact?: boolean
}

export function AblationPanel({ flags, onToggle, onReset, dict, locale, compact = false }: Props) {
  return (
    <div className="flex flex-col gap-3">
      <ModifiedBanner flags={flags} dict={dict} />
      <ul className="flex flex-col gap-3">
        {ABLATION_FLAG_NAMES.map((flag) => {
          const descriptor = descriptorFor(flag)
          const copy = dict.ablation.rules[flag]
          const enabled = flags[flag]
          const scenario = scenarioById(descriptor.scenarioId)
          return (
            <li
              key={flag}
              className={[
                'border p-4',
                enabled ? 'border-ink-rule bg-stock-raised' : 'border-vermilion bg-vermilion/5',
              ].join(' ')}
            >
              <div className="flex items-start gap-3.5">
                {/* The switch states its position in a word as well as a colour, and
                    its off position is vermilion because off means a broken run. */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  aria-label={copy?.title ?? flag}
                  onClick={() => onToggle(flag, !enabled)}
                  className={[
                    'mt-0.5 w-16 shrink-0 border px-2 py-1.5 font-mono text-micro font-bold tracking-wide transition-colors',
                    enabled
                      ? 'border-committed text-committed hover:bg-committed hover:text-stock-pale'
                      : 'border-vermilion bg-vermilion text-stock-pale',
                  ].join(' ')}
                >
                  {enabled ? dict.ablation.on : dict.ablation.off}
                </button>
                <div className="min-w-0 flex-1">
                  <h3 className="font-mono text-data font-bold">{copy?.title ?? flag}</h3>
                  {/* What is at stake, said without jargon, before the paper citation
                      that justifies it. This is the line that makes a toggle feel
                      like a consequence rather than a preference. */}
                  <p className="mt-1.5 font-sans text-label leading-relaxed text-ink">
                    <span className="text-ink-faint">{dict.ablation.ifOff}: </span>
                    {dict.plain.properties[descriptor.protects]}
                  </p>
                  {!compact && (
                    <p className="mt-2 max-w-prose font-sans text-label leading-relaxed text-ink-soft">
                      {copy?.body}
                    </p>
                  )}
                  <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 border-t border-ink-rule pt-2.5 font-mono text-micro text-ink-faint sm:grid-cols-2">
                    <Row label={dict.ablation.protects}>
                      {dict.invariants.names[descriptor.protects]}
                    </Row>
                    <Row label={dict.ablation.section}>{descriptor.paperSection}</Row>
                    {!compact && (
                      <>
                        <Row label={dict.ablation.figure2}>{descriptor.figure2}</Row>
                        <Row label={dict.ablation.callSite}>{descriptor.callSite}</Row>
                      </>
                    )}
                    <Row label={dict.ablation.scenario}>
                      <Link
                        href={`/${locale}/simulasi/#s=${scenario.id}&off=${flag}`}
                        className="underline decoration-dotted underline-offset-2 hover:text-ink"
                      >
                        {scenario.id}
                      </Link>
                    </Row>
                  </dl>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
      <button
        type="button"
        onClick={onReset}
        disabled={!isModifiedRaft(flags)}
        className="btn self-start border-ink"
      >
        {dict.ablation.reset}
      </button>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0">{label}:</dt>
      <dd className="text-ink-soft">{children}</dd>
    </div>
  )
}

/**
 * A run with any rule off is permanently and visibly labelled. Nobody should
 * screenshot a broken run and take it for real Raft.
 */
export function ModifiedBanner({ flags, dict }: { flags: AblationFlags; dict: Dictionary }) {
  if (!isModifiedRaft(flags)) {
    return (
      <p className="flex items-center gap-2 border border-committed bg-committed/10 px-3 py-2 font-sans text-label text-ink">
        <span
          aria-hidden
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center border border-committed bg-committed text-[10px] font-bold leading-none text-stock-pale"
        >
          ✓
        </span>
        {dict.ablation.unmodified}
      </p>
    )
  }
  const off = ABLATION_FLAG_NAMES.filter((flag) => !flags[flag])
  return (
    /* The tint is 5%, not 10%: vermilion text on a 10% vermilion wash over the page
       measures 4.39:1, under AA, and this is the one label in the application that
       must not be hard to read. At 5% it is 4.72:1, and the 2px border carries the
       alarm anyway. */
    <div className="border-2 border-vermilion bg-vermilion/5 px-4 py-3">
      <p className="font-mono text-base font-bold tracking-wide text-vermilion">
        {dict.ablation.modified}
      </p>
      <p className="mt-1.5 max-w-prose font-sans text-label leading-relaxed text-ink">
        {dict.ablation.modifiedLong}
      </p>
      <p className="mt-2 font-mono text-micro text-ink-soft">
        {off.map((flag) => dict.ablation.rules[flag]?.title ?? flag).join(' · ')}
      </p>
    </div>
  )
}
