'use client'

/**
 * The site header's navigation.
 *
 * A client component only so it can mark the current section — without that, the
 * three destinations read as a flat list and nothing tells you where you are, which
 * is the one job a persistent nav has beyond linking.
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LOCALES, type Locale } from '@/lib/i18n'

interface Props {
  readonly locale: Locale
  readonly links: readonly { readonly href: string; readonly label: string }[]
}

export function SiteNav({ locale, links }: Props) {
  const pathname = usePathname() ?? ''

  return (
    <nav className="ml-auto flex items-center gap-1 font-sans text-label">
      {links.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`)
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={[
              'border-b-2 px-2 py-1 transition-colors',
              active
                ? 'border-ink font-semibold text-ink'
                : 'border-transparent text-ink-soft hover:border-ink-rule hover:text-ink',
            ].join(' ')}
          >
            {link.label}
          </Link>
        )
      })}

      {/* The locale switch keeps you where you are rather than dropping you home:
          changing language is not a request to lose your place. */}
      <span className="ml-3 flex items-center gap-1 border-l border-ink-rule pl-3 text-micro uppercase">
        {LOCALES.map((option) => {
          const rest = pathname.startsWith(`/${locale}`) ? pathname.slice(locale.length + 1) : ''
          return (
            <Link
              key={option}
              href={`/${option}${rest}`}
              aria-current={option === locale ? 'true' : undefined}
              className={
                option === locale
                  ? 'px-1 font-semibold text-ink'
                  : 'px-1 text-ink-faint hover:text-ink'
              }
            >
              {option}
            </Link>
          )
        })}
      </span>
    </nav>
  )
}
