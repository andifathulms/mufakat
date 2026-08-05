import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DocumentLanguage } from '@/components/DocumentLanguage'
import { MakerSignature } from '@/components/MakerSignature'
import { SiteNav } from '@/components/SiteNav'
import { LOCALES, dictionary, isLocale, type Locale } from '@/lib/i18n'

export function generateStaticParams(): { locale: Locale }[] {
  return LOCALES.map((locale) => ({ locale }))
}

export default function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { locale: string }
}) {
  if (!isLocale(params.locale)) notFound()
  const locale = params.locale
  const dict = dictionary(locale)

  const links = [
    { href: `/${locale}/simulasi`, label: dict.nav.simulation },
    { href: `/${locale}/skenario`, label: dict.nav.scenarios },
    { href: `/${locale}/ablasi`, label: dict.nav.ablation },
  ]

  return (
    <div className="min-h-screen">
      <DocumentLanguage locale={locale} />
      <a href="#main" className="skip-link font-sans text-sm">
        {locale === 'id' ? 'Lompat ke konten utama' : 'Skip to main content'}
      </a>
      {/* Sticky, because the simulator is a long page and losing the way back to the
          scenario library halfway down it is a small, avoidable annoyance. */}
      <header className="sticky top-0 z-30 border-b-2 border-ink bg-stock/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6">
          <Link href={`/${locale}`} className="flex items-baseline gap-2.5">
            <span className="font-serif text-xl leading-none">Raft Simulator</span>
            <span className="hidden font-sans text-micro text-ink-faint sm:inline">
              {dict.nav.tagline}
            </span>
          </Link>
          <SiteNav locale={locale} links={links} />
        </div>
      </header>
      <main id="main" className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6">
        {children}
      </main>
      {/* One seam. The citation and the maker's mark sit at opposite ends of the same
          bar rather than in stacked sections with a rule between them — a personal
          credit is not a second legal notice and should not be filed as one. */}
      <footer className="mt-16 border-t border-ink-rule">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-6 px-4 py-8 sm:flex-row sm:items-end sm:justify-between sm:gap-10 sm:px-6">
          <p className="max-w-3xl font-sans text-micro leading-relaxed text-ink-faint">
            {locale === 'id' ? 'Sumber normatif' : 'Normative source'}:{' '}
            <a
              href="https://raft.github.io/raft.pdf"
              className="text-ink-soft underline underline-offset-2 hover:text-ink"
            >
              Ongaro &amp; Ousterhout, In Search of an Understandable Consensus Algorithm
            </a>
            . {locale === 'id' ? 'Visualiser kanonis' : 'The canonical visualiser'}:{' '}
            <a
              href="https://raft.github.io/"
              className="text-ink-soft underline underline-offset-2 hover:text-ink"
            >
              RaftScope
            </a>
            {locale === 'id' ? ', oleh penulis makalahnya.' : ', by the paper’s own author.'}
          </p>
          <MakerSignature locale={locale} />
        </div>
      </footer>
    </div>
  )
}
