import Link from 'next/link'
import { notFound } from 'next/navigation'
import { LOCALES, dictionary, isLocale, type Locale } from '@/lib/i18n'
import { SAFETY_PROPERTIES, PROPERTY_STATEMENTS } from '@/lib/invariants/types'

export function generateStaticParams(): { locale: Locale }[] {
  return LOCALES.map((locale) => ({ locale }))
}

export default function Home({ params }: { params: { locale: string } }) {
  if (!isLocale(params.locale)) notFound()
  const locale = params.locale
  const dict = dictionary(locale)

  return (
    <div className="flex flex-col gap-10">
      <section className="max-w-3xl">
        <h1 className="font-serif text-4xl leading-tight">Mufakat</h1>
        <p className="mt-1 font-sans text-xs italic text-ink-faint">
          mufakat — kesepakatan yang dicapai lewat musyawarah. Nama yang tepat: yang
          disimulasikan memang sebuah algoritma konsensus.
        </p>
        <p className="mt-4 font-serif text-lg leading-relaxed">{dict.home.lede}</p>
        <div className="mt-5 flex flex-wrap gap-3 font-sans text-sm">
          <Link
            href={`/${locale}/simulasi`}
            className="border-2 border-ink px-4 py-2 hover:bg-ink hover:text-stock"
          >
            {dict.home.start}
          </Link>
          <Link
            href={`/${locale}/simulasi/#s=figure-8&off=ct`}
            className="border border-vermilion px-4 py-2 text-vermilion hover:bg-vermilion hover:text-stock"
          >
            {dict.home.openFigure8}
          </Link>
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-2 max-w-4xl">
        <div>
          <h2 className="font-serif text-xl">{dict.home.priorArtTitle}</h2>
          <p className="mt-2 font-sans text-sm leading-relaxed text-ink-soft">
            {dict.home.priorArt}
          </p>
        </div>
        <div>
          <h2 className="font-serif text-xl">{dict.home.contributionTitle}</h2>
          <p className="mt-2 font-sans text-sm leading-relaxed text-ink-soft">
            {dict.home.contribution}
          </p>
        </div>
      </section>

      <section className="max-w-4xl">
        <h2 className="font-serif text-xl">
          {locale === 'id' ? 'Lima properti keamanan' : 'The five safety properties'}
        </h2>
        <ul className="mt-3 ruled border-y border-ink-rule">
          {SAFETY_PROPERTIES.map((property) => (
            <li key={property} className="flex flex-col gap-1 py-2 sm:flex-row sm:gap-4">
              <span className="w-56 shrink-0 font-mono text-sm">
                {dict.invariants.names[property]}
              </span>
              <span className="font-sans text-sm text-ink-soft">
                {PROPERTY_STATEMENTS[property]}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 font-sans text-xs text-ink-faint">
          {locale === 'id'
            ? 'Dievaluasi setelah setiap peristiwa oleh pemeriksa yang tidak berbagi kode apa pun dengan implementasinya.'
            : 'Evaluated after every event by a checker that shares no code with the implementation.'}
        </p>
      </section>

      <section className="max-w-3xl">
        <h2 className="font-serif text-xl">{dict.home.sourceTitle}</h2>
        <p className="mt-2 font-sans text-sm leading-relaxed text-ink-soft">{dict.home.source}</p>
      </section>
    </div>
  )
}
