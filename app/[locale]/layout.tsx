import Link from 'next/link'
import { notFound } from 'next/navigation'
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
      <header className="border-b-2 border-ink">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-baseline gap-x-6 gap-y-2 px-4 py-3">
          <Link href={`/${locale}`} className="font-serif text-xl leading-none">
            Mufakat
          </Link>
          <span className="font-sans text-xs text-ink-faint">{dict.nav.tagline}</span>
          <nav className="ml-auto flex gap-4 font-sans text-sm">
            {links.map((link) => (
              <Link key={link.href} href={link.href} className="hover:underline underline-offset-4">
                {link.label}
              </Link>
            ))}
            <span className="flex gap-1 text-ink-faint">
              {LOCALES.map((option) => (
                <Link
                  key={option}
                  href={`/${option}`}
                  className={option === locale ? 'text-ink font-semibold' : 'hover:text-ink'}
                >
                  {option}
                </Link>
              ))}
            </span>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-4 py-6">{children}</main>
      <footer className="mt-12 border-t border-ink-rule">
        <div className="mx-auto max-w-[1400px] px-4 py-6 font-sans text-xs text-ink-faint">
          <p>
            Sumber normatif:{' '}
            <a href="https://raft.github.io/raft.pdf" className="underline underline-offset-2">
              Ongaro &amp; Ousterhout, In Search of an Understandable Consensus Algorithm
            </a>
            . Visualiser kanonis:{' '}
            <a href="https://raft.github.io/" className="underline underline-offset-2">
              RaftScope
            </a>
            , oleh penulis makalahnya.
          </p>
        </div>
      </footer>
    </div>
  )
}
