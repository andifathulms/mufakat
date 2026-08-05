import Link from 'next/link'
import { notFound } from 'next/navigation'
import { RoleGlyph } from '@/components/cluster/glyph'
import { MajorityDiagram } from '@/components/home/MajorityDiagram'
import { LOCALES, dictionary, isLocale, type Locale } from '@/lib/i18n'
import { SAFETY_PROPERTIES, PROPERTY_STATEMENTS } from '@/lib/invariants/types'
import type { Role } from '@/lib/raft/types'

export function generateStaticParams(): { locale: Locale }[] {
  return LOCALES.map((locale) => ({ locale }))
}

/**
 * The home page has two readers and does not make them read each other's copy.
 *
 * Someone who has never heard of Raft needs to know what problem it solves before any
 * of this means anything, and they will bounce off "deterministic discrete-event
 * simulation" in the first line. Someone who has read the paper wants to know what
 * this adds to RaftScope and can skip the explanation entirely.
 *
 * So the page runs plain-first and technical-second, and the technical half is
 * complete rather than a summary — the newcomer is not being protected from it, only
 * given somewhere to stand first.
 */
export default function Home({ params }: { params: { locale: string } }) {
  if (!isLocale(params.locale)) notFound()
  const locale = params.locale
  const dict = dictionary(locale)
  const id = locale === 'id'

  const routes: { href: string; title: string; body: string; tone: 'strong' | 'quiet' | 'violation' }[] = [
    {
      href: `/${locale}/simulasi/#s=clean-election`,
      title: id ? 'Tonton satu pemilihan' : 'Watch an election',
      body: id
        ? 'Lima komputer, tidak ada yang memimpin, lalu satu terpilih. Mulailah dari sini.'
        : 'Five computers, nobody in charge, then one is elected. Start here.',
      tone: 'strong',
    },
    {
      href: `/${locale}/ablasi`,
      title: id ? 'Matikan sebuah aturan' : 'Switch a rule off',
      body: id
        ? 'Setiap aturan menjaga satu janji. Matikan salah satunya, lalu lihat janjinya gagal.'
        : 'Each rule defends one promise. Switch one off and watch that promise fail.',
      tone: 'quiet',
    },
    {
      href: `/${locale}/simulasi/#s=figure-8&off=ct`,
      title: id ? 'Figure 8, hidup' : 'Figure 8, live',
      body: id
        ? 'Diagram paling terkenal di makalah Raft — di sini ia berjalan, dan catatan yang sudah sah tertimpa.'
        : 'The most famous diagram in the Raft paper — here it runs, and a settled record is overwritten.',
      tone: 'violation',
    },
  ]

  const legend: { role: Role; crashed?: boolean; name: string; body: string }[] = [
    { role: 'leader', name: dict.roles.leader, body: dict.plain.roles.leader },
    { role: 'follower', name: dict.roles.follower, body: dict.plain.roles.follower },
    { role: 'candidate', name: dict.roles.candidate, body: dict.plain.roles.candidate },
    { role: 'follower', crashed: true, name: dict.roles.crashed, body: dict.plain.roles.crashed },
  ]

  return (
    <div className="flex flex-col gap-14 pb-8">
      {/* ---- Plain first. No algorithm term appears before the reader has a reason
              to care about it. ---- */}
      <section className="max-w-3xl pt-2">
        <p className="field-label">{dict.nav.tagline}</p>
        <h1 className="mt-3 font-serif text-4xl leading-[1.15] sm:text-5xl">
          {dict.plain.headline}
        </h1>
        <p className="mt-5 max-w-prose font-serif text-lede text-ink">{dict.plain.lede}</p>
        <p className="mt-4 max-w-prose plain">{dict.plain.whyHard}</p>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Link href={`/${locale}/simulasi`} className="btn btn-strong">
            {dict.home.start}
          </Link>
          <Link href={`/${locale}/skenario`} className="btn">
            {dict.nav.scenarios}
          </Link>
        </div>
      </section>

      <section className="max-w-4xl">
        <h2 className="font-serif text-2xl">{dict.plain.stepsTitle}</h2>
        <ol className="mt-5 grid gap-6 sm:grid-cols-3">
          {dict.plain.steps.map((entry, index) => (
            <li key={entry.title} className="flex flex-col gap-2">
              <span
                aria-hidden
                className="flex h-7 w-7 items-center justify-center border border-ink font-mono text-label tabular"
              >
                {index + 1}
              </span>
              <h3 className="font-serif text-lg leading-snug">{entry.title}</h3>
              <p className="font-sans text-label leading-relaxed text-ink-soft">{entry.body}</p>
            </li>
          ))}
        </ol>
        <div className="mt-7 max-w-2xl">
          <MajorityDiagram locale={locale} />
        </div>
      </section>

      <section className="max-w-4xl">
        <h2 className="font-serif text-2xl">{dict.plain.legendTitle}</h2>
        <p className="mt-2 max-w-prose plain">{dict.plain.clusterHelp}</p>
        <ul className="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {legend.map((entry) => (
            <li key={entry.name} className="flex items-start gap-3">
              <RoleGlyph role={entry.role} crashed={entry.crashed} />
              <div className="min-w-0">
                <p className="font-mono text-data font-bold">{entry.name}</p>
                <p className="mt-0.5 font-sans text-label leading-relaxed text-ink-soft">
                  {entry.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="max-w-4xl">
        <h2 className="font-serif text-2xl">{dict.plain.tryTitle}</h2>
        <ul className="mt-5 grid gap-4 sm:grid-cols-3">
          {routes.map((route) => (
            <li key={route.href} className="flex">
              <Link
                href={route.href}
                className={[
                  'card group flex w-full flex-col gap-2 p-4 transition-colors hover:bg-stock-pale',
                  route.tone === 'violation' ? 'border-vermilion' : '',
                  route.tone === 'strong' ? 'border-ink' : '',
                ].join(' ')}
              >
                <h3
                  className={[
                    'font-serif text-lg leading-snug',
                    route.tone === 'violation' ? 'text-vermilion' : '',
                  ].join(' ')}
                >
                  {route.title}
                </h3>
                <p className="font-sans text-label leading-relaxed text-ink-soft">{route.body}</p>
                <span
                  aria-hidden
                  className="mt-auto pt-2 font-sans text-label text-ink-faint group-hover:text-ink"
                >
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* ---- The five properties, said twice: once plainly, once exactly. Neither is
              a substitute for the other — the plain line is what makes someone care,
              the formal statement is what the checker actually evaluates. ---- */}
      <section className="max-w-4xl">
        <h2 className="font-serif text-2xl">{dict.plain.propertiesTitle}</h2>
        <p className="mt-2 max-w-prose plain">{dict.plain.propertiesIntro}</p>
        <ul className="mt-5 flex flex-col border-t border-ink-rule">
          {SAFETY_PROPERTIES.map((property) => (
            <li key={property} className="border-b border-ink-rule py-4">
              <p className="font-sans text-body leading-relaxed text-ink">
                {dict.plain.properties[property]}
              </p>
              <p className="mt-1.5 font-mono text-micro text-ink-faint">
                <span className="text-ink-soft">{dict.invariants.names[property]}</span> ·{' '}
                {PROPERTY_STATEMENTS[property]}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* ---- Technical second, and complete. ---- */}
      <section className="max-w-4xl border-t-2 border-ink pt-8">
        <h2 className="font-serif text-2xl">{dict.plain.forExperts}</h2>
        <p className="mt-3 max-w-prose font-serif text-lede">{dict.home.lede}</p>

        <div className="mt-8 grid gap-8 md:grid-cols-2">
          <div>
            <h3 className="font-serif text-lg">{dict.home.priorArtTitle}</h3>
            <p className="mt-2 font-sans text-label leading-relaxed text-ink-soft">
              {dict.home.priorArt}
            </p>
          </div>
          <div>
            <h3 className="font-serif text-lg">{dict.home.contributionTitle}</h3>
            <p className="mt-2 font-sans text-label leading-relaxed text-ink-soft">
              {dict.home.contribution}
            </p>
          </div>
          <div className="md:col-span-2">
            <h3 className="font-serif text-lg">{dict.home.sourceTitle}</h3>
            <p className="mt-2 max-w-prose font-sans text-label leading-relaxed text-ink-soft">
              {dict.home.source}
            </p>
          </div>
        </div>
      </section>

      <section className="max-w-3xl">
        <p className="font-sans text-micro italic leading-relaxed text-ink-faint">
          {id
            ? 'mufakat — kesepakatan yang dicapai lewat musyawarah, dari musyawarah mufakat pada sila keempat Pancasila. Nama yang kebetulan tepat: yang disimulasikan memang sebuah algoritma konsensus.'
            : 'mufakat — Indonesian for consensus reached through deliberation, from musyawarah mufakat in the fourth sila of Pancasila. An unusually exact name: the thing being simulated is a consensus algorithm.'}
        </p>
      </section>
    </div>
  )
}
