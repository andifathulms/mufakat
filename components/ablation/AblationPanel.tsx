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
                'border p-3',
                enabled ? 'border-ink-rule bg-stock-pale' : 'border-vermilion bg-vermilion/5',
              ].join(' ')}
            >
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  onClick={() => onToggle(flag, !enabled)}
                  className={[
                    'mt-0.5 shrink-0 border px-2 py-1 font-mono text-[11px] font-bold w-16',
                    enabled
                      ? 'border-committed text-committed'
                      : 'border-vermilion bg-vermilion text-stock-pale',
                  ].join(' ')}
                >
                  {enabled ? dict.ablation.on : dict.ablation.off}
                </button>
                <div className="flex-1">
                  <h3 className="font-mono text-sm">{copy?.title ?? flag}</h3>
                  {!compact && (
                    <p className="mt-1 font-sans text-xs leading-relaxed text-ink-soft">
                      {copy?.body}
                    </p>
                  )}
                  <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-0.5 font-mono text-[11px] text-ink-faint sm:grid-cols-2">
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
        className="self-start border border-ink px-3 py-1 font-sans text-xs hover:bg-stock-deep disabled:opacity-35"
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
      <p className="border border-committed bg-committed/10 px-3 py-2 font-sans text-xs text-ink">
        {dict.ablation.unmodified}
      </p>
    )
  }
  const off = ABLATION_FLAG_NAMES.filter((flag) => !flags[flag])
  return (
    <div className="border-2 border-vermilion bg-vermilion/10 px-3 py-2">
      <p className="font-mono text-sm font-bold tracking-wide text-vermilion">
        {dict.ablation.modified}
      </p>
      <p className="mt-1 font-sans text-xs text-ink">{dict.ablation.modifiedLong}</p>
      <p className="mt-1 font-mono text-[11px] text-ink-soft">
        {off.map((flag) => dict.ablation.rules[flag]?.title ?? flag).join(' · ')}
      </p>
    </div>
  )
}
