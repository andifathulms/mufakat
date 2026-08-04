import Link from 'next/link'
import { notFound } from 'next/navigation'
import { SCENARIOS } from '@/data/scenarios'
import { LOCALES, dictionary, isLocale, type Locale } from '@/lib/i18n'
import { descriptorFor } from '@/lib/raft/rules'

export function generateStaticParams(): { locale: Locale }[] {
  return LOCALES.map((locale) => ({ locale }))
}

/** Short codes must match `lib/share.ts`; they appear in links people have sent. */
const FLAG_CODES: Record<string, string> = {
  electionRestriction: 'er',
  currentTermCommitRule: 'ct',
  appendEntriesConsistencyCheck: 'ae',
  termIncrementOnCandidacy: 'ti',
  stepDownOnHigherTerm: 'sd',
  persistVotedFor: 'pv',
}

export default function ScenariosPage({ params }: { params: { locale: string } }) {
  if (!isLocale(params.locale)) notFound()
  const locale = params.locale
  const dict = dictionary(locale)

  return (
    <div className="flex flex-col gap-6">
      <header className="max-w-3xl">
        <h1 className="font-serif text-3xl">{dict.nav.scenarios}</h1>
        <p className="mt-2 font-sans text-sm leading-relaxed text-ink-soft">
          {dict.scenarios.lede}
        </p>
      </header>

      <ul className="grid gap-4 md:grid-cols-2">
        {SCENARIOS.map((entry) => {
          const descriptor =
            entry.ablation === undefined ? null : descriptorFor(entry.ablation.flag)
          return (
            <li key={entry.id} className="flex flex-col border border-ink-rule bg-stock-pale p-4">
              <h2 className="font-serif text-xl">{entry.title}</h2>
              <p className="mt-0.5 font-mono text-[11px] text-ink-faint">{entry.id}</p>
              <p className="mt-2 font-sans text-sm leading-relaxed">{entry.summary}</p>

              <div className="mt-3 border-t border-ink-rule pt-2">
                <h3 className="font-sans text-[11px] uppercase tracking-wide text-ink-faint">
                  {dict.scenarios.phenomenon}
                </h3>
                <p className="mt-1 font-sans text-xs leading-relaxed text-ink-soft">
                  {entry.phenomenon[locale]}
                </p>
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-[11px] text-ink-faint">
                <div className="flex gap-2">
                  <dt>nodes:</dt>
                  <dd className="text-ink-soft tabular">{entry.spec.nodeCount}</dd>
                </div>
                <div className="flex gap-2">
                  <dt>seed:</dt>
                  <dd className="text-ink-soft tabular">{entry.spec.seed}</dd>
                </div>
                <div className="flex gap-2">
                  <dt>drop:</dt>
                  <dd className="text-ink-soft tabular">
                    {(entry.spec.network.dropPerMille / 10).toFixed(1)}%
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt>actions:</dt>
                  <dd className="text-ink-soft tabular">{entry.spec.actions.length}</dd>
                </div>
              </dl>

              <div className="mt-4 flex flex-wrap gap-2 font-sans text-xs">
                <Link
                  href={`/${locale}/simulasi/#s=${entry.id}`}
                  className="border border-ink px-3 py-1 hover:bg-ink hover:text-stock"
                >
                  {dict.scenarios.open}
                </Link>
                {entry.ablation !== undefined && descriptor !== null && (
                  <Link
                    href={`/${locale}/simulasi/#s=${entry.id}&off=${FLAG_CODES[entry.ablation.flag]}`}
                    className="border border-vermilion px-3 py-1 text-vermilion hover:bg-vermilion hover:text-stock"
                  >
                    {dict.scenarios.breaksWith}:{' '}
                    {dict.ablation.rules[entry.ablation.flag]?.title ?? entry.ablation.flag}
                  </Link>
                )}
              </div>
              {entry.ablation !== undefined && (
                <p className="mt-2 font-mono text-[11px] text-ink-faint">
                  {dict.ablation.protects}: {dict.invariants.names[entry.ablation.breaks]} ·{' '}
                  {descriptor?.paperSection}
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
