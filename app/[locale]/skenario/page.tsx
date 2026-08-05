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
  jointConsensus: 'jc',
}

export default function ScenariosPage({ params }: { params: { locale: string } }) {
  if (!isLocale(params.locale)) notFound()
  const locale = params.locale
  const dict = dictionary(locale)

  return (
    <div className="flex flex-col gap-6">
      <header className="max-w-3xl">
        <h1 className="font-serif text-3xl sm:text-4xl">{dict.nav.scenarios}</h1>
        <p className="mt-3 max-w-prose plain">
          {locale === 'id'
            ? 'Tiap skenario adalah satu situasi yang dibangun tangan untuk menunjukkan satu hal — pemilihan yang bersih, dua calon yang saling mengunci, jaringan yang terbelah. Buka salah satu, lalu tekan Jalankan.'
            : 'Each scenario is one hand-built situation showing one thing — a clean election, two candidates deadlocking each other, a network cut in half. Open one and press play.'}
        </p>
        <p className="mt-3 max-w-prose font-sans text-label leading-relaxed text-ink-faint">
          {dict.scenarios.lede}
        </p>
      </header>

      <ul className="grid gap-4 md:grid-cols-2">
        {SCENARIOS.map((entry) => {
          const descriptor =
            entry.ablation === undefined ? null : descriptorFor(entry.ablation.flag)
          return (
            <li key={entry.id} className="card flex flex-col p-5">
              <h2 className="font-serif text-xl leading-snug">{entry.title}</h2>
              <p className="mt-0.5 font-mono text-micro text-ink-faint">{entry.id}</p>
              <p className="mt-2.5 font-sans text-body leading-relaxed">{entry.summary}</p>

              <div className="mt-3.5 border-t border-ink-rule pt-2.5">
                <h3 className="field-label">{dict.scenarios.phenomenon}</h3>
                <p className="mt-1 font-sans text-label leading-relaxed text-ink-soft">
                  {entry.phenomenon[locale]}
                </p>
              </div>

              <dl className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-micro text-ink-faint">
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

              <div className="mt-auto flex flex-wrap gap-2 pt-5">
                <Link href={`/${locale}/simulasi/#s=${entry.id}`} className="btn btn-strong">
                  {dict.scenarios.open}
                </Link>
                {entry.ablation !== undefined && descriptor !== null && (
                  <Link
                    href={`/${locale}/simulasi/#s=${entry.id}&off=${FLAG_CODES[entry.ablation.flag]}`}
                    className="btn btn-violation"
                  >
                    {dict.scenarios.breaksWith}:{' '}
                    {dict.ablation.rules[entry.ablation.flag]?.title ?? entry.ablation.flag}
                  </Link>
                )}
              </div>
              {entry.ablation !== undefined && (
                <p className="mt-2.5 font-mono text-micro text-ink-faint">
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
