import Link from 'next/link'
import { redirect } from 'next/navigation'
import { DEFAULT_LOCALE } from '@/lib/i18n'

/**
 * The root is a redirect to the default locale. Under `output: 'export'` there is no
 * server to issue a 302, so the exported page carries a `refresh` and a real link —
 * which is also what makes it work without JavaScript.
 *
 * English is the default. Indonesian remains a first-class translation rather than an
 * afterthought, and is one click away here and from every page.
 */
export const dynamic = 'force-static'

export default function RootPage() {
  if (process.env.NODE_ENV === 'development') redirect(`/${DEFAULT_LOCALE}`)
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-6">
      <meta httpEquiv="refresh" content={`0; url=./${DEFAULT_LOCALE}/`} />
      <h1 className="font-serif text-3xl">Raft Simulator</h1>
      <p className="font-sans text-body text-ink-soft">
        A Raft consensus simulator. Redirecting…
      </p>
      <p className="flex gap-4 font-sans text-label">
        <Link href="/en" className="underline underline-offset-4">
          English
        </Link>
        <Link href="/id" className="underline underline-offset-4">
          Bahasa Indonesia
        </Link>
      </p>
    </main>
  )
}
